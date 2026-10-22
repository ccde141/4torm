import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SessionRunner, type SessionRunnerOpts } from '../../../engine/conversation/session-runner.js';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { createTideFeature, type TideFeatureOptions } from '../api/factory.js';
import { resolveTarget, resolveTargetSessionId, saveTurn } from '../sessions/session-resolver.js';
import { readTideSession } from '../sessions/session-store.js';
import type { TideRunRecord } from '../domain/run.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { FileTideRunStateRepository } from '../infrastructure/run-state-repository.js';

test('Agent 中止当前潮汐轮次保留原会话和工具记录，不计失败、不停止计划', async t => {
  const fixture = await setup(t);
  const task = await fixture.feature.tasks.create({ name: '中止回归', agentId: 'worker',
    schedule: 'daily 08:00', prompt: '继续巡检', repeatCount: 5, windowN: 4 });
  const target = await resolveTarget(fixture.dataDir, task);
  await saveTurn(fixture.dataDir, task, target, 'Worker', 'test:model', '', '原始任务', '原始结果');
  const sessionId = resolveTargetSessionId(task);
  const before = await readTideSession(fixture.dataDir, task.agentId, sessionId);
  const ready = deferred<void>();
  t.mock.method(SessionRunner.prototype, 'chat', function(this: SessionRunner, _prompt, _messages, emit) {
    const signal = (Reflect.get(this, 'opts') as SessionRunnerOpts).signal!;
    emit({ type: 'tool-call', tool: 'fixture-tool', args: { limit: 3, checked: false } });
    emit({ type: 'tool-result', tool: 'fixture-tool', result: '已检查一部分', ok: true });
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      ready.resolve();
    });
  });
  const runId = await fixture.feature.tasks.runNow(task.id);
  await ready.promise;
  const receipt = await fixture.gateway.invokeTool('abort_automation', { taskId: task.id, runId }, fixture.identity);
  assert.deepEqual(receipt, { taskId: task.id, runId, accepted: true, status: 'aborting' });
  await fixture.feature.scheduler.drain();
  assert.equal((await fixture.feature.runStates.getRun(task.id, runId))?.status, 'aborted');
  const detail = await fixture.feature.tasks.detail(task.id);
  assert.equal(detail.recent[0].status, 'aborted');
  assert.deepEqual(detail.recent[0].toolCalls[0].args, { limit: 3, checked: false });
  assert.equal(detail.task.enabled, true);
  assert.equal(detail.task.repeatCount, 5);
  assert.equal(detail.task.consecutiveErrors, 0);
  assert.deepEqual((await readTideSession(fixture.dataDir, task.agentId, sessionId))?.messages, before?.messages);
  assert.deepEqual(await fixture.feature.tasks.abortRun(task.id, runId), {
    taskId: task.id, runId, accepted: false, status: 'aborted',
  });
});

test('中止按 taskId/runId 定位，旧轮次、其他任务及撤销权限均不影响当前执行', async t => {
  const admissions: Array<{ taskId: string; signal: AbortSignal }> = [];
  const fixture = await setup(t, { execute: async (deps, task) => {
    const signal = deps.runControl!.signal;
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      admissions.push({ taskId: task.id, signal });
    });
  } });
  const create = (name: string) => fixture.feature.tasks.create({ name, agentId: 'worker',
    schedule: 'every 5m', prompt: name });
  const [first, other] = await Promise.all([create('目标任务'), create('独立任务')]);
  const firstRun = await fixture.feature.tasks.runNow(first.id);
  const otherRun = await fixture.feature.tasks.runNow(other.id);
  await until(() => admissions.length === 2);
  await assert.rejects(fixture.feature.tasks.abortRun(other.id, firstRun), /不存在/);
  await fixture.feature.tasks.abortRun(first.id, firstRun);
  await until(() => !fixture.feature.scheduler.isRunning(first.id));
  assert.equal(admissions.find(item => item.taskId === other.id)?.signal.aborted, false);
  const nextRun = await fixture.feature.tasks.runNow(first.id);
  await until(() => admissions.length === 3);
  assert.equal((await fixture.feature.tasks.abortRun(first.id, firstRun)).accepted, false);
  assert.equal(admissions[2].signal.aborted, false);
  fixture.setEnabled(false);
  await assert.rejects(fixture.gateway.invokeTool('abort_automation', {
    taskId: first.id, runId: nextRun,
  }, fixture.identity), /未启用/);
  assert.equal(admissions[2].signal.aborted, false);
  fixture.setEnabled(true);
  await fixture.feature.tasks.abortRun(first.id, nextRun);
  await fixture.feature.tasks.abortRun(other.id, otherRun);
  await fixture.feature.scheduler.drain();
});

test('保存已开始时拒绝迟到中止，不能把已经提交的成功结果标记为中止', async t => {
  const saving = deferred<void>();
  const finish = deferred<void>();
  const fixture = await setup(t, { execute: async (deps, task, _manual, runId) => {
    deps.runControl!.beginCommit(); saving.resolve(); await finish.promise;
    const record: TideRunRecord = { taskId: task.id, runId, status: 'success', sessionId: 'saved',
      timestamp: new Date().toISOString(), answer: '完成', rawContent: '完成',
      toolCalls: [], turns: 0, durationMs: 1 };
    await deps.runs.save(record);
    return record;
  } });
  const task = await fixture.feature.tasks.create({ name: '保存回归', agentId: 'worker',
    schedule: 'every 5m', prompt: '保存' });
  const runId = await fixture.feature.tasks.runNow(task.id);
  await saving.promise;
  assert.deepEqual(await fixture.feature.tasks.abortRun(task.id, runId), {
    taskId: task.id, runId, accepted: false, status: 'running', reason: 'saving',
  });
  finish.resolve(); await fixture.feature.scheduler.drain();
  assert.equal((await fixture.feature.runStates.getRun(task.id, runId))?.status, 'completed');
  assert.equal((await fixture.feature.tasks.detail(task.id)).recent[0].status, 'success');
});

test('失败收口同样拒绝迟到中止，避免接收中止后又把该轮记录为失败', async t => {
  const fixture = await setup(t);
  const saving = deferred<void>();
  const finish = deferred<void>();
  const save = FileTideRunRepository.prototype.save;
  t.mock.method(SessionRunner.prototype, 'chat', async () => { throw new Error('真实推理失败'); });
  t.mock.method(FileTideRunRepository.prototype, 'save', async function(this: FileTideRunRepository, record) {
    if (record.status === 'error') { saving.resolve(); await finish.promise; }
    return save.call(this, record);
  });
  const task = await fixture.feature.tasks.create({ name: '失败封口', agentId: 'worker',
    schedule: 'every 5m', prompt: '执行' });
  const runId = await fixture.feature.tasks.runNow(task.id);
  await saving.promise;
  try {
    assert.deepEqual(await fixture.feature.tasks.abortRun(task.id, runId), {
      taskId: task.id, runId, accepted: false, status: 'running', reason: 'saving',
    });
  } finally { finish.resolve(); }
  await fixture.feature.scheduler.drain();
  const detail = await fixture.feature.tasks.detail(task.id);
  assert.equal(detail.runState?.status, 'failed');
  assert.equal(detail.recent[0].status, 'error');
  assert.equal(detail.task.consecutiveErrors, 1);
});

test('推理开始前的中止也留下同一 runId 的记录，且不进入模型', async t => {
  const fixture = await setup(t);
  const ready = deferred<void>();
  const proceed = deferred<void>();
  const markRunning = FileTideRunStateRepository.prototype.markRunning;
  t.mock.method(FileTideRunStateRepository.prototype, 'markRunning', async function(
    this: FileTideRunStateRepository, ...args
  ) {
    const state = await markRunning.apply(this, args);
    ready.resolve(); await proceed.promise; return state;
  });
  let calls = 0;
  t.mock.method(SessionRunner.prototype, 'chat', async () => { calls++; throw new Error('不应推理'); });
  const task = await fixture.feature.tasks.create({ name: '入队中止', agentId: 'worker',
    schedule: 'every 5m', prompt: '执行' });
  const runId = await fixture.feature.tasks.runNow(task.id);
  await ready.promise;
  await fixture.feature.tasks.abortRun(task.id, runId);
  proceed.resolve(); await fixture.feature.scheduler.drain();
  const detail = await fixture.feature.tasks.detail(task.id);
  assert.equal(calls, 0);
  assert.equal(detail.runState?.status, 'aborted');
  assert.equal(detail.recent[0].runId, runId);
  assert.equal(detail.recent[0].status, 'aborted');
  assert.equal(detail.task.consecutiveErrors, 0);
});

async function setup(t: test.TestContext, options: Omit<TideFeatureOptions, 'dataDir'> = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-abort-'));
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ worker: { id: 'worker', name: 'Worker',
    model: 'test:model', config: { tools: [], toolMode: 'selected' } } }));
  const feature = createTideFeature({ dataDir, ...options });
  t.after(async () => {
    feature.scheduler.stop();
    for (const task of await feature.tasks.list()) {
      const state = await feature.runStates.get(task.id);
      if (state && feature.scheduler.isRunning(task.id)) {
        await feature.scheduler.abortRun(task.id, state.runId);
      }
    }
    await feature.scheduler.drain();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  let enabled = true;
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([feature.module]),
    async () => ({ toolMode: 'selected', tools: enabled ? ['framework_capability_tide'] : [] }));
  return { dataDir, feature, gateway, identity: { agentId: 'main', sessionId: 'main-session' },
    setEnabled(value: boolean) { enabled = value; } };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

async function until(ready: () => boolean) {
  for (let count = 0; count < 100; count++) {
    if (ready()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('执行未达到预期状态');
}
