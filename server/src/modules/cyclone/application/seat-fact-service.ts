import { createHash } from 'node:crypto';
import type { CycloneDispatch } from '../../../engine/cyclone/dispatch-store.js';
import type { SeatFactScope, SeatFactTool } from '../../../engine/cyclone/seat-fact-tools.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneConsoleService } from './console-service.js';
import type { CycloneDispatchService } from './dispatch-service.js';
import type { CycloneSeatService } from './seat-service.js';
import { collaborationConsoleEvent, collaborationSeatSummary } from './agent-console-projection.js';
import { factCursorOffset } from './console-activity.js';
import type { CycloneSeatActivityFilter } from '../domain/console.js';

const OPEN = new Set(['queued', 'running', 'awaiting_human']);
const BUDGET = 18_000;

/** Bound executors and the human console consume the same durable project facts. */
export class CycloneSeatFactService {
  constructor(private readonly console: CycloneConsoleService,
    private readonly dispatches: CycloneDispatchService, private readonly seats: CycloneSeatService) {}

  async read(scope: SeatFactScope, tool: SeatFactTool, args: Record<string, string>): Promise<unknown> {
    await this.seats.require(scope.workshopId, scope.seatId);
    if (tool === 'seat_activity_read') return this.activity(scope, args);
    return this.dispatch(scope, args);
  }

  private async activity(scope: SeatFactScope, args: Record<string, string>) {
    exact(args, ['limit', 'filter', 'cursor']);
    const limit = integer(args.limit, 8, 12);
    const filter = choice(args.filter, 'all', ['all', 'work', 'changes']) as CycloneSeatActivityFilter;
    const { seat, page, outgoingDispatches } = await this.console.readSeatHistoryFacts({
      ...scope, limit, filter, cursor: args.cursor,
    });
    const brief = collaborationSeatSummary(seat);
    const result = { ...scope, title: brief.title, duty: brief.duty, textTruncated: brief.textTruncated,
      capturedAt: page.capturedAt, pendingHuman: seat.pending, stats: seat.stats, outgoingDispatches,
      filter, revision: page.revision, total: page.total,
      recent: page.items.map(collaborationConsoleEvent), recentTruncated: Boolean(page.nextCursor),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      ...(brief.error ? { error: brief.error, errorTruncated: brief.errorTruncated } : {}) };
    const offset = factCursorOffset(args.cursor, page.revision, page.total);
    while (JSON.stringify(result).length > BUDGET && result.recent.length > 1) {
      result.recent.pop(); result.recentTruncated = true;
      result.nextCursor = `${page.revision}:${offset + result.recent.length}`;
    }
    return bounded(result);
  }

  private async dispatch(scope: SeatFactScope, args: Record<string, string>) {
    exact(args, ['direction', 'status', 'limit', 'cursor', 'dispatchId', 'part', 'offset']);
    const items = await this.related(scope);
    if (args.dispatchId !== undefined) {
      if (['direction', 'status', 'limit', 'cursor'].some(key => args[key] !== undefined)) {
        throw invalid('读取派发正文时只填写dispatchId、part和offset');
      }
      const item = items.find(candidate => candidate.id === args.dispatchId);
      if (!item) throw frameworkError({ code: 'CYCLONE_SEAT_DISPATCH_NOT_FOUND', kind: 'not_found',
        message: '派发不存在或不属于本工位', source: 'cyclone.seat-facts', retryable: false });
      const part = choice(args.part, 'response', ['task', 'response', 'error']) as 'task' | 'response' | 'error';
      const content = item[part] ?? '';
      const offset = integer(args.offset, 0, content.length, 0);
      let end = Math.min(content.length, offset + 6_000);
      const output = () => ({ ...scope, ...summary(item), part, offset,
        totalChars: content.length, content: content.slice(offset, end),
        ...(end < content.length ? { nextOffset: end } : {}) });
      while (JSON.stringify(output()).length > BUDGET && end > offset) end--;
      return bounded(output());
    }
    if (args.part !== undefined || args.offset !== undefined) throw invalid('读取正文需要dispatchId');
    const direction = choice(args.direction, 'outgoing', ['outgoing', 'incoming']);
    const status = choice(args.status, 'all', ['all', 'open', ...OPEN, 'completed', 'failed']);
    const limit = integer(args.limit, 8, 20);
    const selected = items.filter(item => (direction === 'outgoing'
      ? item.sourceSeatId === scope.seatId : item.targetSeatId === scope.seatId)
      && (status === 'all' || (status === 'open' ? OPEN.has(item.status) : status === item.status)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const revision = createHash('sha256').update(JSON.stringify([scope, direction, status,
      selected.map(item => [item.id, item.status, item.updatedAt])])).digest('hex');
    const offset = factCursorOffset(args.cursor, revision, selected.length);
    let end = Math.min(selected.length, offset + limit);
    const output = () => ({ ...scope, direction, status, revision, total: selected.length,
      items: selected.slice(offset, end).map(summary),
      ...(end < selected.length ? { nextCursor: `${revision}:${end}` } : {}) });
    while (JSON.stringify(output()).length > BUDGET && end > offset + 1) end--;
    return bounded(output());
  }

  private async related(scope: SeatFactScope) {
    const items = await this.dispatches.listWorkshop(scope.workshopId);
    if (items.some(item => item.workshopId !== scope.workshopId)) {
      throw frameworkError({ code: 'CYCLONE_SEAT_FACTS_CORRUPT', kind: 'io',
        message: '派发记录所属工作室不一致，原文件已保留', source: 'cyclone.seat-facts', retryable: false });
    }
    return items.filter(item =>
      item.sourceSeatId === scope.seatId || item.targetSeatId === scope.seatId);
  }
}

function summary(item: CycloneDispatch) {
  return { dispatchId: item.id, sourceKind: item.sourceKind ?? 'room',
    sourceSeatId: item.sourceSeatId, targetSeatId: item.targetSeatId,
    sourceSeatTitle: item.sourceSeatTitle.slice(0, 120), targetSeatTitle: item.targetSeatTitle.slice(0, 120),
    status: item.status, task: item.task.slice(0, 200), taskChars: item.task.length,
    responseChars: item.response?.length ?? 0, errorChars: item.error?.length ?? 0,
    receiptState: item.receiptState, createdAt: item.createdAt, updatedAt: item.updatedAt };
}

function exact(args: Record<string, string>, allowed: string[]) {
  if (Object.keys(args).some(key => !allowed.includes(key))) {
    throw invalid('仅接受工具声明的字段；工作室和工位身份由框架绑定，无需填写ID');
  }
}

function integer(value: unknown, fallback: number, max: number, min = 1): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))
    || Number(value) < min || Number(value) > max) throw invalid('分页数量或位置无效');
  return Number(value);
}

function choice(value: unknown, fallback: string, allowed: string[]): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) throw invalid('筛选条件或正文部分无效');
  return value;
}

function bounded<T>(value: T): T {
  if (JSON.stringify(value).length > BUDGET) throw invalid('事实记录超出读取预算，请减少每页数量');
  return value;
}

function invalid(message: string) {
  return frameworkError({ code: 'CYCLONE_SEAT_FACTS_INPUT_INVALID', kind: 'validation',
    message, source: 'cyclone.seat-facts', retryable: false });
}
