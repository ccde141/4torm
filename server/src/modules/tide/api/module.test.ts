import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { AgentToolOutput, type CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { createTideFeature } from './factory.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { FileTideRunStateRepository } from '../infrastructure/run-state-repository.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';

const context: CollaborationContext = {
  actor: { type: 'agent', id: 'main', actingAs: 'human' },
  audience: 'agent', enabledFeatures: new Set(['tide']),
  permissions: new Set(['observe']), requestId: 'request-1',
};

test('Tide listTasks exposes bounded truthful summaries without prompts', async (t) => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const repository = new FileTideTaskRepository(dataDir);
  const runStates = new FileTideRunStateRepository(dataDir);
  await repository.upsert(task('task-running', 'Running', true));
  await repository.upsert(task('task-paused', 'Paused', false));
  await repository.upsert({ ...task('task-done', 'Done', true), repeatCount: 0 });
  const run = await runStates.create('task-running', 'schedule');
  await runStates.markRunning('task-running', run.runId);
  const router = new CollaborationRouter([feature.module]);

  const first = await router.invoke({
    feature: 'tide', method: 'listTasks', input: {}, budget: { items: 2 },
  }, context) as { items: Array<Record<string, unknown>>; nextCursor?: string; truncated: boolean };

  assert.equal(first.items.length, 2);
  assert.equal(first.truncated, true);
  assert.ok(first.nextCursor);
  assert.equal(JSON.stringify(first).includes('private prompt'), false);
  assert.deepEqual(first.items.map(item => item.status), ['completed', 'idle']);

  const second = await router.invoke({
    feature: 'tide', method: 'listTasks', input: { cursor: first.nextCursor }, budget: { items: 2 },
  }, context) as { items: Array<Record<string, unknown>>; truncated: boolean };
  assert.deepEqual(second.items.map(item => item.status), ['running']);
  assert.equal(second.truncated, false);
});

test('Tide cursor becomes stale after the task catalog changes', async (t) => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const repository = new FileTideTaskRepository(dataDir);
  const runStates = new FileTideRunStateRepository(dataDir);
  await repository.upsert(task('task-a', 'A', false));
  await repository.upsert(task('task-b', 'B', false));
  const router = new CollaborationRouter([feature.module]);
  const first = await router.invoke({
    feature: 'tide', method: 'listTasks', input: {}, budget: { items: 1 },
  }, context) as { nextCursor: string };

  await repository.upsert(task('task-c', 'C', false));
  await assert.rejects(
    router.invoke({
      feature: 'tide', method: 'listTasks', input: { cursor: first.nextCursor }, budget: { items: 1 },
    }, context),
    (error: unknown) => error instanceof FrameworkError && error.data.code === 'TIDE_CURSOR_STALE',
  );
});

test('Agent 按所属 Agent 查任务并读取完整配置', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const repository = new FileTideTaskRepository(dataDir);
  await repository.upsert(task('task-a', 'A', false));
  await repository.upsert({ ...task('task-b', 'B', true), agentId: 'agent-b' });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]), async () => ({ toolMode: 'all', tools: [] }),
  );
  const identity = { agentId: 'main', sessionId: 'session-a' };
  const listed = await gateway.invokeTool('list_automations', { agentId: 'agent-a' }, identity) as {
    items: Array<{ operationId: string }>;
  };
  assert.deepEqual(listed.items.map(item => item.operationId), ['task-a']);
  const detail = await gateway.invokeTool('get_automation', { taskId: 'task-a' }, identity) as {
    task: { prompt: string; agentId: string; enabled: boolean };
  };
  assert.equal(detail.task.prompt, 'A private prompt');
  assert.equal(detail.task.agentId, 'agent-a');
  assert.equal(detail.task.enabled, false);
});

test('启用但尚未触发的潮汐任务不冒充已排队运行', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  await new FileTideTaskRepository(dataDir).upsert(task('task-a', 'A', true));
  const observed = await new CollaborationRouter([feature.module]).observe('tide', {}, context);
  assert.equal(observed.items[0]?.status, 'idle');
  assert.equal(observed.items[0]?.enabled, true);
  assert.equal(observed.items[0]?.schedule, 'every 5m');
  assert.equal(observed.items[0]?.runId, undefined);
});

test('Agent 通过中心工具创建未启用的自身潮汐草稿并保留展示事实', async t => {
  const dataDir = await tempDataDir(t);
  await writeAgent(dataDir, 'main');
  const feature = createTideFeature({ dataDir });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]), async () => ({ toolMode: 'all', tools: [] }),
  );
  const output = await gateway.invokeTool('create_automation', {
    name: '定时审计', schedule: 'every 5m', prompt: '检查最新状态',
    repeatCount: '3', windowN: '2', selfLoop: 'false', enabled: false,
  }, { agentId: 'main', sessionId: 'session-a' });

  assert.ok(output instanceof AgentToolOutput);
  assert.match(String(output.value), /已创建潮汐任务/);
  assert.equal(output.meta?.pendingAutomation &&
    (output.meta.pendingAutomation as { enabled?: boolean }).enabled, false);
  const tasks = await feature.tasks.list();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.agentId, 'main');
  assert.equal(tasks[0]?.enabled, false);
});

test('Agent 潮汐工具以稳定错误拒绝无效计划且不写半成品', async t => {
  const dataDir = await tempDataDir(t);
  await writeAgent(dataDir, 'main');
  const feature = createTideFeature({ dataDir });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]), async () => ({ toolMode: 'all', tools: [] }),
  );
  await assert.rejects(() => gateway.invokeTool('create_automation', {
    name: '过快任务', schedule: 'every 5s', prompt: '检查状态',
  }, { agentId: 'main', sessionId: 'session-a' }), error =>
    error instanceof FrameworkError && error.data.code === 'TIDE_AUTOMATION_INPUT_INVALID');
  await assert.rejects(() => gateway.invokeTool('create_automation', {
    name: '错误开关', schedule: 'every 5m', prompt: '检查状态', enabled: 'yes',
  }, { agentId: 'main', sessionId: 'session-a' }), error =>
    error instanceof FrameworkError && error.data.code === 'TIDE_AUTOMATION_INPUT_INVALID');
  assert.deepEqual(await feature.tasks.list(), []);
});

function task(id: string, name: string, enabled: boolean) {
  return {
    id, name, schedule: 'every 5m', prompt: `${name} private prompt`, agentId: 'agent-a',
    repeatCount: -1, pushMode: 'accumulate' as const, windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled,
    createdAt: `2026-09-29T00:00:0${id.endsWith('done') ? 3 : id.endsWith('paused') ? 2 : 1}.000Z`,
  };
}

test('Tide probe revision includes runtime state and rejects a cursor after execution starts', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const repository = new FileTideTaskRepository(dataDir);
  const runStates = new FileTideRunStateRepository(dataDir);
  await repository.upsert(task('task-a', 'A', true));
  await repository.upsert(task('task-b', 'B', true));
  const router = new CollaborationRouter([feature.module]);
  const first = await router.observe('tide', { limit: 1 }, context);
  const run = await runStates.create('task-a', 'manual');
  await runStates.markRunning('task-a', run.runId);
  const current = await router.observe('tide', { limit: 1 }, context);
  assert.notEqual(current.revision, first.revision);
  assert.equal(current.items[0]?.status, 'running');
  assert.equal(current.items[0]?.runId, run.runId);
  await assert.rejects(router.observe('tide', { cursor: first.nextCursor }, context),
    (error: unknown) => error instanceof FrameworkError && error.data.code === 'TIDE_CURSOR_STALE');

  await runStates.finish('task-a', run.runId, 'failed', {
    code: 'TIDE_RUN_FAILED', message: 'provider unavailable',
  });
  const failed = await router.observe('tide', { limit: 1 }, context);
  assert.equal(failed.items[0]?.status, 'failed');
  assert.equal(failed.items[0]?.errorCode, 'TIDE_RUN_FAILED');
  assert.equal(failed.items[0]?.errorMessage, 'provider unavailable');
});

test('Tide 运行终态通过中心等待口唤醒同一 runId', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const repository = new FileTideTaskRepository(dataDir);
  await repository.upsert(task('task-a', 'A', true));
  const run = await feature.runStates.create('task-a', 'manual', 'agent-a');
  await feature.runStates.markRunning('task-a', run.runId);
  const router = new CollaborationRouter([feature.module]);
  const waiting = router.waitOperation(
    'tide', { operationId: 'task-a', runId: run.runId }, context, 1_000,
  );
  await feature.runStates.finish('task-a', run.runId, 'completed');
  assert.equal((await waiting).fact.status, 'completed');
});

test('Tide 第二次触发后中心仍能检查第一次的运行句柄', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  await new FileTideTaskRepository(dataDir).upsert(task('task-a', 'A', true));
  const first = await feature.runStates.create('task-a', 'manual');
  await feature.runStates.finish('task-a', first.runId, 'completed');
  const second = await feature.runStates.create('task-a', 'manual');
  const router = new CollaborationRouter([feature.module]);
  assert.equal((await router.inspectOperation('tide', {
    operationId: 'task-a', runId: first.runId,
  }, context)).status, 'completed');
  assert.equal((await router.inspectOperation('tide', {
    operationId: 'task-a', runId: second.runId,
  }, context)).status, 'queued');
});

test('Tide 旧运行可由中心索引找到并按同一 runId 读取正文', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  await new FileTideTaskRepository(dataDir).upsert(task('task-a', 'A', true));
  const run = await feature.runStates.create('task-a', 'manual', 'agent-a');
  await feature.runStates.finish('task-a', run.runId, 'failed', {
    code: 'TIDE_RUN_FAILED', message: '执行失败',
  });
  const router = new CollaborationRouter([feature.module]);
  const found = await router.listOperationRecords('tide', { operationId: 'task-a' }, context);
  assert.deepEqual(found.items.map(item => item.runId), [run.runId]);
  assert.equal(found.items[0]?.agentId, 'agent-a');
  const attributed = await router.listOperationRecords('tide', { agentId: 'agent-a' }, context);
  assert.deepEqual(attributed.items.map(item => item.runId), [run.runId]);
  const page = await router.readOperationRecord('tide', {
    operationId: 'task-a', runId: run.runId,
  }, { maxTextChars: 4_000 }, context);
  assert.match(page.text, /TIDE_RUN_FAILED/);
  assert.match(page.text, /"detailAvailable": false/);
  await new FileTideRunRepository(dataDir).save({
    taskId: 'task-a', runId: run.runId, timestamp: run.createdAt,
    status: 'error', sessionId: 'session-a', answer: '', rawContent: '',
    toolCalls: [], turns: 0, durationMs: 1, error: '模型失败',
  });
  const detail = await router.readOperationRecord('tide', {
    operationId: 'task-a', runId: run.runId,
  }, { maxTextChars: 4_000 }, context);
  assert.match(detail.text, /"detailAvailable": true/);
  assert.match(detail.text, /模型失败/);
});

test('Tide 只有实际完成写入时才索引季风目标会话', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const repository = new FileTideTaskRepository(dataDir);
  await repository.upsert({ ...task('task-linked', 'Linked', true),
    pushMode: 'designated', targetSessionId: 'session-target' });
  const run = await feature.runStates.create('task-linked', 'manual', 'agent-a');
  await feature.runStates.finish('task-linked', run.runId, 'completed');
  const records = new FileTideRunRepository(dataDir);
  await records.save({ taskId: 'task-linked', runId: run.runId,
    timestamp: run.createdAt, status: 'success', sessionId: 'session-target',
    pushMode: 'designated', answer: '完成', rawContent: '完成',
    toolCalls: [], turns: 1, durationMs: 10 });
  const router = new CollaborationRouter([feature.module]);
  const found = await router.listOperationRecords('tide', { agentId: 'agent-a' }, context);
  assert.equal(found.items[0]?.linkedSessionId, 'session-target');
  assert.equal(found.items[0]?.sessionId, undefined);
});

test('潮汐历史归属沿用执行时 Agent，不随任务重新配置漂移', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const repository = new FileTideTaskRepository(dataDir);
  await repository.upsert(task('task-history', 'History', true));
  const run = await feature.runStates.create('task-history', 'manual');
  await feature.runStates.markRunning('task-history', run.runId, 'agent-a');
  await feature.runStates.finish('task-history', run.runId, 'failed', {
    code: 'TIDE_RUN_FAILED', message: '失败',
  });
  await repository.upsert({ ...task('task-history', 'History', true), agentId: 'agent-b' });
  const router = new CollaborationRouter([feature.module]);
  const probe = await router.observe('tide', { limit: 10 }, context);
  assert.equal(probe.items[0]?.agentId, 'agent-a');
  const oldAgent = await router.listOperationRecords('tide', { agentId: 'agent-a' }, context);
  const newAgent = await router.listOperationRecords('tide', { agentId: 'agent-b' }, context);
  assert.equal(oldAgent.items[0]?.runId, run.runId);
  assert.equal(newAgent.items.length, 0);
});

async function tempDataDir(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-s1-tide-module-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

async function writeAgent(dataDir: string, agentId: string): Promise<void> {
  const file = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));
  await fs.writeFile(file, JSON.stringify({ ...existing,
    [agentId]: { id: agentId, name: '主 Agent', model: 'test', config: { tools: [] } },
  }));
}
