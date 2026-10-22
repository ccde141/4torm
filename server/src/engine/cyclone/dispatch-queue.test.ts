import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch, loadDispatch, updateDispatch } from './dispatch-store.js';
import {
  completeAwaitingDispatch,
  drainCycloneDispatches,
  drainQueuedDispatches,
  kickDispatchQueue,
  clearDispatchAdmissionTimers,
  recoverCycloneDispatches,
  resumeCycloneDispatches,
} from './dispatch-queue.js';
import { createRoom, saveRoom } from './room-store.js';
import { createWorkshop } from './workshop-store.js';
import { addSeat, loadSeat, tryAcquireSeatLock } from './seat-store.js';
import { executeDispatchRecord } from './dispatch-runtime.js';
import { backgroundExecutions } from '../../services/background-execution.js';
import { retainAwaitingDispatchExecutions } from './dispatch-queue.js';

test('派发挂起前后创建的后台执行累计保留，恢复后等待真实终态且传播失败', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-resumed-dispatch-children-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '执行者' });
  const item = await createDispatch(dataDir, { workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '',
    sourceSeatId: 'source', sourceSeatTitle: '来源', sourceTurnId: 'turn', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: target.id, targetSeatTitle: target.title, task: '等待后台结果' });
  let complete!: () => void;
  let fail!: () => void;
  const first = await backgroundExecutions.start({ scope: 'cyclone', ownerId: `${workshop.id}:${target.id}`,
    label: '挂起前', graceMs: 0, run: () => new Promise<string>(resolve => { complete = () => resolve('完成'); }) });
  const second = await backgroundExecutions.start({ scope: 'cyclone', ownerId: `${workshop.id}:${target.id}`,
    label: '恢复时', graceMs: 0, run: () => new Promise<string>((_resolve, reject) => { fail = () => reject(new Error('child failed')); }) });
  const status = await executeDispatchRecord(dataDir, item, { targetPending: async () => false,
    getCompletedRoundSeq: async () => 0, executeSeat: async () => ({ content: '', awaitingHuman: true,
      termination: { status: 'waiting' }, executionIds: [first.executionId] }) });
  assert.equal(status, 'awaiting_human');
  assert.deepEqual((await loadDispatch(dataDir, workshop.id, item.id))?.executionIds, [first.executionId]);
  await retainAwaitingDispatchExecutions(dataDir, workshop.id, target.id, [second.executionId]);
  const resumed = completeAwaitingDispatch(dataDir, workshop.id, target.id, '模型已回复', [second.executionId]);
  let waiting = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await loadDispatch(dataDir, workshop.id, item.id))?.status === 'running') { waiting = true; break; }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(waiting);
  complete(); fail();
  await resumed;
  const stored = await loadDispatch(dataDir, workshop.id, item.id);
  assert.equal(stored?.status, 'failed');
  assert.equal(stored?.response, undefined);
  assert.equal(stored?.errorCode, 'BACKGROUND_EXECUTION_FAILED');
  assert.deepEqual(new Set(stored?.executionIds), new Set([first.executionId, second.executionId]));
});

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

test('队列运行期间再次 kick 会在当前任务结束后补扫新派发', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-kick-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const first = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-first', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: 'first',
  });
  let releaseFirst!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const holdFirst = new Promise<void>(resolve => { releaseFirst = resolve; });
  const executed: string[] = [];
  const execute = async (_dir: string, item: typeof first) => {
    executed.push(item.task);
    if (item.task === 'first') { markStarted(); await holdFirst; }
    await updateDispatch(dataDir, 'work-a', item.id, { status: 'completed' });
    return 'completed' as const;
  };

  kickDispatchQueue(dataDir, 'work-a', 'seat-b', execute);
  await started;
  await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-second', sourceRoundSeq: 1,
    dispatchOrder: 1, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: 'second',
  });
  kickDispatchQueue(dataDir, 'work-a', 'seat-b', execute);
  releaseFirst();
  await drainCycloneDispatches();

  assert.deepEqual(executed, ['first', 'second']);
});

test('补扫遇到 awaiting_human 时仍不执行后续派发', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-awaiting-kick-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const first = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-first', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: 'first',
  });
  let releaseFirst!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const holdFirst = new Promise<void>(resolve => { releaseFirst = resolve; });
  const executed: string[] = [];
  const execute = async (_dir: string, item: typeof first) => {
    executed.push(item.task);
    markStarted();
    await holdFirst;
    await updateDispatch(dataDir, 'work-a', item.id, { status: 'awaiting_human' });
    return 'awaiting_human' as const;
  };

  kickDispatchQueue(dataDir, 'work-a', 'seat-b', execute);
  await started;
  await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-second', sourceRoundSeq: 1,
    dispatchOrder: 1, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: 'second',
  });
  kickDispatchQueue(dataDir, 'work-a', 'seat-b', execute);
  releaseFirst();
  await drainCycloneDispatches();

  assert.deepEqual(executed, ['first']);
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

test('目标工作槽占用期间期限独立撤回，目标历史没有收到任务且重启不复活', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-unadmitted-timeout-'));
  t.after(async () => { clearDispatchAdmissionTimers(dataDir); await fs.rm(dataDir, { recursive: true, force: true }); });
  const workshop = await createWorkshop(dataDir);
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '核验' });
  const release = tryAcquireSeatLock(workshop.id, target.id)!;
  t.after(release);
  const item = await createDispatch(dataDir, { workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '',
    sourceSeatId: 'seat-source', sourceSeatTitle: '调度', sourceTurnId: 'turn-1', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: target.id, targetSeatTitle: target.title, task: '不要写进未接入历史' });
  await updateDispatch(dataDir, workshop.id, item.id, { admissionDeadlineAt: new Date(Date.now() + 60).toISOString() });
  kickDispatchQueue(dataDir, workshop.id, target.id);
  await drainCycloneDispatches();
  await new Promise(resolve => setTimeout(resolve, 150));
  await drainCycloneDispatches();
  const result = await loadDispatch(dataDir, workshop.id, item.id);
  assert.equal(result?.status, 'failed'); assert.equal(result?.delivered, false);
  assert.equal(result?.errorCode, 'CYCLONE_TARGET_BUSY');
  assert.deepEqual((await loadSeat(dataDir, workshop.id, target.id))?.messages, []);
  await recoverCycloneDispatches(dataDir);
  await resumeCycloneDispatches(dataDir);
  await drainCycloneDispatches();
  assert.equal((await loadDispatch(dataDir, workshop.id, item.id))?.status, 'failed');
  assert.deepEqual((await loadSeat(dataDir, workshop.id, target.id))?.messages, []);
});
