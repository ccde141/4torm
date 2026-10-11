import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { AgentToolOutput } from '../../../engine/collaboration/contracts.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { FileMonsoonSessionRepository } from '../../monsoon/infrastructure/session-repository.js';
import { resolveTarget, saveTurn } from '../sessions/session-resolver.js';
import { createTideFeature } from './factory.js';
import { createTradewindModule } from '../../tradewind/public.js';

test('潮汐旧开关继承新操作，关闭后不能调用，且不会授权其他功能区记录', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-switch-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir });
  const tradewind = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  let selected = ['list_automations'];
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module, tradewind]),
    async () => ({ toolMode: 'selected', tools: selected }),
  );
  const identity = { agentId: 'main' };
  assert.ok((await gateway.tools(identity)).some(tool => tool.name === 'get_automation'));
  assert.deepEqual((await gateway.invokeTool('list_automations', {}, identity) as { items: unknown[] }).items, []);
  await assert.rejects(gateway.invokeTool('find_operation_records', {
    feature: 'tradewind',
  }, identity), error => error instanceof FrameworkError && error.data.code === 'CAPABILITY_DISABLED');
  selected = [];
  assert.equal((await gateway.tools(identity)).some(tool => tool.name === 'get_automation'), false);
  await assert.rejects(gateway.invokeTool('get_automation', { taskId: 'missing' }, identity),
    error => error instanceof FrameworkError && error.data.code === 'CAPABILITY_DISABLED');
  await assert.rejects(gateway.invokeTool('find_operation_records', { feature: 'tide' }, identity),
    error => error instanceof FrameworkError && error.data.code === 'CAPABILITY_DISABLED');
});

test('Agent 从目标发现到运行记录完成指定会话任务闭环', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-agent-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await registerAgents(dataDir);
  const now = new Date().toISOString();
  const sessions = new FileMonsoonSessionRepository(dataDir);
  await sessions.create({ id: 'session-worker', agentId: 'worker', agentName: 'Worker',
    title: '工作记录', messages: [], model: 'test:model', systemPrompt: '',
    createdAt: now, updatedAt: now, revision: 1, messageRevision: 1 });
  const feature = createTideFeature({ dataDir, execute: async (deps, task, _manual, runId) => {
    const target = await resolveTarget(deps.dataDir, task);
    await saveTurn(deps.dataDir, task, target, 'Worker', 'test:model', '',
      task.prompt, '已完成巡检');
    const record = { taskId: task.id, runId, timestamp: new Date().toISOString(),
      status: 'success' as const, sessionId: target.sessionId,
      pushMode: task.pushMode, answer: '已完成巡检', rawContent: '已完成巡检',
      toolCalls: [], turns: 1, durationMs: 1 };
    await deps.runs.save(record);
    return record;
  } });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]), async () => ({
      toolMode: 'selected', tools: ['framework_capability_tide'],
    }),
  );
  const identity = { agentId: 'main', sessionId: 'session-main' };
  const available = await gateway.tools(identity);
  for (const name of ['list_automations', 'create_automation', 'run_automation',
    'get_automation', 'wait_operation', 'find_operation_records', 'read_operation_record']) {
    assert.ok(available.some(tool => tool.name === name), `${name} should follow Tide switch`);
  }

  const targets = await gateway.invokeTool('list_automation_targets', {
    agentId: 'worker',
  }, identity) as { items: Array<{ id: string }> };
  assert.deepEqual(targets.items.map(item => item.id), ['session-worker']);
  const created = await gateway.invokeTool('create_automation', {
    name: '资料巡检', schedule: 'every 5m', prompt: '检查资料',
    agentId: 'worker', pushMode: 'designated', targetSessionId: 'session-worker',
  }, identity) as AgentToolOutput;
  const taskId = (created.meta?.pendingAutomation as { taskId: string }).taskId;
  const detail = await gateway.invokeTool('get_automation', { taskId }, identity) as {
    task: { enabled: boolean; targetSessionId: string; agentId: string };
  };
  assert.equal(detail.task.enabled, true);
  assert.equal((await feature.tasks.list()).length, 1);
  assert.ok((await feature.tasks.detail(taskId)).task.nextRun);
  assert.equal(detail.task.agentId, 'worker');
  assert.equal(detail.task.targetSessionId, 'session-worker');

  await gateway.invokeTool('update_automation', {
    taskId, prompt: '检查资料与记录',
  }, identity);
  const revised = await gateway.invokeTool('get_automation', { taskId }, identity) as {
    task: { prompt: string };
  };
  assert.equal(revised.task.prompt, '检查资料与记录');
  await assert.rejects(gateway.invokeTool('update_automation', {
    taskId, enabled: false,
  }, identity), error => error instanceof FrameworkError
    && error.data.code === 'TIDE_AUTOMATION_INPUT_INVALID');

  const started = await gateway.invokeTool('run_automation', { taskId }, identity) as {
    operationId: string; runId: string;
  };
  let finished: { status: string } = { status: 'queued' };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    finished = await gateway.invokeTool('wait_operation', {
      feature: 'tide', operationId: taskId, runId: started.runId, timeoutMs: 1000,
    }, identity) as { status: string };
    if (!['queued', 'running'].includes(finished.status)) break;
  }
  assert.equal(finished.status, 'completed');
  const found = await gateway.invokeTool('find_operation_records', {
    feature: 'tide', agentId: 'worker', operationId: taskId,
  }, identity) as { items: Array<{ runId: string; linkedSessionId: string }> };
  assert.equal(found.items[0]?.runId, started.runId);
  assert.equal(found.items[0]?.linkedSessionId, 'session-worker');
  const record = await gateway.invokeTool('read_operation_record', {
    feature: 'tide', operationId: taskId, runId: started.runId,
  }, identity) as { text: string };
  assert.match(record.text, /已完成巡检/);
  const session = await sessions.get('worker', 'session-worker');
  assert.equal(session?.revision, 2);
  assert.deepEqual(session?.messages.map(message => message.content),
    ['检查资料与记录', '已完成巡检']);
  await feature.scheduler.drain();
});

test('指定会话无效时不创建任务', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-agent-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await registerAgents(dataDir);
  const feature = createTideFeature({ dataDir });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]), async () => ({ toolMode: 'all', tools: [] }),
  );
  await assert.rejects(gateway.invokeTool('create_automation', {
    name: '无效目标', schedule: 'every 5m', prompt: '检查',
    agentId: 'worker', pushMode: 'designated', targetSessionId: '../outside',
  }, { agentId: 'main' }), error =>
    error instanceof FrameworkError && error.data.code === 'TIDE_AUTOMATION_INPUT_INVALID');
  assert.deepEqual(await feature.tasks.list(), []);
});

test('Agent 为池内成员建任务后可幂等启停，手动运行返回同一可查询句柄', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-agent-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await registerAgents(dataDir);
  const feature = createTideFeature({ dataDir });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]), async () => ({ toolMode: 'all', tools: [] }),
  );
  const identity = { agentId: 'main', sessionId: 'session-main' };
  const created = await gateway.invokeTool('create_automation', {
    name: '文档巡检', schedule: 'every 5m', prompt: '检查文档变更', agentId: 'worker',
    enabled: false,
  }, identity) as AgentToolOutput;
  const taskId = (created.meta?.pendingAutomation as { taskId: string }).taskId;
  assert.equal((await feature.tasks.detail(taskId)).task.agentId, 'worker');
  assert.equal((await feature.tasks.detail(taskId)).task.enabled, false);
  await gateway.invokeTool('set_automation_enabled', { taskId, enabled: true }, identity);
  const firstNext = (await feature.tasks.detail(taskId)).task.nextRun;
  await gateway.invokeTool('set_automation_enabled', { taskId, enabled: true }, identity);
  assert.equal((await feature.tasks.detail(taskId)).task.nextRun, firstNext);
  const started = await gateway.invokeTool('run_automation', { taskId }, identity) as {
    operationId: string; runId: string; accepted: boolean;
  };
  assert.equal(started.operationId, taskId);
  assert.equal(started.accepted, true);
  assert.ok(started.runId);
  const inspected = await gateway.invokeTool('inspect_operation', {
    feature: 'tide', operationId: taskId, runId: started.runId,
  }, identity) as { runId: string };
  assert.equal(inspected.runId, started.runId);
  await feature.scheduler.drain();
  await gateway.invokeTool('set_automation_enabled', { taskId, enabled: false }, identity);
  assert.equal((await feature.tasks.detail(taskId)).task.enabled, false);
  const deleted = await gateway.invokeTool('delete_automation', { taskId }, identity) as {
    deleted: boolean;
  };
  assert.equal(deleted.deleted, true);
  assert.deepEqual(await feature.tasks.list(), []);
});

test('Agent 不能为不存在的成员建任务', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-agent-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await registerAgents(dataDir);
  const feature = createTideFeature({ dataDir });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]), async () => ({ toolMode: 'all', tools: [] }),
  );
  await assert.rejects(gateway.invokeTool('create_automation', {
    name: '失效目标', schedule: 'every 5m', prompt: '检查状态', agentId: 'missing',
  }, { agentId: 'main' }), error =>
    error instanceof FrameworkError && error.data.code === 'TIDE_AUTOMATION_INPUT_INVALID');
  assert.deepEqual(await feature.tasks.list(), []);
});

test('Agent 可按成员归属检索潮汐运行记录', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-agent-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await registerAgents(dataDir);
  const feature = createTideFeature({ dataDir });
  const task = await feature.tasks.create({
    name: '成员记录', schedule: 'every 5m', prompt: '巡检', agentId: 'worker',
  });
  const run = await feature.runStates.create(task.id, 'manual', 'worker');
  await feature.runStates.finish(task.id, run.runId, 'completed');
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]), async () => ({ toolMode: 'all', tools: [] }),
  );
  const found = await gateway.invokeTool('find_operation_records', {
    feature: 'tide', agentId: 'worker',
  }, { agentId: 'main' }) as { items: Array<{ runId: string }> };
  assert.deepEqual(found.items.map(item => item.runId), [run.runId]);
});

async function registerAgents(dataDir: string): Promise<void> {
  const file = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({
    main: { id: 'main', name: 'Main', model: 'test:model', config: { tools: [] } },
    worker: { id: 'worker', name: 'Worker', model: 'test:model', config: { tools: [] } },
  }));
}
