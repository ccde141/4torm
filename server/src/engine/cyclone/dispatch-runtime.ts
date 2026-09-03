import { chatSeat, type SeatEvent } from './seat-runner.js';
import { loadRoom } from './room-store.js';
import {
  type CycloneDispatch,
  type DispatchActivity,
  updateDispatch,
} from './dispatch-store.js';
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

interface DispatchChildExecution {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export interface DispatchExecutionDeps {
  executeSeat: (item: CycloneDispatch) => Promise<SeatExecutionResult>;
  getCompletedRoundSeq: (item: CycloneDispatch) => Promise<number>;
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
  const origin = item.sourceKind === 'seat' ? '工位' : '群聊工位';
  let result;
  try {
    result = await chatSeat(
      dataDir,
      item.workshopId,
      item.targetSeatId,
      `[异步派发：来自${origin}「${item.sourceSeatTitle}」]\n\n${item.task}`,
      onEvent,
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

async function waitForDispatchExecutions(
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
  const resolved = deps ?? {
    executeSeat: (current: CycloneDispatch) => defaultExecuteSeat(dataDir, current),
    getCompletedRoundSeq: (current: CycloneDispatch) => defaultCompletedRoundSeq(dataDir, current),
  };
  await updateDispatch(dataDir, item.workshopId, item.id, { status: 'running', error: undefined });
  try {
    const result = await resolved.executeSeat(item);
    if (result.termination.status === 'waiting') {
      await updateDispatch(dataDir, item.workshopId, item.id, { status: 'awaiting_human', activity: undefined });
      return 'awaiting_human';
    }
    if (result.termination.status !== 'succeeded') {
      await persistFailedTermination(dataDir, item, result.termination);
      return 'failed';
    }
    const executionIds = [...new Set(result.executionIds ?? [])];
    if (executionIds.length > 0) {
      await updateDispatch(dataDir, item.workshopId, item.id, { executionIds });
      const executions = await (resolved.waitExecutions ?? waitForDispatchExecutions)(item, executionIds);
      const failed = executions.find(execution => execution.status !== 'completed');
      if (failed) {
        const cancelled = failed.status === 'cancelled';
        await updateDispatch(dataDir, item.workshopId, item.id, {
          status: 'failed', activity: undefined, response: undefined,
          error: failed.error ?? (cancelled ? '后台执行已取消' : '后台执行失败'),
          errorCode: cancelled ? 'BACKGROUND_EXECUTION_CANCELLED' : 'BACKGROUND_EXECUTION_FAILED',
          errorKind: cancelled ? 'cancelled' : 'tool',
          completedAt: new Date().toISOString(),
        });
        return 'failed';
      }
    }
    const deadline = item.sourceKind === 'seat'
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
    if (isQueueableSeatState(error)) {
      await updateDispatch(dataDir, item.workshopId, item.id, {
        status: 'queued', error: undefined, activity: undefined,
      });
      return 'queued';
    }
    await updateDispatch(dataDir, item.workshopId, item.id, {
      status: 'failed',
      activity: undefined,
      error: (error as Error).message,
      completedAt: new Date().toISOString(),
    });
    return 'failed';
  }
}
