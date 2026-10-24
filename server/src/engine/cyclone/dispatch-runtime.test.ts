import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch, loadDispatch, updateDispatch } from './dispatch-store.js';
import { executeDispatchRecord } from './dispatch-runtime.js';
import { withdrawExpiredDispatch } from './dispatch-admission.js';
import { addSeat, loadSeat } from './seat-store.js';
import { createWorkshop } from './workshop-store.js';

test('真实派发执行只保存一份带派发身份的入站消息，重复领取不再次运行', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-input-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', model: 'test:model', config: { tools: [], toolMode: 'selected', skills: [] } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'test', baseUrl: 'https://example.test/v1', models: ['model'],
    providerType: 'openai-compatible', transport: 'openai-chat-completions',
  }] }));
  const workshop = await createWorkshop(dataDir);
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '核验' });
  const item = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '', sourceSeatId: 'seat-source',
    sourceSeatTitle: '资料', sourceTurnId: 'turn-input', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: target.id, targetSeatTitle: target.title, task: '核验相同内容',
  });
  let modelCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    modelCalls++;
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '核验完成' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 40, completion_tokens: 4, total_tokens: 44 } })}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } });
  });
  assert.equal(await executeDispatchRecord(dataDir, item), 'completed');
  assert.equal(await executeDispatchRecord(dataDir, item), 'completed');
  const incoming = (await loadSeat(dataDir, workshop.id, target.id))?.messages.filter(message => message.role === 'user');
  assert.equal(incoming?.length, 1);
  assert.equal(incoming?.[0].dispatchId, item.id);
  assert.equal(modelCalls, 1);
});

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
    targetPending: async () => false,
    getCompletedRoundSeq: async () => 6,
  });

  const stored = await loadDispatch(dataDir, 'work-a', item.id);
  assert.equal(stored?.status, 'completed');
  assert.equal(stored?.response, '接口已经完成');
  assert.equal(stored?.decisionDeadlineRoundSeq, 9);
});

test('工位占用或挂起时派发不接入也不伪装运行', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-run-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '实现接口',
  });

  await executeDispatchRecord(dataDir, item, {
    acquireTarget: () => null,
    executeSeat: async () => { throw new Error('未拿到工位锁时不应执行'); },
    targetPending: async () => false,
    getCompletedRoundSeq: async () => 1,
  });
  assert.equal((await loadDispatch(dataDir, 'work-a', item.id))?.status, 'queued');
  assert.equal((await loadDispatch(dataDir, 'work-a', item.id))?.delivered, false);
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
    targetPending: async () => false,
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
    targetPending: async () => false,
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
    targetPending: async () => false,
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
    targetPending: async () => false,
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

test('已接入后允许执行超过30秒，过期快照绝不再次调用目标', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-accepted-long-run-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const input = { workshopId: 'work-a', sourceKind: 'seat' as const, sourceRoomId: '',
    sourceSeatId: 'seat-a', sourceSeatTitle: '调度', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '核验', task: '核验' };
  const item = await createDispatch(dataDir, { ...input, sourceTurnId: 'long' });
  let finish!: () => void;
  let started!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const run = executeDispatchRecord(dataDir, item, { targetPending: async () => false,
    getCompletedRoundSeq: async () => 0, executeSeat: async current => {
      assert.equal(current.status, 'running'); assert.equal(current.delivered, true);
      started(); await pending;
      return { content: '完成', awaitingHuman: false, termination: { status: 'succeeded' } };
    } });
  await entered;
  assert.equal((await withdrawExpiredDispatch(dataDir, 'work-a', item.id,
    Date.parse(item.admissionDeadlineAt!) + 60_000))?.status, 'running');
  finish(); assert.equal(await run, 'completed');
  const expired = await createDispatch(dataDir, { ...input, sourceTurnId: 'expired' });
  await updateDispatch(dataDir, 'work-a', expired.id, { admissionDeadlineAt: '2020-01-01T00:00:00.000Z' });
  let executions = 0;
  assert.equal(await executeDispatchRecord(dataDir, expired, { targetPending: async () => false,
    getCompletedRoundSeq: async () => 0, executeSeat: async () => {
      executions++; return { content: '不应执行', awaitingHuman: false, termination: { status: 'succeeded' } };
    } }), 'failed');
  assert.equal(executions, 0);
  assert.equal((await loadDispatch(dataDir, 'work-a', expired.id))?.errorCode, 'CYCLONE_TARGET_BUSY');
});
