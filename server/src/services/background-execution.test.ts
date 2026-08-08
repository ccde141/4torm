import assert from 'node:assert/strict';
import test from 'node:test';
import { BackgroundExecutionCoordinator } from './background-execution.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('长任务在同步窗口后返回句柄，并可在完成后取回结果', async () => {
  const coordinator = new BackgroundExecutionCoordinator();
  const task = deferred<string>();
  const started = await coordinator.start({
    scope: 'conversation', ownerId: 'session-a', label: 'dev server', graceMs: 5,
    run: signal => new Promise<string>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      task.promise.then(resolve, reject);
    }),
  });

  assert.equal(started.status, 'running');
  task.resolve('server stopped');
  const completed = await coordinator.wait(started.executionId, 'conversation', 'session-a', 100);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result, 'server stopped');
});

test('短任务仍在当前工具调用内直接返回最终结果', async () => {
  const coordinator = new BackgroundExecutionCoordinator();
  const result = await coordinator.start({
    scope: 'conversation', ownerId: 'session-a', label: 'quick', graceMs: 100,
    run: async () => 'done',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.result, 'done');
});

test('查看和终止均受所有者隔离，终止操作幂等', async () => {
  const coordinator = new BackgroundExecutionCoordinator();
  const started = await coordinator.start({
    scope: 'cyclone', ownerId: 'workshop-a:seat-a', label: 'long', graceMs: 0,
    run: signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });

  assert.equal(coordinator.inspect(started.executionId, 'cyclone', 'workshop-a:seat-b'), undefined);
  assert.equal(await coordinator.terminate(started.executionId, 'cyclone', 'workshop-a:seat-b'), false);
  assert.equal(await coordinator.terminate(started.executionId, 'cyclone', 'workshop-a:seat-a'), true);
  const cancelled = await coordinator.wait(started.executionId, 'cyclone', 'workshop-a:seat-a', 100);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await coordinator.terminate(started.executionId, 'cyclone', 'workshop-a:seat-a'), false);
});

test('失败结果保留退出码，供工具桥接保持原有错误语义', async () => {
  const coordinator = new BackgroundExecutionCoordinator();
  const error = new Error('command failed') as Error & { exitCode: number };
  error.name = 'CommandExecutionError';
  error.exitCode = 7;
  const result = await coordinator.start({
    scope: 'conversation', ownerId: 'session-a', label: 'fail', graceMs: 100,
    run: async () => { throw error; },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 7);
});

test('终态记录按容量回收，但不回收仍运行的任务', async () => {
  const coordinator = new BackgroundExecutionCoordinator({ maxEntries: 2 });
  const running = await coordinator.start({
    executionId: 'running', scope: 'conversation', ownerId: 'session-a', label: 'running', graceMs: 0,
    run: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  });
  await coordinator.start({ executionId: 'old', scope: 'conversation', ownerId: 'session-a', label: 'old', run: async () => 'old' });
  await coordinator.start({ executionId: 'new', scope: 'conversation', ownerId: 'session-a', label: 'new', run: async () => 'new' });

  assert.equal(coordinator.inspect('old', 'conversation', 'session-a'), undefined);
  assert.equal(coordinator.inspect('new', 'conversation', 'session-a')?.status, 'completed');
  assert.equal(coordinator.inspect(running.executionId, 'conversation', 'session-a')?.status, 'running');
  await coordinator.terminate(running.executionId, 'conversation', 'session-a');
});

test('超过保留时间的终态结果会被清理', async () => {
  let now = 1_000;
  const coordinator = new BackgroundExecutionCoordinator({ retentionMs: 100, now: () => now });
  const result = await coordinator.start({
    scope: 'conversation', ownerId: 'session-a', label: 'quick', run: async () => 'done',
  });
  now += 101;
  assert.equal(coordinator.inspect(result.executionId, 'conversation', 'session-a'), undefined);
});

test('服务退出会终止并等待全部后台执行收口', async () => {
  const coordinator = new BackgroundExecutionCoordinator();
  const first = await coordinator.start({
    scope: 'conversation', ownerId: 'session-a', label: 'first', graceMs: 0,
    run: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  });
  const second = await coordinator.start({
    scope: 'cyclone', ownerId: 'workshop-a:seat-a', label: 'second', graceMs: 0,
    run: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  });

  await coordinator.shutdown();
  assert.equal(coordinator.inspect(first.executionId, 'conversation', 'session-a')?.status, 'cancelled');
  assert.equal(coordinator.inspect(second.executionId, 'cyclone', 'workshop-a:seat-a')?.status, 'cancelled');
});
