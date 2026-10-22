import { createHash } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneConsoleService } from './console-service.js';
import type { CycloneSeatMemoryService } from './seat-memory-service.js';
import {
  collaborationCapabilities, collaborationConsoleHeader,
  collaborationSeatDetail, collaborationSeatSummary,
  collaborationConsoleEvent,
} from './agent-console-projection.js';

export interface CollaborationConsoleInput {
  workshopId: string; seatId?: string; cursor?: string; limit?: number;
}
export interface CollaborationSeatMemoryInput {
  workshopId: string; seatId: string; entryId?: string; revision?: number;
  cursor?: string; limit?: number; offset?: number;
}

const MAX_RESPONSE_CHARS = 24_000;

/** Both audiences read the same island services; only the Agent projection is bounded. */
export class CycloneAgentObservationService {
  constructor(private readonly console: CycloneConsoleService,
    private readonly memory: CycloneSeatMemoryService) {}

  async readConsole(input: CollaborationConsoleInput) {
    const value = await this.console.read(input.workshopId);
    const header = collaborationConsoleHeader(value);
    if (input.seatId !== undefined) {
      const seat = value.seats.find(item => item.id === input.seatId);
      if (!seat) throw error('SEAT_NOT_FOUND', 'not_found', '工位不属于此工作室或已不存在');
      const detail = collaborationSeatDetail(seat);
      const capabilities = collaborationCapabilities(seat);
      const revision = digest([input.workshopId, detail, capabilities]);
      trimRecent(detail);
      const { recent: _recent, recentTruncated: _recentTruncated, ...workshop } = header;
      return page({ ...workshop, view: 'seat' as const, seat: detail }, capabilities,
        { revision, cursorRevision: revision }, input.cursor, input.limit ?? 8);
    }
    const seats = value.seats.map(collaborationSeatSummary);
    // capturedAt is a sampling time, not a persisted change; it must not invalidate a cursor.
    const { capturedAt: _capturedAt, ...stable } = header;
    const revision = digest([stable, seats]);
    trimRecent(header);
    return page({ ...header, view: 'workshop' as const }, seats,
      { revision, cursorRevision: revision }, input.cursor, input.limit ?? 8);
  }

  async readMemory(input: CollaborationSeatMemoryInput) {
    const board = await this.memory.read(input.workshopId, input.seatId);
    if (input.revision !== undefined && input.revision !== board.revision) throw changed();
    const identity = { workshopId: input.workshopId, seatId: input.seatId, revision: board.revision };
    if (input.entryId !== undefined) {
      const entry = board.entries.find(item => item.id === input.entryId);
      if (!entry) throw error('MEMORY_NOT_FOUND', 'not_found', '工位记忆条目不存在');
      const offset = input.offset ?? 0;
      if (offset > entry.content.length) throw invalid('记忆续读位置无效');
      let content = entry.content.slice(offset, offset + 6_000);
      const output = () => ({ ...identity, entryId: entry.id, title: entry.title.slice(0, 200),
        titleTruncated: entry.title.length > 200, updatedAt: entry.updatedAt,
        content, offset, totalChars: entry.content.length,
        ...(offset + content.length < entry.content.length ? { nextOffset: offset + content.length } : {}) });
      // JSON escaping can expand control characters beyond the normal text budget.
      while (JSON.stringify(output()).length > MAX_RESPONSE_CHARS && content.length > 1) {
        content = content.slice(0, Math.floor(content.length * 0.8));
      }
      return bounded(output());
    }
    const items = board.entries.map(entry => ({ entryId: entry.id, title: entry.title.slice(0, 200),
      titleTruncated: entry.title.length > 200, updatedAt: entry.updatedAt,
      totalChars: entry.content.length }));
    return page(identity, items, { revision: board.revision, cursorRevision: digest(identity) },
      input.cursor, input.limit ?? 12);
  }
  async readHistory(input: { workshopId: string; seatId: string; filter?: 'all' | 'work' | 'changes';
    limit?: number; cursor?: string }) {
    const result = await this.console.readSeatHistory({ ...input, limit: input.limit ?? 8 });
    return bounded({ workshopId: input.workshopId, seatId: input.seatId, ...result,
      items: result.items.map(collaborationConsoleEvent) });
  }
}

function trimRecent(value: { recent: unknown[]; recentTruncated: boolean }): void {
  while (JSON.stringify(value).length > MAX_RESPONSE_CHARS / 2 && value.recent.length) {
    value.recent.pop(); value.recentTruncated = true;
  }
}

function page<T, B extends object, R extends string | number>(base: B, items: T[],
  version: { revision: R; cursorRevision: string },
  cursor: string | undefined, limit: number) {
  const start = cursorOffset(cursor, version.cursorRevision, items.length);
  let end = Math.min(items.length, start + limit);
  const output = () => ({ ...base, revision: version.revision,
    items: items.slice(start, end), total: items.length,
    truncated: end < items.length, maxResponseChars: MAX_RESPONSE_CHARS,
    ...(end < items.length ? { nextCursor: `${version.cursorRevision}:${end}` } : {}) });
  let result = output();
  while (JSON.stringify(result).length > MAX_RESPONSE_CHARS && end > start + 1) {
    end--; result = output();
  }
  return bounded(result);
}

function bounded<T>(value: T): T {
  if (JSON.stringify(value).length > MAX_RESPONSE_CHARS) {
    throw error('OUTPUT_LIMIT', 'validation', '工位资料超出读取预算，请在工作台查看异常长字段');
  }
  return value;
}

function cursorOffset(cursor: string | undefined, revision: string, total: number): number {
  if (!cursor) return 0;
  const match = /^([a-f0-9]{64}):(\d+)$/.exec(cursor);
  if (!match) throw invalid('分页游标无效');
  if (match[1] !== revision) throw changed();
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset > total) throw invalid('分页位置无效');
  return offset;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function changed() {
  return error('CHANGED', 'conflict', '工位资料已变化，请重新读取最新索引后定位');
}

function invalid(message: string) { return error('INPUT_INVALID', 'validation', message); }

function error(code: string, kind: 'validation' | 'conflict' | 'not_found', message: string) {
  return frameworkError({ code: `CYCLONE_AGENT_OBSERVATION_${code}`, kind, message,
    source: 'cyclone.agent-observation', retryable: false });
}
