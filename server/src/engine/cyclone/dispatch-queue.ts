import { listWorkshops } from './workshop-store.js';
import {
  type CycloneDispatch,
  listWorkshopDispatches,
  updateDispatch,
} from './dispatch-store.js';
import { executeDispatchRecord, retainDispatchExecutions, settleDispatchExecutions, waitForDispatchExecutions } from './dispatch-runtime.js';
import { loadRoom } from './room-store.js';
import path from 'node:path';
import { activateDispatch, withdrawExpiredDispatch } from './dispatch-admission.js';

export type DispatchExecutor = (
  dataDir: string,
  item: CycloneDispatch,
) => Promise<'completed' | 'awaiting_human' | 'queued' | 'failed'>;

const activeSeats = new Set<string>();
const dirtySeats = new Set<string>();
const activeTasks = new Set<Promise<void>>();
const admissionTimers = new Map<string, { dataDir: string; timer: ReturnType<typeof setTimeout> }>();
const retryTimers = new Map<string, { dataDir: string; timer: ReturnType<typeof setTimeout> }>();

function seatKey(dataDir: string, workshopId: string, seatId: string): string {
  return `${path.resolve(dataDir)}/${workshopId}/${seatId}`;
}

export async function drainQueuedDispatches(
  dataDir: string,
  workshopId: string,
  seatId: string,
  execute: DispatchExecutor = executeDispatchRecord,
): Promise<void> {
  await prepareAdmissions(dataDir, workshopId, seatId);
  const pending = (await listWorkshopDispatches(dataDir, workshopId))
    .filter(item => item.targetSeatId === seatId && !item.deliveryDeferred
      && (item.status === 'queued' || item.status === 'awaiting_human'));
  for (const item of pending) {
    if (item.status === 'awaiting_human') return;
    const result = await execute(dataDir, item);
    if (result === 'queued') {
      const key = seatKey(dataDir, workshopId, seatId);
      if (!retryTimers.has(key)) {
        const timer = setTimeout(() => {
          retryTimers.delete(key); kickDispatchQueue(dataDir, workshopId, seatId, execute);
        }, 250);
        timer.unref(); retryTimers.set(key, { dataDir, timer });
      }
      return;
    }
    if (result === 'awaiting_human') return;
  }
}

export function kickDispatchQueue(
  dataDir: string,
  workshopId: string,
  seatId: string,
  execute: DispatchExecutor = executeDispatchRecord,
  releasedDispatchIds?: string[],
): void {
  const prepare = prepareAdmissions(dataDir, workshopId, seatId, releasedDispatchIds)
    .then(() => startQueue(dataDir, workshopId, seatId, execute));
  track(prepare);
}

function startQueue(dataDir: string, workshopId: string, seatId: string, execute: DispatchExecutor): void {
  const key = seatKey(dataDir, workshopId, seatId);
  if (activeSeats.has(key)) {
    dirtySeats.add(key);
    return;
  }
  activeSeats.add(key);
  const run = async () => {
    do {
      dirtySeats.delete(key);
      await drainQueuedDispatches(dataDir, workshopId, seatId, execute);
    } while (dirtySeats.has(key));
  };
  const task = run()
    .finally(() => {
      dirtySeats.delete(key);
      activeSeats.delete(key);
    });
  track(task);
}

function track(promise: Promise<void>): void {
  const task = promise.catch(error => console.error('[cyclone] 异步派发队列失败', error))
    .finally(() => activeTasks.delete(task));
  activeTasks.add(task);
}

async function prepareAdmissions(dataDir: string, workshopId: string, seatId: string, released: string[] = []) {
  const items = (await listWorkshopDispatches(dataDir, workshopId))
    .filter(item => item.targetSeatId === seatId && item.status === 'queued');
  await Promise.all(items.map(async item => {
    if (item.deliveryDeferred && !released.includes(item.id)) return;
    const current = await activateDispatch(dataDir, workshopId, item.id);
    if (!current || current.status !== 'queued' || !current.admissionDeadlineAt) return;
    const key = `${seatKey(dataDir, workshopId, seatId)}/${item.id}`;
    if (admissionTimers.has(key)) return;
    const timer = setTimeout(() => {
      admissionTimers.delete(key);
      track(withdrawExpiredDispatch(dataDir, workshopId, item.id).then(() => {
        kickDispatchQueue(dataDir, workshopId, seatId);
      }));
    }, Math.max(0, Date.parse(current.admissionDeadlineAt) - Date.now()));
    timer.unref(); admissionTimers.set(key, { dataDir, timer });
  }));
}

export function clearDispatchAdmissionTimers(dataDir: string): void {
  for (const timers of [admissionTimers, retryTimers]) {
    for (const [key, value] of timers) if (value.dataDir === dataDir) {
      clearTimeout(value.timer); timers.delete(key);
    }
  }
}

export async function completeAwaitingDispatch(
  dataDir: string,
  workshopId: string,
  seatId: string,
  response: string,
  executionIds: string[] = [],
  signal?: AbortSignal,
): Promise<void> {
  const item = (await listWorkshopDispatches(dataDir, workshopId))
    .find(candidate => candidate.targetSeatId === seatId && candidate.status === 'awaiting_human');
  if (!item) return;
  const allExecutions = await retainDispatchExecutions(dataDir, item, executionIds);
  await updateDispatch(dataDir, workshopId, item.id, { status: 'running', activity: undefined });
  try {
    if (!await settleDispatchExecutions(dataDir, item, allExecutions,
      (current, ids) => waitWithSignal(
        waitForDispatchExecutions(current, ids), signal,
      ))) return;
    signal?.throwIfAborted();
  } catch (error) {
    await updateDispatch(dataDir, workshopId, item.id, { status: 'failed', activity: undefined,
      response: undefined, error: error instanceof Error ? error.message : String(error),
      errorCode: signal?.aborted ? 'DISPATCH_ABORTED' : 'BACKGROUND_EXECUTION_FAILED',
      errorKind: signal?.aborted ? 'cancelled' : 'tool', completedAt: new Date().toISOString() });
    throw error;
  }
  const room = (item.sourceKind ?? 'room') !== 'room'
    ? null
    : await loadRoom(dataDir, workshopId, item.sourceRoomId);
  const deadline = (item.sourceKind ?? 'room') !== 'room'
    ? undefined
    : Math.max(item.sourceRoundSeq, room?.completedRoundSeq ?? 0) + 3;
  await updateDispatch(dataDir, workshopId, item.id, {
    status: 'completed',
    response: response || '（工位已完成，但没有提供文字回复）',
    completedAt: new Date().toISOString(),
    decisionDeadlineRoundSeq: deadline,
  });
  kickDispatchQueue(dataDir, workshopId, seatId);
}

export async function retainAwaitingDispatchExecutions(
  dataDir: string, workshopId: string, seatId: string, executionIds: string[],
): Promise<void> {
  const item = (await listWorkshopDispatches(dataDir, workshopId))
    .find(candidate => candidate.targetSeatId === seatId && candidate.status === 'awaiting_human');
  if (item && executionIds.length) await retainDispatchExecutions(dataDir, item, executionIds);
}

async function waitWithSignal<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new Error('派发已中止'));
    };
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function recoverCycloneDispatches(dataDir: string): Promise<number> {
  let failed = 0;
  for (const workshop of await listWorkshops(dataDir)) {
    const items = await listWorkshopDispatches(dataDir, workshop.id);
    for (const item of items) {
      if (item.status === 'running') {
        await updateDispatch(dataDir, workshop.id, item.id, {
          status: 'failed',
          error: '应用在任务执行期间关闭，任务未自动重试',
          completedAt: new Date().toISOString(),
        });
        failed++;
      } else if (item.status === 'queued') {
        const recovered = await withdrawExpiredDispatch(dataDir, workshop.id, item.id,
          Date.now(), item.deliveryDeferred === true);
        if (recovered?.status === 'failed') failed++;
      }
    }
  }
  return failed;
}

export async function resumeCycloneDispatches(dataDir: string): Promise<void> {
  for (const workshop of await listWorkshops(dataDir)) {
    const queuedSeats = new Set(
      (await listWorkshopDispatches(dataDir, workshop.id))
        .filter(item => item.status === 'queued' && !item.deliveryDeferred)
        .map(item => item.targetSeatId),
    );
    for (const seatId of queuedSeats) kickDispatchQueue(dataDir, workshop.id, seatId);
  }
}

export async function drainCycloneDispatches(): Promise<void> {
  while (activeTasks.size > 0) await Promise.all([...activeTasks]);
}
