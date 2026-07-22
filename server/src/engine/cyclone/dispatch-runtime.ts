import { chatSeat, type SeatEvent } from './seat-runner.js';
import { loadRoom } from './room-store.js';
import {
  type CycloneDispatch,
  type DispatchActivity,
  updateDispatch,
} from './dispatch-store.js';
import { reduceDispatchActivity } from './dispatch-progress.js';

interface SeatExecutionResult {
  content: string;
  awaitingHuman: boolean;
}

export interface DispatchExecutionDeps {
  executeSeat: (item: CycloneDispatch) => Promise<SeatExecutionResult>;
  getCompletedRoundSeq: (item: CycloneDispatch) => Promise<number>;
}

function isQueueableSeatState(error: unknown): boolean {
  const message = (error as Error).message || '';
  return message.includes('工位正在执行中') || message.includes('工位处于挂起状态');
}

async function defaultExecuteSeat(dataDir: string, item: CycloneDispatch): Promise<SeatExecutionResult> {
  let awaitingHuman = false;
  let activity: DispatchActivity | undefined;
  let writes = Promise.resolve<unknown>(undefined);
  const onEvent = (event: SeatEvent) => {
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
    await writes;
  }
  return { content: result.content, awaitingHuman };
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
    if (result.awaitingHuman) {
      await updateDispatch(dataDir, item.workshopId, item.id, { status: 'awaiting_human', activity: undefined });
      return 'awaiting_human';
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
