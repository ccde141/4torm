import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch, loadDispatch, updateDispatch } from './dispatch-store.js';
import { completeAwaitingDispatch, drainQueuedDispatches } from './dispatch-queue.js';
import { createRoom, saveRoom } from './room-store.js';
import { createWorkshop } from './workshop-store.js';

test('同一目标工位按创建顺序串行处理派发', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-queue-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  for (const task of ['first', 'second']) {
    await createDispatch(dataDir, {
      workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
      sourceSeatTitle: '架构', sourceTurnId: `turn-${task}`, sourceRoundSeq: 1,
      dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task,
    });
  }

  const order: string[] = [];
  await drainQueuedDispatches(dataDir, 'work-a', 'seat-b', async (_dir, item) => {
    order.push(item.task);
    return 'completed';
  });
  assert.deepEqual(order, ['first', 'second']);
});

test('目标仍忙时停止排队消费，后续任务不会越过', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-queue-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  for (const task of ['first', 'second']) {
    await createDispatch(dataDir, {
      workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
      sourceSeatTitle: '架构', sourceTurnId: `turn-${task}`, sourceRoundSeq: 1,
      dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task,
    });
  }

  const order: string[] = [];
  await drainQueuedDispatches(dataDir, 'work-a', 'seat-b', async (_dir, item) => {
    order.push(item.task);
    return 'queued';
  });
  assert.deepEqual(order, ['first']);
});

test('队首等待人类回答时后续派发不能越队', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-queue-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const first = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-first', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: 'first',
  });
  await updateDispatch(dataDir, 'work-a', first.id, { status: 'awaiting_human' });
  await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-second', sourceRoundSeq: 1,
    dispatchOrder: 1, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: 'second',
  });

  const executed: string[] = [];
  await drainQueuedDispatches(dataDir, 'work-a', 'seat-b', async (_dir, item) => {
    executed.push(item.task);
    return 'completed';
  });
  assert.deepEqual(executed, []);
});

test('人工回答完成后从当前完整轮次重新计算决策期限', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-queue-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const room = await createRoom(dataDir, workshop.id);
  room.completedRoundSeq = 5;
  await saveRoom(dataDir, workshop.id, room);
  const item = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: room.id, sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: 'first',
  });
  await updateDispatch(dataDir, workshop.id, item.id, { status: 'awaiting_human' });

  await completeAwaitingDispatch(dataDir, workshop.id, 'seat-b', '任务完成');
  const completed = await loadDispatch(dataDir, workshop.id, item.id);
  assert.equal(completed?.decisionDeadlineRoundSeq, 8);
});

test('工位来源派发经人工回答完成后不生成会议决策期限', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-dispatch-queue-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceKind: 'seat', sourceRoomId: '', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-a', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: 'first',
    receiptState: 'pending',
  });
  await updateDispatch(dataDir, 'work-a', item.id, { status: 'awaiting_human' });

  await completeAwaitingDispatch(dataDir, 'work-a', 'seat-b', '任务完成');
  const completed = await loadDispatch(dataDir, 'work-a', item.id);
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.decisionDeadlineRoundSeq, undefined);
});
