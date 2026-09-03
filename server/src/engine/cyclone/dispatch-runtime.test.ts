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
    executeSeat: async () => ({
      content: '接口已经完成', awaitingHuman: false, termination: { status: 'succeeded' },
    }),
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
    executeSeat: async () => ({
      content: '接口已经完成', awaitingHuman: false, termination: { status: 'succeeded' },
    }),
    getCompletedRoundSeq: async () => { throw new Error('工位派发不应读取会议轮次'); },
  });

  const stored = await loadDispatch(dataDir, 'work-a', item.id);
  assert.equal(stored?.status, 'completed');
  assert.equal(stored?.decisionState, 'not_applicable');
  assert.equal(stored?.decisionDeadlineRoundSeq, undefined);
});

test('模型失败正文不能把后台派发伪装成完成', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-failed-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '实现接口',
  });

  const status = await executeDispatchRecord(dataDir, item, {
    executeSeat: async () => ({
      content: '[错误] 模型请求失败',
      awaitingHuman: false,
      termination: {
        status: 'failed',
        error: {
          code: 'MODEL_REQUEST_FAILED', kind: 'provider', message: '模型请求失败',
          source: 'react.native.model', retryable: false,
        },
      },
    }),
    getCompletedRoundSeq: async () => 1,
  });

  const stored = await loadDispatch(dataDir, 'work-a', item.id);
  assert.equal(status, 'failed');
  assert.equal(stored?.status, 'failed');
  assert.equal(stored?.error, '模型请求失败');
  assert.equal(stored?.errorCode, 'MODEL_REQUEST_FAILED');
  assert.equal(stored?.response, undefined);
});

test('后台执行失败会反向把父派发标记为失败', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-child-failed-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '训练模型',
  });

  const status = await executeDispatchRecord(dataDir, item, {
    executeSeat: async () => ({
      content: '训练已经在后台启动', awaitingHuman: false,
      termination: { status: 'succeeded' }, executionIds: ['exec-a'],
    }),
    getCompletedRoundSeq: async () => 1,
    waitExecutions: async () => [{
      executionId: 'exec-a', status: 'failed', error: 'process exited 1',
    }],
  });

  const stored = await loadDispatch(dataDir, 'work-a', item.id);
  assert.equal(status, 'failed');
  assert.equal(stored?.status, 'failed');
  assert.deepEqual(stored?.executionIds, ['exec-a']);
  assert.equal(stored?.errorCode, 'BACKGROUND_EXECUTION_FAILED');
});

test('后台执行未结束时父派发保持运行，全部完成后才完成', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-child-running-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '训练模型',
  });
  let settle!: (value: Array<{
    executionId: string;
    status: 'completed';
  }>) => void;
  const childSettled = new Promise<Array<{
    executionId: string;
    status: 'completed';
  }>>(resolve => { settle = resolve; });
  let notifyWaiting!: () => void;
  const waitingStarted = new Promise<void>(resolve => { notifyWaiting = resolve; });

  const running = executeDispatchRecord(dataDir, item, {
    executeSeat: async () => ({
      content: '训练完成', awaitingHuman: false,
      termination: { status: 'succeeded' }, executionIds: ['exec-a'],
    }),
    getCompletedRoundSeq: async () => 1,
    waitExecutions: async () => {
      notifyWaiting();
      return childSettled;
    },
  });

  await waitingStarted;
  assert.equal((await loadDispatch(dataDir, 'work-a', item.id))?.status, 'running');

  settle([{ executionId: 'exec-a', status: 'completed' }]);
  assert.equal(await running, 'completed');
  assert.equal((await loadDispatch(dataDir, 'work-a', item.id))?.status, 'completed');
});
