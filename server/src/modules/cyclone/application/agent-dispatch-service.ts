import { createHash } from 'node:crypto';
import type { CycloneDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneDispatchService } from './dispatch-service.js';

export type DispatchTextPart = 'task' | 'response' | 'error';

export class CycloneAgentDispatchService {
  constructor(private readonly dispatches: CycloneDispatchService) {}

  async list(workshopId: string, limit = 20, cursor?: string) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw invalid();
    const items = await this.sorted(workshopId);
    const revision = digest(items);
    const offset = cursor === undefined ? 0 : parseCursor(cursor, revision);
    if (offset > items.length) throw invalid();
    const page = items.slice(offset, offset + limit).map(summary);
    const next = offset + page.length;
    return { revision, total: items.length, items: page,
      ...(next < items.length ? { nextCursor: `${revision}:${next}` } : {}) };
  }

  async read(workshopId: string, dispatchId: string, part: DispatchTextPart,
    offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw invalid();
    const item = (await this.dispatches.listWorkshop(workshopId))
      .find(candidate => candidate.id === dispatchId);
    if (!item) throw dispatchError('CYCLONE_DISPATCH_NOT_FOUND', 'not_found',
      '派发不存在或当前不可见');
    const content = item[part] ?? '';
    if (offset > content.length) throw invalid();
    const end = Math.min(content.length, offset + 6_000);
    return { dispatchId, part, totalChars: content.length, offset,
      content: content.slice(offset, end),
      ...(end < content.length ? { nextOffset: end } : {}) };
  }

  async include(workshopId: string, roomId: string, dispatchId: string) {
    const item = await this.dispatches.act(workshopId, roomId, dispatchId, 'include');
    return summary(item);
  }

  private async sorted(workshopId: string): Promise<CycloneDispatch[]> {
    return (await this.dispatches.listWorkshop(workshopId)).sort((a, b) => (
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
    ));
  }
}

function summary(item: CycloneDispatch) {
  return { id: item.id, workshopId: item.workshopId,
    sourceKind: item.sourceKind ?? 'room', sourceRoomId: item.sourceRoomId,
    sourceSeatId: item.sourceSeatId, targetSeatId: item.targetSeatId,
    targetSeatTitle: item.targetSeatTitle, status: item.status,
    readState: item.readState, decisionState: item.decisionState,
    task: item.task.slice(0, 400), taskChars: item.task.length,
    response: (item.response ?? '').slice(0, 400),
    responseChars: item.response?.length ?? 0,
    error: (item.error ?? '').slice(0, 400),
    errorChars: item.error?.length ?? 0,
    createdAt: item.createdAt, updatedAt: item.updatedAt };
}

function digest(items: CycloneDispatch[]): string {
  return createHash('sha256').update(JSON.stringify(items.map(item => [
    item.id, item.status, item.readState, item.decisionState, item.updatedAt,
  ]))).digest('hex');
}

function parseCursor(cursor: string, revision: string): number {
  const match = /^([a-f0-9]{64}):(0|[1-9]\d*)$/.exec(cursor);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw invalid();
  if (match[1] !== revision) throw dispatchError(
    'CYCLONE_DISPATCH_LIST_CHANGED', 'conflict', '派发状态已变化，请重新读取第一页');
  return Number(match[2]);
}

function invalid() {
  return dispatchError('CYCLONE_AGENT_DISPATCH_INPUT_INVALID', 'validation',
    '气旋派发读取参数无效');
}

function dispatchError(code: string,
  kind: 'validation' | 'not_found' | 'conflict', message: string) {
  return frameworkError({ code, kind, message, source: 'cyclone.agent-dispatch',
    retryable: false });
}
