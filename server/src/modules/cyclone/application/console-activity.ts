import { createHash } from 'node:crypto';
import type { CycloneDispatch } from '../../../engine/cyclone/dispatch-store.js';
import type { SeatJournalRecord } from '../../../engine/cyclone/seat-event-journal.js';
import type { SeatHistoryRecord } from '../../../engine/cyclone/seat-history.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneRunSnapshot } from '../domain/operation-snapshot.js';
import type {
  CycloneConsoleEvent, CycloneSeatActivityInput, CycloneSeatActivityPage,
} from '../domain/console.js';

export function projectConsoleEvents(
  runs: CycloneRunSnapshot[], dispatches: CycloneDispatch[], contacts: SeatJournalRecord[],
  history: SeatHistoryRecord[], titles: Map<string, string>,
): CycloneConsoleEvent[] {
  return [
    ...runs.map(run => executionEvent(run, titles)),
    ...dispatches.map(dispatchEvent), ...contacts.map(item => contactEvent(item, titles)),
    ...history.map(item => historyEvent(item, titles)),
  ].sort(recentFirst);
}

export function projectSeatEvents(
  seat: { id: string; title: string }, events: CycloneConsoleEvent[],
  dispatches: CycloneDispatch[], contacts: SeatJournalRecord[],
): CycloneConsoleEvent[] {
  return [...events.filter(event => event.seatId === seat.id),
    ...dispatches.filter(item => item.sourceSeatId === seat.id && item.targetSeatId !== seat.id)
      .map(item => ({ ...dispatchEvent(item), id: `dispatch:${item.id}:outgoing`,
        seatId: seat.id, seatTitle: seat.title, title: `派发给${item.targetSeatTitle}` })),
    ...contacts.filter(item => item.sourceSeatId === seat.id && item.seatId !== seat.id)
      .map(item => {
        const event = events.find(candidate => candidate.id === `contact:${item.id}`)!;
        return { ...event, id: `${event.id}:outgoing`, seatId: seat.id,
          seatTitle: seat.title, title: `联络${event.seatTitle}` };
      }),
  ].sort(recentFirst);
}

export function pageSeatActivity(
  events: CycloneConsoleEvent[], input: CycloneSeatActivityInput, capturedAt: string,
): CycloneSeatActivityPage {
  const filter = input.filter ?? 'all';
  const limit = input.limit ?? 20;
  if (!['all', 'work', 'changes'].includes(filter)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw invalid('履历筛选或分页数量无效');
  const changes = new Set(['configuration', 'binding', 'memory']);
  const selected = events.filter(event => filter === 'all'
    || (filter === 'changes' ? changes.has(event.kind) : !changes.has(event.kind)));
  // Sampling time is excluded; only persisted facts and the requested scope bind a page.
  const revision = createHash('sha256').update(JSON.stringify([
    input.workshopId, input.seatId, filter, limit, events,
  ])).digest('hex');
  const start = factCursorOffset(input.cursor, revision, selected.length);
  const end = Math.min(selected.length, start + limit);
  return { items: selected.slice(start, end), total: selected.length, revision, capturedAt,
    ...(end < selected.length ? { nextCursor: `${revision}:${end}` } : {}) };
}

/** Shared by activity and dispatch reads; no cursor can silently cross a changed snapshot. */
export function factCursorOffset(cursor: string | undefined, revision: string, total: number): number {
  if (cursor === undefined) return 0;
  const match = /^([a-f0-9]{64}):(0|[1-9]\d*)$/.exec(cursor);
  if (!match) throw invalid('记录分页游标无效');
  if (match[1] !== revision) throw frameworkError({ code: 'CYCLONE_SEAT_FACTS_CHANGED', kind: 'conflict',
    message: '记录状态已变化，请重新读取第一页', source: 'cyclone.seat-facts', retryable: false });
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset > total) throw invalid('记录分页位置无效');
  return offset;
}

function executionEvent(run: CycloneRunSnapshot, titles: Map<string, string>): CycloneConsoleEvent {
  const room = run.targetKind === 'room';
  const title = titles.get(run.targetId) ?? run.targetId;
  const phaseTitles: Record<string, string> = { 'seat-chat': '工位会话',
    'seat-resume': '继续工位工作', 'seat-compact': '整理工位会话',
    'room-speak': '群聊讨论', 'room-intro': '加入群聊', 'chair-chat': '会长私聊' };
  return { id: `run:${run.operationId}:${run.runId}`, seatId: room ? '' : run.targetId,
    seatTitle: title, kind: room ? 'room' : 'execution', title: phaseTitles[run.phase] ?? run.phase,
    status: run.status, startedAt: run.startedAt, updatedAt: run.updatedAt,
    operationId: run.operationId, runId: run.runId,
    ...(room ? { roomId: run.targetId } : {}), ...(run.error ? { error: run.error } : {}) };
}

function dispatchEvent(item: CycloneDispatch): CycloneConsoleEvent {
  return { id: `dispatch:${item.id}`, seatId: item.targetSeatId, seatTitle: item.targetSeatTitle,
    kind: 'dispatch', title: `收到${item.sourceSeatTitle}的派发`, status: item.status,
    startedAt: item.createdAt, updatedAt: item.updatedAt, sourceTitle: item.sourceSeatTitle,
    dispatchId: item.id, ...(item.sourceRoomId ? { roomId: item.sourceRoomId } : {}),
    ...(item.error ? { error: item.error } : {}) };
}

function contactEvent(item: SeatJournalRecord, titles: Map<string, string>): CycloneConsoleEvent {
  return { id: `contact:${item.id}`, seatId: item.seatId,
    seatTitle: titles.get(item.seatId) ?? item.seatId,
    kind: 'contact', title: item.title, status: item.status,
    startedAt: item.startedAt, updatedAt: item.updatedAt, sourceTitle: item.sourceTitle,
    ...(item.error ? { error: item.error } : {}) };
}

function historyEvent(item: SeatHistoryRecord, titles: Map<string, string>): CycloneConsoleEvent {
  const names = { configuration: '更新岗位配置', binding: '更换绑定 Agent', memory: '更新工位记忆' };
  return { id: `history:${item.id}`, seatId: item.seatId, kind: item.kind,
    seatTitle: titles.get(item.seatId) ?? item.seatId, title: names[item.kind], source: item.source,
    status: 'completed', startedAt: item.timestamp, updatedAt: item.timestamp,
    ...(item.changedFields ? { changedFields: item.changedFields } : {}),
    ...(item.previousAgentId ? { previousAgentId: item.previousAgentId } : {}),
    ...(item.agentId ? { agentId: item.agentId } : {}),
    ...(item.memoryId ? { memoryId: item.memoryId } : {}),
    ...(item.memoryTitle ? { memoryTitle: item.memoryTitle } : {}),
    ...(item.memoryRevision === undefined ? {} : { memoryRevision: item.memoryRevision }) };
}

function recentFirst(left: CycloneConsoleEvent, right: CycloneConsoleEvent): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
}

function invalid(message: string) {
  return frameworkError({ code: 'CYCLONE_SEAT_FACTS_INPUT_INVALID', kind: 'validation',
    message, source: 'cyclone.seat-facts', retryable: false });
}
