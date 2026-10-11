import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollaborationContext, FeatureModule } from './contracts.js';
import { CollaborationRouter } from './router.js';

const context: CollaborationContext = {
  actor: { type: 'agent', id: 'agent-a', actingAs: 'human' }, audience: 'agent',
  enabledFeatures: new Set(['tide']), permissions: new Set(['observe']), requestId: 'session-a',
};

test('中心等待在订阅后精确返回同一运行的终态', async () => {
  let status: 'running' | 'completed' = 'running';
  let notify = () => undefined;
  let unsubscribed = 0;
  const router = new CollaborationRouter([operationModule({
    inspect: () => status,
    subscribe: (_identity, listener) => {
      notify = listener;
      return () => { unsubscribed += 1; };
    },
  })]);
  const waiting = router.waitOperation(
    'tide', { operationId: 'task-a', runId: 'run-a' }, context, 1_000,
  );
  await new Promise(resolve => setImmediate(resolve));
  status = 'completed';
  notify();
  const result = await waiting;
  assert.equal(result.fact.status, 'completed');
  assert.equal(result.timedOut, false);
  assert.equal(unsubscribed, 1);
});

test('中心等待先订阅再检查，终态不会落入竞态窗口', async () => {
  let status: 'running' | 'completed' = 'running';
  const router = new CollaborationRouter([operationModule({
    inspect: () => status,
    subscribe: (_identity, listener) => {
      status = 'completed';
      listener();
      return () => undefined;
    },
  })]);
  const result = await router.waitOperation(
    'tide', { operationId: 'task-a', runId: 'run-a' }, context, 1_000,
  );
  assert.equal(result.fact.status, 'completed');
  assert.equal(result.timedOut, false);
});

test('中心等待超时返回当前事实并释放订阅，不伪装业务失败', async () => {
  let unsubscribed = 0;
  const router = new CollaborationRouter([operationModule({
    inspect: () => 'running',
    subscribe: () => () => { unsubscribed += 1; },
  })]);
  const result = await router.waitOperation(
    'tide', { operationId: 'task-a', runId: 'run-a' }, context, 5,
  );
  assert.equal(result.fact.status, 'running');
  assert.equal(result.timedOut, true);
  assert.equal(unsubscribed, 1);
});

test('调用方中止中心等待后释放订阅并抛出中止原因', async () => {
  let unsubscribed = 0;
  const controller = new AbortController();
  const router = new CollaborationRouter([operationModule({
    inspect: () => 'running',
    subscribe: () => () => { unsubscribed += 1; },
  })]);
  const waiting = router.waitOperation(
    'tide', { operationId: 'task-a', runId: 'run-a' },
    { ...context, signal: controller.signal }, 1_000,
  );
  controller.abort(new Error('caller stopped'));
  await assert.rejects(waiting, /caller stopped/);
  assert.equal(unsubscribed, 1);
});

test('模块清单与运行等待通知口必须双向一致', () => {
  const missing = operationModule({ inspect: () => 'running', subscribe: () => () => {} });
  delete missing.operations!.subscribe;
  assert.throws(() => new CollaborationRouter([missing]), error =>
    (error as { data?: { code?: string } }).data?.code === 'FEATURE_OPERATION_WAIT_HANDLER_MISSING');

  const undeclared = operationModule({ inspect: () => 'running', subscribe: () => () => {} });
  undeclared.manifest.operation = { inspect: true, wait: false };
  assert.throws(() => new CollaborationRouter([undeclared]), error =>
    (error as { data?: { code?: string } }).data?.code === 'FEATURE_OPERATION_WAIT_HANDLER_UNDECLARED');
});

function operationModule(options: {
  inspect: () => 'running' | 'completed';
  subscribe: NonNullable<FeatureModule['operations']>['subscribe'];
}): FeatureModule {
  return {
    manifest: { id: 'tide', version: 1, title: '潮汐',
      operation: { inspect: true, wait: true }, methods: [{
      id: 'start', kind: 'command', permission: 'execute', audiences: ['internal'],
      inputSchema: { type: 'object' }, output: { mode: 'operation' },
    }] },
    handlers: { start: { parse: value => value, invoke: async () => ({}) } },
    operations: {
      inspect: async identity => ({
        ...identity, title: '任务 A', status: options.inspect(),
      }),
      subscribe: options.subscribe,
    },
  };
}
