import { chatSeatWithinExecution, type SeatEvent } from './seat-runner.js';
import { loadSeat, tryAcquireSeatLock } from './seat-store.js';
import { loadRoom } from './room-store.js';
import {
  type CycloneDispatch,
  type DispatchActivity,
  updateDispatch,
  loadDispatch,
  mutateDispatch,
} from './dispatch-store.js';
import { activateDispatch, claimDispatch, withdrawExpiredDispatch } from './dispatch-admission.js';
import { reduceDispatchActivity } from './dispatch-progress.js';
import { beginExternalSeatActivity } from './seat-activity.js';
import type { ReActTermination } from '../shared/react/outcome.js';
import { backgroundExecutions } from '../../services/background-execution.js';

interface SeatExecutionResult {
  content: string;
  awaitingHuman: boolean;
  termination: ReActTermination;
  executionIds?: string[];
}

export interface DispatchChildExecution {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  error?: string;
}
type DispatchResult = 'completed' | 'awaiting_human' | 'queued' | 'failed';

function storedResult(item: CycloneDispatch | null): DispatchResult {
  return !item ? 'failed' : item.status === 'running' ? 'queued' : item.status;
}

export interface DispatchExecutionDeps {
  executeSeat: (item: CycloneDispatch) => Promise<SeatExecutionResult>;
  getCompletedRoundSeq: (item: CycloneDispatch) => Promise<number>;
  acquireTarget?: (item: CycloneDispatch) => (() => void) | null;
  targetPending?: (item: CycloneDispatch) => Promise<boolean>;
  waitExecutions?: (
    item: CycloneDispatch,
    executionIds: string[],
  ) => Promise<DispatchChildExecution[]>;
}

function isQueueableSeatState(error: unknown): boolean {
  const message = (error as Error).message || '';
  return message.includes('工位正在执行中') || message.includes('工位处于挂起状态');
}

async function defaultExecuteSeat(dataDir: string, item: CycloneDispatch): Promise<SeatExecutionResult> {
  let awaitingHuman = false;
  let activity: DispatchActivity | undefined;
  let writes = Promise.resolve<unknown>(undefined);
  const live = beginExternalSeatActivity(
    item.workshopId,
    item.targetSeatId,
    'dispatch',
    `正在执行来自「${item.sourceSeatTitle}」的异步派发`,
    item.sourceSeatId,
  );
  const onEvent = (event: SeatEvent) => {
    live.emit({ ...event });
    if (event.type === 'ask') awaitingHuman = true;
    const next = reduceDispatchActivity(activity, event);
    if (!next || JSON.stringify(next) === JSON.stringify(activity)) return;
    const preparationTooSoon = event.type === 'tool-progress'
      && activity?.phase === 'tool-preparing'
      && activity.tool === next.tool
      && (next.elapsedSeconds ?? 0) - (activity.elapsedSeconds ?? 0) < 2;
    if (preparationTooSoon) return;
    activity = next;
    writes = writes.then(() => updateDispatch(dataDir, item.workshopId, item.id, { activity: next }));
  };
  const origin = item.sourceKind === 'supervisor' ? '工作室主管'
    : item.sourceKind === 'seat' ? '工位' : '群聊工位';
  let result;
  try {
    result = await chatSeatWithinExecution(
      dataDir,
      item.workshopId,
      item.targetSeatId,
      `[异步派发：来自${origin}「${item.sourceSeatTitle}」]\n\n${item.task}`,
      onEvent,
      undefined,
      { dispatchId: item.id },
    );
  } finally {
    live.finish();
    await writes;
  }
  return {
    content: result.content, awaitingHuman, termination: result.termination,
    executionIds: result.executionIds,
  };
}

export async function waitForDispatchExecutions(
  item: CycloneDispatch,
  executionIds: string[],
): Promise<DispatchChildExecution[]> {
  const ownerId = `${item.workshopId}:${item.targetSeatId}`;
  return Promise.all(executionIds.map(async executionId => {
    const snapshot = await backgroundExecutions.waitUntilSettled(
      executionId, 'cyclone', ownerId,
    );
    return {
      executionId,
      status: snapshot.status as DispatchChildExecution['status'],
      error: snapshot.error,
    };
  }));
}

export async function retainDispatchExecutions(dataDir: string, item: CycloneDispatch, ids: string[]): Promise<string[]> {
  const updated = await mutateDispatch(dataDir, item.workshopId, item.id, current => {
    return { ...current, executionIds: [...new Set([...(current.executionIds ?? []), ...ids])] };
  });
  return updated?.executionIds ?? [];
}

export async function settleDispatchExecutions(
  dataDir: string, item: CycloneDispatch, executionIds: string[],
  wait: NonNullable<DispatchExecutionDeps['waitExecutions']> = waitForDispatchExecutions,
): Promise<boolean> {
  if (!executionIds.length) return true;
  const executions = await wait(item, executionIds);
  const failed = executions.find(execution => execution.status !== 'completed');
  if (!failed) return true;
  const cancelled = failed.status === 'cancelled';
  await updateDispatch(dataDir, item.workshopId, item.id, {
    status: 'failed', activity: undefined, response: undefined,
    error: failed.error ?? (cancelled ? '后台执行已取消' : '后台执行失败'),
    errorCode: cancelled ? 'BACKGROUND_EXECUTION_CANCELLED' : 'BACKGROUND_EXECUTION_FAILED',
    errorKind: cancelled ? 'cancelled' : 'tool', completedAt: new Date().toISOString(),
  });
  return false;
}

async function persistFailedTermination(
  dataDir: string,
  item: CycloneDispatch,
  termination: Exclude<ReActTermination, { status: 'succeeded' } | { status: 'waiting' }>,
): Promise<void> {
  const error = termination.status === 'aborted'
    ? { code: 'DISPATCH_ABORTED', kind: 'cancelled' as const, message: '派发已中止' }
    : termination.error;
  await updateDispatch(dataDir, item.workshopId, item.id, {
    status: 'failed', activity: undefined, response: undefined,
    error: error.message, errorCode: error.code, errorKind: error.kind,
    completedAt: new Date().toISOString(),
  });
}

async function defaultCompletedRoundSeq(dataDir: string, item: CycloneDispatch): Promise<number> {
  const room = await loadRoom(dataDir, item.workshopId, item.sourceRoomId);
  return room?.completedRoundSeq ?? item.sourceRoundSeq;
}

export async function executeDispatchRecord(
  dataDir: string,
  item: CycloneDispatch,
  deps?: DispatchExecutionDeps,
): Promise<'completed' | 'awaiting_human' | 'queued' | 'failed'> {
  const resolved = {
    executeSeat: (current: CycloneDispatch) => defaultExecuteSeat(dataDir, current),
    getCompletedRoundSeq: (current: CycloneDispatch) => defaultCompletedRoundSeq(dataDir, current),
    acquireTarget: (current: CycloneDispatch) => tryAcquireSeatLock(current.workshopId, current.targetSeatId),
    targetPending: async (current: CycloneDispatch) => {
      const seat = await loadSeat(dataDir, current.workshopId, current.targetSeatId);
      if (!seat) throw new Error('目标工位不存在或已删除');
      return Boolean(seat.pending);
    },
    ...deps,
  };
  // Re-read persisted state before touching the target: old snapshots have no execution rights.
  const latest = await loadDispatch(dataDir, item.workshopId, item.id);
  if (!latest || latest.status !== 'queued') return storedResult(latest);
  if (latest.deliveryDeferred) return 'queued';
  await activateDispatch(dataDir, item.workshopId, item.id);
  const eligible = await withdrawExpiredDispatch(dataDir, item.workshopId, item.id);
  if (!eligible || eligible.status !== 'queued') return storedResult(eligible);
  const release = resolved.acquireTarget(eligible);
  if (!release) return 'queued';
  let admitted = false;
  try {
    if (await resolved.targetPending(eligible)) return 'queued';
    const claim = await claimDispatch(dataDir, item.workshopId, item.id);
    if (!claim.claimed || !claim.item) return storedResult(claim.item);
    admitted = true;
    item = claim.item;
    const result = await resolved.executeSeat(item);
    const executionIds = await retainDispatchExecutions(dataDir, item, result.executionIds ?? []);
    if (result.termination.status === 'waiting') {
      await updateDispatch(dataDir, item.workshopId, item.id, { status: 'awaiting_human', activity: undefined });
      return 'awaiting_human';
    }
    if (result.termination.status !== 'succeeded') {
      await persistFailedTermination(dataDir, item, result.termination);
      return 'failed';
    }
    if (!await settleDispatchExecutions(dataDir, item, executionIds, resolved.waitExecutions)) return 'failed';
    const deadline = (item.sourceKind ?? 'room') !== 'room'
      ? undefined
      : Math.max(item.sourceRoundSeq, await resolved.getCompletedRoundSeq(item)) + 3;
    await updateDispatch(dataDir, item.workshopId, item.id, {
      status: 'completed',
      activity: undefined,
      response: result.content || '（工位已完成，但没有提供文字回复）',
      completedAt: new Date().toISOString(),
      decisionDeadlineRoundSeq: deadline,
    });
    return 'completed';
  } catch (error) {
    if (!admitted && isQueueableSeatState(error)) {
      return 'queued';
    }
    await updateDispatch(dataDir, item.workshopId, item.id, {
      status: 'failed',
      delivered: admitted,
      activity: undefined,
      error: (error as Error).message,
      completedAt: new Date().toISOString(),
    });
    return 'failed';
  } finally { release(); }
}
