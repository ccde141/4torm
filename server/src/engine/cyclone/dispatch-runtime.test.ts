import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch, loadDispatch } from './dispatch-store.js';
import { executeDispatchRecord } from './dispatch-runtime.js';

test('后台派发完成后写入回执与三轮决策期限', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-run-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 5,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '实现接口',
  });

  await executeDispatchRecord(dataDir, item, {
    executeSeat: async () => ({ content: '接口已经完成', awaitingHuman: false }),
    getCompletedRoundSeq: async () => 6,
  });

  const stored = await loadDispatch(dataDir, 'work-a', item.id);
  assert.equal(stored?.status, 'completed');
  assert.equal(stored?.response, '接口已经完成');
  assert.equal(stored?.decisionDeadlineRoundSeq, 9);
});

test('工位占用或挂起时派发保持排队而非伪装失败', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-run-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '实现接口',
  });

  await executeDispatchRecord(dataDir, item, {
    executeSeat: async () => { throw new Error('工位正在执行中'); },
    getCompletedRoundSeq: async () => 1,
  });
  assert.equal((await loadDispatch(dataDir, 'work-a', item.id))?.status, 'queued');
});

test('工位来源派发完成后不生成会议三轮决策期限', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-dispatch-run-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceKind: 'seat', sourceRoomId: '', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '实现接口',
    receiptState: 'pending',
  });

  await executeDispatchRecord(dataDir, item, {
    executeSeat: async () => ({ content: '接口已经完成', awaitingHuman: false }),
    getCompletedRoundSeq: async () => { throw new Error('工位派发不应读取会议轮次'); },
  });

  const stored = await loadDispatch(dataDir, 'work-a', item.id);
  assert.equal(stored?.status, 'completed');
  assert.equal(stored?.decisionState, 'not_applicable');
  assert.equal(stored?.decisionDeadlineRoundSeq, undefined);
});
