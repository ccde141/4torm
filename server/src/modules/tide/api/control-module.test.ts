import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { internalContext } from '../../../engine/collaboration/internal-context.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { createTideFeature } from './factory.js';

const context: CollaborationContext = {
  actor: { type: 'human', id: 'local-human', actingAs: 'human' },
  audience: 'human', enabledFeatures: new Set(['tide']),
  permissions: new Set(['observe', 'design', 'execute', 'intervene', 'administer']),
  requestId: 'request-control',
};

test('潮汐创建、修改、启停和删除统一经过中心路由', async (t) => {
  const feature = createTideFeature({ dataDir: await tempDataDir(t) });
  assert.deepEqual(Object.fromEntries(feature.module.manifest.methods.map(method => [
    method.id, method.output.mode,
  ])), {
    readTaskList: 'inline', readTaskDetail: 'inline', readTaskRuns: 'inline',
    readSessions: 'inline', readSession: 'inline',
    listTasks: 'inline', createTask: 'inline', updateTask: 'inline', toggleTask: 'inline',
    deleteTask: 'inline', deleteSession: 'inline', runTask: 'operation',
    triggerScheduledTask: 'operation', createAutomation: 'inline',
    updateAutomation: 'inline', setAutomationEnabled: 'inline',
    listTargetSessions: 'inline', getAutomation: 'inline', compactSession: 'inline',
  });
  const router = new CollaborationRouter([feature.module]);
  const created = await invoke(router, 'createTask', {
    name: 'task', schedule: 'every 5m', prompt: 'private', agentId: 'agent-a',
  }) as { taskId: string; task: { id: string; name: string } };
  assert.ok(created.taskId.startsWith('tide-'));
  assert.equal(created.task.id, created.taskId);

  const updated = await invoke(router, 'updateTask', {
    taskId: created.taskId, patch: { name: 'updated' },
  }) as { task: { name: string } };
  assert.equal(updated.task.name, 'updated');

  const toggled = await invoke(router, 'toggleTask', {
    taskId: created.taskId,
  }) as { task: { enabled: boolean } };
  assert.equal(toggled.task.enabled, false);

  await invoke(router, 'deleteTask', { taskId: created.taskId });
  assert.deepEqual(await feature.tasks.list(), []);
});

test('潮汐目标身份不接受跨目录路径', async t => {
  const feature = createTideFeature({ dataDir: await tempDataDir(t) });
  const router = new CollaborationRouter([feature.module]);
  await assert.rejects(invoke(router, 'createTask', {
    name: 'unsafe', schedule: 'every 5m', prompt: 'private', agentId: '../other',
  }));
  await assert.rejects(invoke(router, 'createTask', {
    name: 'unsafe', schedule: 'every 5m', prompt: 'private', agentId: 'agent-a',
    pushMode: 'designated', targetSessionId: '../other',
  }));
  assert.deepEqual(await feature.tasks.list(), []);
});

test('定时触发仅通过内部中心调用口接收，并保留 schedule 来源', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const created = await invoke(router, 'createTask', {
    name: 'scheduled', schedule: 'every 5m', prompt: 'work', agentId: 'missing-agent',
  }) as { taskId: string };
  const input = { taskId: created.taskId };
  await assert.rejects(() => invoke(router, 'triggerScheduledTask', input),
    (error: any) => error?.data?.code === 'CAPABILITY_AUDIENCE_DENIED');
  const repository = new FileTideTaskRepository(dataDir);
  const task = await repository.get(created.taskId);
  assert.ok(task);
  task.nextRun = new Date(0).toISOString();
  await repository.upsert(task);
  const internal = internalContext('tide.scheduler', 'tide-scheduler-test', 'tide');
  const accepted = await router.invoke({ feature: 'tide', method: 'triggerScheduledTask', input },
    internal) as { operationId: string; runId: string; accepted: boolean };
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.operationId, created.taskId);
  assert.ok(accepted.runId.startsWith('tide-run-'));
  const state = await feature.runStates.getRun(created.taskId, accepted.runId);
  assert.equal(state?.trigger, 'schedule');
  await feature.scheduler.drain();
});

test('定时扫描经中心路由投递并留下同一 runId 的运行事实', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const created = await invoke(router, 'createTask', {
    name: 'scan', schedule: 'every 5m', prompt: 'work', agentId: 'missing-agent',
  }) as { taskId: string };
  const repository = new FileTideTaskRepository(dataDir);
  const task = await repository.get(created.taskId);
  assert.ok(task);
  task.nextRun = new Date(0).toISOString();
  await repository.upsert(task);
  feature.scheduler.bindScheduledTrigger(taskId => router.invoke({
    feature: 'tide', method: 'triggerScheduledTask', input: { taskId },
  }, internalContext('tide.scheduler', 'scan-test', 'tide')));
  await feature.scheduler.scanDue();
  const fact = await feature.runStates.get(created.taskId);
  assert.ok(fact?.runId);
  assert.equal(fact.trigger, 'schedule');
  await feature.scheduler.drain();
  const observed = await router.inspectOperation('tide', {
    operationId: created.taskId, runId: fact.runId,
  }, context);
  assert.equal(observed.runId, fact.runId);
});

test('立即执行返回可追踪 runId，探针最终使用同一身份报告失败', async (t) => {
  const feature = createTideFeature({ dataDir: await tempDataDir(t) });
  const router = new CollaborationRouter([feature.module]);
  const created = await invoke(router, 'createTask', {
    name: 'task', schedule: 'every 5m', prompt: 'work', agentId: 'missing-agent',
  }) as { taskId: string };

  const accepted = await invoke(router, 'runTask', {
    taskId: created.taskId,
  }) as { accepted: boolean; operationId: string; runId: string };
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.operationId, created.taskId);
  assert.ok(accepted.runId.startsWith('tide-run-'));

  await feature.scheduler.drain();
  const observed = await router.observe('tide', { limit: 10 }, context);
  const item = observed.items.find(candidate => candidate.operationId === created.taskId);
  assert.equal(item?.status, 'failed');
  assert.equal(item?.runId, accepted.runId);
  assert.match(item?.errorMessage ?? '', /Agent 不存在/);
});

test('Agent manual runs retain notices; rejected human actions do not acknowledge them, accepted human input does', async t => {
  const dataDir = await tempDataDir(t);
  let begin!: () => void;
  let finish!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const feature = createTideFeature({ dataDir, execute: async (_deps, task) => {
    begin(); await finished;
    return { taskId: task.id, timestamp: new Date().toISOString(), status: 'success',
      sessionId: 'session-a', answer: 'done', rawContent: 'done', toolCalls: [], turns: 1, durationMs: 1 };
  } });
  const router = new CollaborationRouter([feature.module]);
  const created = await invoke(router, 'createTask', {
    name: 'check', schedule: 'every 5m', prompt: 'work', agentId: 'agent-a',
  }) as { taskId: string };
  const taskId = created.taskId;
  const prior = await feature.runStates.create(taskId, 'schedule');
  await feature.runStates.recordCompactionNotice(taskId, prior.runId, '模型离线');
  await feature.runStates.finish(taskId, prior.runId, 'completed');
  const agentContext: CollaborationContext = { ...context, audience: 'agent',
    actor: { type: 'agent', id: 'coordinator', actingAs: 'human' } };
  await router.invoke({ feature: 'tide', method: 'runTask', input: { taskId } }, agentContext);
  await started;
  assert.equal((await feature.runStates.get(taskId))?.compactionNotice, '模型离线');
  await assert.rejects(invoke(router, 'runTask', { taskId }));
  assert.equal((await feature.runStates.get(taskId))?.compactionNotice, '模型离线');
  finish(); await feature.scheduler.drain();
  await feature.tasks.update(taskId, { prompt: 'Agent updated task' });
  assert.equal((await feature.runStates.get(taskId))?.compactionNotice, '模型离线');
  await assert.rejects(invoke(router, 'updateTask', { taskId, patch: { schedule: 'invalid' } }));
  assert.equal((await feature.runStates.get(taskId))?.compactionNotice, '模型离线');
  await invoke(router, 'updateTask', { taskId, patch: { prompt: 'Human updated task' } });
  assert.equal((await feature.runStates.get(taskId))?.compactionNotice, undefined);
  const current = await feature.runStates.get(taskId);
  await feature.runStates.recordCompactionNotice(taskId, current!.runId, '新故障');
  await invoke(router, 'runTask', { taskId });
  await feature.scheduler.drain();
  assert.equal((await feature.runStates.get(taskId))?.compactionNotice, undefined);
  assert.equal((await feature.runStates.getRun(taskId, prior.runId))?.compactionNotice, '模型离线');
});

function invoke(router: CollaborationRouter, method: string, input: unknown): Promise<unknown> {
  return router.invoke({ feature: 'tide', method, input }, context);
}

async function tempDataDir(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-control-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
