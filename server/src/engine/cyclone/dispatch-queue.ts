import { listWorkshops } from './workshop-store.js';
import {
  type CycloneDispatch,
  listWorkshopDispatches,
  updateDispatch,
} from './dispatch-store.js';
import { executeDispatchRecord } from './dispatch-runtime.js';
import { loadRoom } from './room-store.js';

export type DispatchExecutor = (
  dataDir: string,
  item: CycloneDispatch,
) => Promise<'completed' | 'awaiting_human' | 'queued' | 'failed'>;

const activeSeats = new Set<string>();
const activeTasks = new Set<Promise<void>>();

function seatKey(workshopId: string, seatId: string): string {
  return `${workshopId}/${seatId}`;
}

export async function drainQueuedDispatches(
  dataDir: string,
  workshopId: string,
  seatId: string,
  execute: DispatchExecutor = executeDispatchRecord,
): Promise<void> {
  const pending = (await listWorkshopDispatches(dataDir, workshopId))
    .filter(item => item.targetSeatId === seatId && (item.status === 'queued' || item.status === 'awaiting_human'));
  for (const item of pending) {
    if (item.status === 'awaiting_human') return;
    const result = await execute(dataDir, item);
    if (result === 'queued' || result === 'awaiting_human') return;
  }
}

export function kickDispatchQueue(dataDir: string, workshopId: string, seatId: string): void {
  const key = seatKey(workshopId, seatId);
  if (activeSeats.has(key)) return;
  activeSeats.add(key);
  const task = drainQueuedDispatches(dataDir, workshopId, seatId)
    .catch(error => console.error('[cyclone] 异步派发队列失败', error))
    .finally(() => {
      activeSeats.delete(key);
      activeTasks.delete(task);
    });
  activeTasks.add(task);
}

export async function completeAwaitingDispatch(
  dataDir: string,
  workshopId: string,
  seatId: string,
  response: string,
): Promise<void> {
  const item = (await listWorkshopDispatches(dataDir, workshopId))
    .find(candidate => candidate.targetSeatId === seatId && candidate.status === 'awaiting_human');
  if (!item) return;
  const room = item.sourceKind === 'seat'
    ? null
    : await loadRoom(dataDir, workshopId, item.sourceRoomId);
  const deadline = item.sourceKind === 'seat'
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
      }
    }
  }
  return failed;
}

export async function resumeCycloneDispatches(dataDir: string): Promise<void> {
  for (const workshop of await listWorkshops(dataDir)) {
    const queuedSeats = new Set(
      (await listWorkshopDispatches(dataDir, workshop.id))
        .filter(item => item.status === 'queued')
        .map(item => item.targetSeatId),
    );
    for (const seatId of queuedSeats) kickDispatchQueue(dataDir, workshop.id, seatId);
  }
}

export async function drainCycloneDispatches(): Promise<void> {
  while (activeTasks.size > 0) await Promise.all([...activeTasks]);
}
