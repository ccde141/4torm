import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TideRunRecord } from '../domain/run.js';
import type { TideTask } from '../domain/task.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { FileTideRunStateRepository } from '../infrastructure/run-state-repository.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { TideScheduler } from './scheduler.js';

test('手动运行只有写入 queued 后才确认接收，并记录真实终态', async (t) => {
  const dataDir = await tempDataDir(t);
  const tasks = new FileTideTaskRepository(dataDir);
  const runs = new FileTideRunRepository(dataDir);
  const runStates = new FileTideRunStateRepository(dataDir);
  const task = tideTask();
  await tasks.upsert(task);
  const execution = deferred<TideRunRecord>();
  const started = deferred<void>();
  const scheduler = new TideScheduler({
    dataDir, tasks, runs, runStates,
    execute: async () => { started.resolve(); return execution.promise; },
  });

  const runId = await scheduler.runNow(task.id);
  assert.ok(runId?.startsWith('tide-run-'));
  await started.promise;
  const running = await runStates.get(task.id);
  assert.equal(running?.status, 'running');
  assert.equal(running?.trigger, 'manual');
  assert.equal(running?.runId, runId);
  assert.equal(running?.agentId, 'agent-a');

  execution.resolve(runRecord(task, 'success'));
  await scheduler.drain();
  const completed = await runStates.get(task.id);
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.runId, running?.runId);
});

test('模型失败结果映射为带原因的 failed 事实', async (t) => {
  const dataDir = await tempDataDir(t);
  const tasks = new FileTideTaskRepository(dataDir);
  const runs = new FileTideRunRepository(dataDir);
  const runStates = new FileTideRunStateRepository(dataDir);
  const task = tideTask();
  await tasks.upsert(task);
  const scheduler = new TideScheduler({
    dataDir, tasks, runs, runStates,
    execute: async () => runRecord(task, 'error', 'provider unavailable'),
  });

  assert.ok((await scheduler.runNow(task.id))?.startsWith('tide-run-'));
  await scheduler.drain();
  const failed = await runStates.get(task.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.errorCode, 'TIDE_RUN_FAILED');
  assert.equal(failed?.errorMessage, 'provider unavailable');
});

test('到期扫描只投递已绑定的中心入口，不直接创建运行记录', async t => {
  const dataDir = await tempDataDir(t);
  const tasks = new FileTideTaskRepository(dataDir);
  const runs = new FileTideRunRepository(dataDir);
  const runStates = new FileTideRunStateRepository(dataDir);
  const task = { ...tideTask(), nextRun: new Date(0).toISOString() };
  await tasks.upsert(task);
  const scheduler = new TideScheduler({ dataDir, tasks, runs, runStates });
  await assert.rejects(() => scheduler.scanDue(),
    (error: any) => error?.data?.code === 'TIDE_TRIGGER_UNBOUND');
  assert.throws(() => scheduler.start(),
    (error: any) => error?.data?.code === 'TIDE_TRIGGER_UNBOUND');
  const dispatched: string[] = [];
  scheduler.bindScheduledTrigger(async taskId => { dispatched.push(taskId); });
  await scheduler.scanDue();
  assert.deepEqual(dispatched, [task.id]);
  assert.equal(await runStates.get(task.id), null);
});

test('真实潮汐执行的状态句柄能精确找到同轮运行正文', async t => {
  const dataDir = await tempDataDir(t);
  const tasks = new FileTideTaskRepository(dataDir);
  const runs = new FileTideRunRepository(dataDir);
  const runStates = new FileTideRunStateRepository(dataDir);
  const task = tideTask();
  await tasks.upsert(task);
  const scheduler = new TideScheduler({ dataDir, tasks, runs, runStates });
  const runId = await scheduler.runNow(task.id);
  assert.ok(runId);
  await scheduler.drain();
  assert.equal((await runStates.getRun(task.id, runId))?.status, 'failed');
  const record = await runs.get(task.id, runId);
  assert.equal(record?.runId, runId);
  assert.equal(record?.status, 'error');
});

function tideTask(): TideTask {
  return {
    id: 'task-a', name: 'A', schedule: 'every 5m', prompt: 'work', agentId: 'agent-a',
    repeatCount: -1, pushMode: 'accumulate', windowN: 1, selfLoop: false,
    consecutiveErrors: 0, enabled: true, createdAt: new Date().toISOString(),
  };
}

function runRecord(task: TideTask, status: 'success' | 'error', error?: string): TideRunRecord {
  return {
    taskId: task.id, timestamp: new Date().toISOString(), status, sessionId: 'session-a',
    answer: '', rawContent: '', toolCalls: [], turns: 1, durationMs: 1, error,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function tempDataDir(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-scheduler-state-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
