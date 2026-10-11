import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { RoomData, SeatData } from '../../../engine/cyclone/types.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import type { WorkshopSummary } from '../domain/workshop.js';

export type CycloneThreadTarget = 'seat' | 'room' | 'chair';

interface Sources {
  workshops: { list(): Promise<WorkshopSummary[]> };
  seats: { require(workshopId: string, seatId: string): Promise<SeatData> };
  rooms: { require(workshopId: string, roomId: string): Promise<RoomData> };
  chair: { status(workshopId: string, roomId: string): Promise<{ messages: ContextMessage[] }> };
}

interface ThreadInput {
  workshopId: string;
  target: CycloneThreadTarget;
  targetId: string;
  cursor?: string;
  limit?: number;
}

interface MessageInput extends Omit<ThreadInput, 'cursor' | 'limit'> {
  index: number;
  revision: string;
  offset?: number;
  part?: 'content' | 'tools';
}

type ThreadMessage = SeatData['messages'][number] | RoomData['publicMessages'][number] | ContextMessage;

/** Agent views never return whole persisted seat/room objects or image data URLs. */
export class CycloneAgentReadService {
  constructor(private readonly dataDir: string, private readonly sources: Sources) {}

  async agents(limit = 20, cursor?: string) {
    const agents = await readAgentNames(this.dataDir);
    return page(agents, limit, cursor);
  }

  async workshops(limit = 20, cursor?: string) {
    const items = (await this.sources.workshops.list())
      .map(({ id, title, seatCount, roomCount, updatedAt }) => ({
        workshopId: id, title, seatCount, roomCount, updatedAt,
      })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)
        || a.workshopId.localeCompare(b.workshopId));
    return page(items, limit, cursor);
  }

  async thread(input: ThreadInput) {
    const messages = await this.messages(input);
    const revision = digest(messages);
    const end = readCursor(input.cursor, revision, messages.length);
    const limit = checkedLimit(input.limit ?? 24, 24);
    const start = Math.max(0, end - limit);
    return {
      revision, total: messages.length,
      items: messages.slice(start, end).map((message, offset) => (
        preview(message, start + offset)
      )),
      ...(start ? { nextCursor: `${revision}:${start}` } : {}),
    };
  }

  async message(input: MessageInput) {
    const messages = await this.messages(input);
    const revision = digest(messages);
    if (revision !== input.revision) throw changed();
    const message = messages[input.index];
    if (!message) throw invalid('消息索引不存在');
    const source = input.part === 'tools' ? JSON.stringify(message.toolCalls ?? []) : message.content;
    const offset = input.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > source.length) {
      throw invalid('消息续读位置无效');
    }
    const content = source.slice(offset, offset + 6_000);
    const nextOffset = offset + content.length;
    return {
      revision, index: input.index, part: input.part ?? 'content', content,
      totalChars: source.length,
      ...(nextOffset < source.length ? { nextOffset } : {}),
    };
  }

  private async messages(input: Omit<ThreadInput, 'cursor' | 'limit'>): Promise<ThreadMessage[]> {
    if (input.target === 'seat') {
      return (await this.sources.seats.require(input.workshopId, input.targetId)).messages;
    }
    if (input.target === 'room') {
      return (await this.sources.rooms.require(input.workshopId, input.targetId)).publicMessages;
    }
    return (await this.sources.chair.status(input.workshopId, input.targetId)).messages;
  }
}

function preview(message: ThreadMessage, index: number) {
  const content = message.content.slice(0, 600);
  return {
    index, content, contentTruncated: content.length < message.content.length,
    ...('speaker' in message ? { speaker: message.speaker, timestamp: message.timestamp,
      ...(message.roundSeq === undefined ? {} : { roundSeq: message.roundSeq }) }
      : { role: message.role }),
    ...('images' in message && message.images?.length ? { imageCount: message.images.length } : {}),
    ...(message.toolCalls?.length ? { toolCount: message.toolCalls.length } : {}),
  };
}

async function readAgentNames(dataDir: string): Promise<Array<{ agentId: string; name: string }>> {
  let raw: string;
  try { raw = await fs.readFile(agentRegistryFile(dataDir), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw registryError('CYCLONE_AGENT_REGISTRY_READ_FAILED', 'io', error);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed)) throw new Error('Agent 注册表不是对象');
    return Object.entries(parsed).map(([agentId, entry]) => {
      if (!record(entry)) throw new Error(`Agent ${agentId} 的记录无效`);
      return { agentId, name: typeof entry.name === 'string' ? entry.name : agentId };
    }).sort((a, b) => a.agentId.localeCompare(b.agentId));
  } catch (error) { throw registryError('CYCLONE_AGENT_REGISTRY_INVALID', 'io', error); }
}

function page<T>(items: T[], requestedLimit = 20, cursor?: string) {
  const revision = digest(items);
  const start = readCursor(cursor, revision, items.length, 0);
  const limit = checkedLimit(requestedLimit, 50);
  const end = Math.min(items.length, start + limit);
  return { revision, items: items.slice(start, end), total: items.length,
    ...(end < items.length ? { nextCursor: `${revision}:${end}` } : {}) };
}

function readCursor(cursor: string | undefined, revision: string, total: number,
  initial = total): number {
  if (!cursor) return initial;
  const match = /^([a-f0-9]{64}):(\d+)$/.exec(cursor);
  if (!match) throw invalid('游标格式无效');
  if (match[1] !== revision) throw changed();
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index > total) throw invalid('游标位置无效');
  return index;
}

function checkedLimit(limit: number | undefined, max: number): number {
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > max) {
    throw invalid('读取数量无效');
  }
  return limit as number;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message: string) {
  return frameworkError({ code: 'CYCLONE_AGENT_READ_INVALID', kind: 'validation',
    message, source: 'cyclone.agent-read', retryable: false });
}

function changed() {
  return frameworkError({ code: 'CYCLONE_THREAD_CHANGED', kind: 'conflict',
    message: '记录已变化，请从最新页重新读取', source: 'cyclone.agent-read', retryable: false });
}

function registryError(code: string, kind: 'io', cause: unknown) {
  return frameworkError({ code, kind, message: '读取 Agent 名册失败',
    source: 'cyclone.agent-read', retryable: false }, { cause });
}
