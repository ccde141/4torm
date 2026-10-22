import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { internalContext } from '../../../engine/collaboration/internal-context.js';
import { createTideFeature, type TideFeature } from '../api/factory.js';
import type { TideTask } from '../domain/task.js';
import type { TideRunRecord } from '../domain/run.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideTaskExecutor } from './scheduler.js';

test('每日任务在一秒扫描内经中心触发一次，并在执行前持久推进时点', async t => {
  let now = localTime(7, 59, 59);
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now });
  t.mock.method(Date, 'now', () => now);
  let executions = 0;
  const { feature, repository } = await fixture(t, async (_deps, task, manual, runId) => {
    executions += 1;
    assert.equal(manual, false);
    assert.equal((await repository.get(task.id))?.nextRun, tomorrowAtEight());
    return record(task, runId);
  });
  const task = await feature.tasks.create(input());
  feature.scheduler.start();
  await feature.scheduler.drain();
  assert.equal(executions, 0);

  now += 1_000;
  t.mock.timers.tick(1_000);
  await feature.scheduler.drain();
  const fact = await feature.runStates.get(task.id);
  assert.equal(executions, 1);
  assert.equal(fact?.trigger, 'schedule');
  assert.equal(fact?.status, 'completed');
  assert.ok(fact?.runId);
  await Promise.all([feature.scheduler.scanDue(), feature.scheduler.scanDue()]);
  assert.equal(executions, 1);

  feature.scheduler.stop();
  now += 86_400_000;
  t.mock.timers.tick(10_000);
  await feature.scheduler.drain();
  assert.equal(executions, 1);
  await assert.rejects(feature.scheduler.runScheduled(task.id),
    (error: unknown) => errorCode(error) === 'TIDE_TASK_NOT_DUE');
});

test('后端启动跳过旧每日时点，旧间隔任务仍维持到期触发语义', async t => {
  let now = localTime(8, 5);
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now });
  t.mock.method(Date, 'now', () => now);
  const executed: string[] = [];
  const { feature, repository } = await fixture(t, async (_deps, task, _manual, runId) => {
    executed.push(task.id);
    return record(task, runId);
  });
  const daily = await feature.tasks.create(input());
  const interval = await feature.tasks.create({ ...input(), schedule: 'every 5m' });
  await setDue(repository, daily, localTime(8));
  await setDue(repository, interval, localTime(8));

  feature.scheduler.start();
  await feature.scheduler.drain();
  assert.deepEqual(executed, [interval.id]);
  assert.equal(await feature.runStates.get(daily.id), null);
  assert.equal((await repository.get(daily.id))?.nextRun, tomorrowAtEight());
  feature.scheduler.stop();

  // A second start must not revive yesterday's saved due time either.
  now = localTime(8, 10);
  await setDue(repository, daily, localTime(8));
  feature.scheduler.start();
  await feature.scheduler.drain();
  assert.equal(executed.includes(daily.id), false);
  assert.equal((await repository.get(daily.id))?.nextRun, tomorrowAtEight());
});

test('每日任务忙碌时不重入，跨过触发时点后不补排', async t => {
  let now = localTime(7, 59, 50);
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(Date, 'now', () => now);
  const started = deferred<void>();
  const release = deferred<void>();
  let executions = 0;
  const { feature, repository } = await fixture(t, async (_deps, task, _manual, runId) => {
    executions += 1;
    started.resolve();
    await release.promise;
    return record(task, runId);
  });
  const task = await feature.tasks.create(input());
  await feature.scheduler.runNow(task.id);
  await started.promise;
  now = localTime(8);
  await feature.scheduler.scanDue();
  assert.equal(executions, 1);
  assert.equal(feature.scheduler.isRunning(task.id), true);
  now = localTime(8, 0, 5);
  release.resolve();
  await feature.scheduler.drain();
  await feature.scheduler.scanDue();
  assert.equal(executions, 1);
  assert.equal((await repository.get(task.id))?.nextRun, tomorrowAtEight());
});

test('睡眠或事件循环长暂停错过每日时点后不补跑', async t => {
  let now = localTime(7, 59, 59);
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(Date, 'now', () => now);
  let executions = 0;
  const { feature, repository } = await fixture(t, async (_deps, task, _manual, runId) => {
    executions += 1;
    return record(task, runId);
  });
  const task = await feature.tasks.create(input());
  await feature.scheduler.scanDue();
  now = localTime(9);
  await feature.scheduler.scanDue();
  assert.equal(executions, 0);
  assert.equal((await repository.get(task.id))?.nextRun, tomorrowAtEight());
});

test('每日任务暂停或次数耗尽不触发，中央定时入口也拒绝错过的旧时点', async t => {
  let now = localTime(7, 59, 59);
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(Date, 'now', () => now);
  const { feature, repository } = await fixture(t);
  const paused = await feature.tasks.create(input(), { enabled: false });
  const exhausted = await feature.tasks.create({ ...input(), repeatCount: 0 });
  const missed = await feature.tasks.create(input());
  now = localTime(8, 5);
  await setDue(repository, paused, localTime(8));
  await setDue(repository, exhausted, localTime(8));
  await assert.rejects(feature.scheduler.runScheduled(missed.id),
    (error: unknown) => errorCode(error) === 'TIDE_TASK_NOT_DUE');
  await feature.scheduler.scanDue();
  assert.equal(await feature.runStates.get(paused.id), null);
  assert.equal(await feature.runStates.get(exhausted.id), null);
  assert.equal(await feature.runStates.get(missed.id), null);
});

test('每日触发排期写入失败时保留失败事实，不执行模型或遗留 queued', async t => {
  let now = localTime(7, 59, 59);
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(Date, 'now', () => now);
  let executions = 0;
  const { feature } = await fixture(t, async (_deps, task, _manual, runId) => {
    executions += 1;
    return record(task, runId);
  });
  const task = await feature.tasks.create(input());
  now = localTime(8);
  t.mock.method(FileTideTaskRepository.prototype, 'reschedule', async () => {
    throw new Error('schedule disk unavailable');
  });
  await assert.rejects(feature.scheduler.runScheduled(task.id), /schedule disk unavailable/);
  assert.equal(executions, 0);
  assert.equal(feature.scheduler.isRunning(task.id), false);
  const fact = await feature.runStates.get(task.id);
  assert.equal(fact?.status, 'failed');
  assert.equal(fact?.errorCode, 'TIDE_SCHEDULE_ADVANCE_FAILED');
});

test('每日触发排期 CAS 冲突保留 aborted，不执行已经变更的任务', async t => {
  let now = localTime(7, 59, 59);
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(Date, 'now', () => now);
  let executions = 0;
  const { feature } = await fixture(t, async (_deps, task, _manual, runId) => {
    executions += 1;
    return record(task, runId);
  });
  const task = await feature.tasks.create(input());
  now = localTime(8);
  t.mock.method(FileTideTaskRepository.prototype, 'reschedule', async () => false);
  await assert.rejects(feature.scheduler.runScheduled(task.id),
    (error: unknown) => errorCode(error) === 'TIDE_TASK_PLAN_CHANGED');
  assert.equal(executions, 0);
  assert.equal(feature.scheduler.isRunning(task.id), false);
  assert.equal((await feature.runStates.get(task.id))?.status, 'aborted');
});

test('排期期间后端停止，不会把已排队每日任务推进到模型执行', async t => {
  let now = localTime(7, 59, 59);
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(Date, 'now', () => now);
  let executions = 0;
  const { feature } = await fixture(t, async (_deps, task, _manual, runId) => {
    executions += 1;
    return record(task, runId);
  });
  const task = await feature.tasks.create(input());
  now = localTime(8);
  const original = FileTideTaskRepository.prototype.reschedule;
  t.mock.method(FileTideTaskRepository.prototype, 'reschedule', async function (
    this: FileTideTaskRepository, ...args: Parameters<typeof original>
  ) {
    feature.scheduler.stop();
    return original.apply(this, args);
  });
  await feature.scheduler.runScheduled(task.id);
  await feature.scheduler.drain();
  assert.equal(executions, 0);
  assert.equal(feature.scheduler.isRunning(task.id), false);
  assert.equal((await feature.runStates.get(task.id))?.status, 'aborted');
});

test('每日任务的真实执行失败仍正确保存错误并安排下一天', async t => {
  const now = localTime(8, 1);
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(Date, 'now', () => now);
  const { feature, repository } = await fixture(t);
  const task = await feature.tasks.create(input());
  await feature.scheduler.runNow(task.id);
  await feature.scheduler.drain();
  const fresh = await repository.get(task.id);
  assert.equal(fresh?.nextRun, tomorrowAtEight());
  assert.equal(fresh?.consecutiveErrors, 1);
  assert.equal((await feature.runStates.get(task.id))?.status, 'failed');
});

function input() {
  return { name: '早晨简报', schedule: 'daily 08:00', prompt: '整理进展', agentId: 'missing-agent' };
}

function localTime(hour: number, minute = 0, second = 0): number {
  return new Date(2026, 9, 22, hour, minute, second).getTime();
}

function tomorrowAtEight(): string {
  return new Date(2026, 9, 23, 8).toISOString();
}

async function setDue(repository: FileTideTaskRepository, task: TideTask, due: number): Promise<void> {
  const current = await repository.get(task.id);
  assert.ok(current);
  await repository.upsert({ ...current, nextRun: new Date(due).toISOString() });
}

function record(task: TideTask, runId: string): TideRunRecord {
  return { taskId: task.id, runId, timestamp: new Date().toISOString(), status: 'success',
    sessionId: 'daily-session', answer: 'done', rawContent: 'done', toolCalls: [], turns: 1, durationMs: 1 };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function errorCode(error: unknown): string | undefined {
  return (error as { data?: { code?: string } })?.data?.code;
}

async function fixture(t: test.TestContext, execute?: TideTaskExecutor): Promise<{
  feature: TideFeature; repository: FileTideTaskRepository;
}> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-daily-'));
  const feature = createTideFeature({ dataDir, execute });
  const router = new CollaborationRouter([feature.module]);
  feature.scheduler.bindScheduledTrigger(taskId => router.invoke({
    feature: 'tide', method: 'triggerScheduledTask', input: { taskId },
  }, internalContext('tide.scheduler', 'daily-clock-test', 'tide')));
  t.after(async () => {
    feature.scheduler.stop();
    await feature.scheduler.drain();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { feature, repository: new FileTideTaskRepository(dataDir) };
}
