import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { AgentToolOutput } from '../../../engine/collaboration/contracts.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { createMonsoonExternalSessionPort } from '../../monsoon/public.js';
import { FileMonsoonSessionRepository } from '../../monsoon/infrastructure/session-repository.js';
import { createTideFeature, type TideFeature } from '../api/factory.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { resolveTarget, saveTurn } from '../sessions/session-resolver.js';
import { readTideSession } from '../sessions/session-store.js';
import { tideTaskSessionDir } from '../sessions/session-paths.js';
import type { SeasonSessionPort } from '../sessions/season-session-port.js';
import type { TideTaskExecutor } from '../runtime/scheduler.js';

test('Agent 换绑每日任务保留旧履历，并为往返换绑创建独立累积会话', async t => {
  const { dataDir, feature, gateway } = await fixture(t);
  const created = await gateway.invokeTool('create_automation', {
    name: '每日检查', schedule: 'daily 08:00', prompt: '检查资料', agentId: 'first',
    windowN: '4', enabled: false,
  }, identity) as AgentToolOutput;
  const taskId = (created.meta?.pendingAutomation as { taskId: string }).taskId;
  const original = (await feature.tasks.detail(taskId)).task;
  const resolved = await resolveTarget(dataDir, original);
  const saved = await saveTurn(dataDir, original, resolved, 'First', 'test:model', '', '旧任务', '原始结果');
  await new FileTideTaskRepository(dataDir).upsert({ ...original, ...saved, archiveBatch: 3 });
  const originalFile = path.join(tideTaskSessionDir(dataDir, 'first', taskId, original.name), `${saved.targetSessionId}.json`);
  const oldBytes = await fs.readFile(originalFile, 'utf8');
  const runs = new FileTideRunRepository(dataDir);
  await runs.save({ taskId, runId: 'before-rebind', agentId: 'first', sessionId: saved.targetSessionId,
    timestamp: new Date().toISOString(), status: 'success', answer: '原始结果', rawContent: '原始结果',
    toolCalls: [], turns: 1, durationMs: 1 });

  const output = await gateway.invokeTool('update_automation', { taskId, agentId: 'second' }, identity) as AgentToolOutput;
  assert.match(String(output.value), /目标 Agent: second/);
  const changed = (await gateway.invokeTool('get_automation', { taskId }, identity) as {
    task: typeof original;
  }).task;
  assert.equal(changed.agentId, 'second');
  assert.equal(changed.enabled, false);
  assert.equal(changed.schedule, 'daily 08:00');
  assert.equal(changed.roundSeq, 0);
  assert.equal(changed.archiveBatch, 3);
  assert.notEqual(changed.targetSessionId, saved.targetSessionId);
  assert.deepEqual((await resolveTarget(dataDir, changed)).history, []);
  assert.equal((await runs.get(taskId, 'before-rebind'))?.agentId, 'first');
  const back = await feature.tasks.update(taskId, { agentId: 'first' });
  assert.notEqual(back.targetSessionId, saved.targetSessionId);
  assert.notEqual(back.targetSessionId, changed.targetSessionId);
  await saveTurn(dataDir, back, await resolveTarget(dataDir, back), 'First', 'test:model', '', '新任务', '新结果');
  assert.equal(await fs.readFile(originalFile, 'utf8'), oldBytes);
  assert.equal((await readTideSession(dataDir, 'first', saved.targetSessionId))?.messages[1]?.content, '原始结果');
});

test('换绑指定季风会话必须明确提供新归属，失败不改变任务和任一会话', async t => {
  const { feature, sessions } = await fixture(t);
  const task = await feature.tasks.create({ ...input, pushMode: 'designated', targetSessionId: 'first-session' });
  await assert.rejects(feature.tasks.update(task.id, { agentId: 'second' }), invalid);
  await assert.rejects(feature.tasks.update(task.id, { agentId: 'second', targetSessionId: 'first-session' }), invalid);
  assert.equal((await feature.tasks.detail(task.id)).task.agentId, 'first');
  const before = await sessions.get('first', 'first-session');
  const updated = await feature.tasks.update(task.id, { agentId: 'second', targetSessionId: 'second-session' });
  assert.equal(updated.targetSessionId, 'second-session');
  assert.equal(updated.agentId, 'second');
  assert.deepEqual(await sessions.get('first', 'first-session'), before);
  assert.equal((await sessions.get('second', 'second-session'))?.messages.length, 0);
  await assert.rejects(feature.tasks.update(task.id, {
    agentId: 'first', pushMode: 'accumulate', targetSessionId: 'second-session',
  }), invalid);
  assert.equal((await feature.tasks.detail(task.id)).task.agentId, 'second');
});

test('人类更新入口拒绝不存在、空白、路径和非字符串 Agent，真实换绑不再静默忽略', async t => {
  const { feature } = await fixture(t);
  const task = await feature.tasks.create(input);
  const router = new CollaborationRouter([feature.module]);
  const human = { actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const },
    audience: 'human' as const, enabledFeatures: new Set(['tide']), permissions: new Set(['design' as const]),
    requestId: 'reassign-human' };
  for (const agentId of ['missing', ' ', '../second', 12, null]) {
    await assert.rejects(router.invoke({ feature: 'tide', method: 'updateTask',
      input: { taskId: task.id, patch: { agentId } } }, human), invalid);
  }
  const result = await router.invoke({ feature: 'tide', method: 'updateTask',
    input: { taskId: task.id, patch: { agentId: 'second' } } }, human) as { task: { agentId: string } };
  assert.equal(result.task.agentId, 'second');
});

test('运行或压缩占用任务时拒绝换绑，释放后可修改', async t => {
  const { feature } = await fixture(t);
  const task = await feature.tasks.create(input);
  const entered = deferred();
  const hold = deferred();
  const operation = feature.scheduler.exclusive(task.id, async () => {
    entered.resolve();
    await hold.promise;
    return true;
  });
  await entered.promise;
  try {
    await assert.rejects(feature.tasks.update(task.id, { agentId: 'second' }), busy);
    await assert.rejects(feature.tasks.update(task.id, { prompt: '不能覆盖执行中内容' }), busy);
    assert.equal((await feature.tasks.detail(task.id)).task.agentId, 'first');
    await feature.tasks.setEnabled(task.id, false);
    assert.equal((await feature.tasks.detail(task.id)).task.enabled, false);
  } finally { hold.resolve(); await operation; }
  assert.equal((await feature.tasks.update(task.id, { agentId: 'second' })).agentId, 'second');
});

test('目标季风会话被执行或压缩租约占用时，换绑拒绝且释放已获得的旧租约', async t => {
  const { feature, port } = await fixture(t);
  const task = await feature.tasks.create({ ...input, pushMode: 'designated', targetSessionId: 'first-session' });
  const release = port.acquire('second', 'second-session');
  assert.ok(release);
  try {
    await assert.rejects(feature.tasks.update(task.id, { agentId: 'second', targetSessionId: 'second-session' }), busy);
    const releaseOld = port.acquire('first', 'first-session');
    assert.ok(releaseOld);
    releaseOld();
  } finally { release(); }
  assert.equal((await feature.tasks.update(task.id, { agentId: 'second', targetSessionId: 'second-session' })).agentId, 'second');
});

test('换绑验证中的并发运行被拒绝，并发暂停不会被旧配置覆盖', async t => {
  const entered = deferred();
  const hold = deferred();
  const { feature } = await fixture(t, port => ({ ...port, read: async (agentId, sessionId) => {
    if (agentId === 'second') { entered.resolve(); await hold.promise; }
    return port.read(agentId, sessionId);
  } }));
  const task = await feature.tasks.create(input);
  const changing = feature.tasks.update(task.id, { agentId: 'second', pushMode: 'designated', targetSessionId: 'second-session' });
  await entered.promise;
  const paused = feature.tasks.setEnabled(task.id, false);
  try {
    await assert.rejects(feature.tasks.runNow(task.id), busy);
    await assert.rejects(feature.tasks.removeSession(task.id), busy);
  }
  finally { hold.resolve(); }
  await changing;
  await paused;
  const stored = (await feature.tasks.detail(task.id)).task;
  assert.equal(stored.agentId, 'second');
  assert.equal(stored.enabled, false);
  assert.equal((await feature.tasks.readSession('second', 'second-session')).messages.length, 0);
});

test('暂停后仍在执行的一轮不能被删除当前会话，结束后删除才生效', async t => {
  const entered = deferred();
  const hold = deferred();
  const { dataDir, feature } = await fixture(t, value => value, async (_deps, task, _manual, runId) => {
    entered.resolve();
    await hold.promise;
    return { taskId: task.id, runId, agentId: task.agentId, timestamp: new Date().toISOString(),
      status: 'success', answer: '完成', rawContent: '完成', toolCalls: [], turns: 1, durationMs: 1 };
  });
  const task = await feature.tasks.create(input);
  const resolved = await resolveTarget(dataDir, task);
  const saved = await saveTurn(dataDir, task, resolved, 'First', 'test:model', '', '已保存输入', '已有结果');
  await new FileTideTaskRepository(dataDir).upsert({ ...task, ...saved });
  await feature.tasks.runNow(task.id);
  await entered.promise;
  try {
    await feature.tasks.setEnabled(task.id, false);
    await assert.rejects(feature.tasks.removeSession(task.id), busy);
    assert.ok(await readTideSession(dataDir, 'first', saved.targetSessionId));
    assert.equal((await feature.tasks.detail(task.id)).task.targetSessionId, saved.targetSessionId);
  } finally { hold.resolve(); await feature.scheduler.drain(); }
  await feature.tasks.removeSession(task.id);
  const activeFile = path.join(tideTaskSessionDir(dataDir, 'first', task.id, task.name), `${saved.targetSessionId}.json`);
  await assert.rejects(fs.access(activeFile), (error: unknown) =>
    (error as NodeJS.ErrnoException).code === 'ENOENT');
  assert.ok(await readTideSession(dataDir, 'first', saved.targetSessionId), '归档仍可查阅');
  assert.equal((await feature.tasks.detail(task.id)).task.targetSessionId, undefined);
});

const identity = { agentId: 'first', sessionId: 'human-conversation' };
const input = { name: '检查', agentId: 'first', schedule: 'daily 08:00', prompt: '检查资料' };

async function fixture(t: test.TestContext,
  wrapPort: (port: SeasonSessionPort) => SeasonSessionPort = value => value,
  execute?: TideTaskExecutor,
) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-reassign-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify(Object.fromEntries(['first', 'second'].map(id =>
    [id, { id, name: id, model: 'test:model', config: { tools: [] } }]))));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  for (const agentId of ['first', 'second']) {
    const now = new Date().toISOString();
    await sessions.create({ id: `${agentId}-session`, agentId, agentName: agentId, title: agentId,
      model: 'test:model', systemPrompt: '', messages: [], createdAt: now, updatedAt: now,
      revision: 1, messageRevision: 1 });
  }
  const source = createMonsoonExternalSessionPort(dataDir);
  const port = wrapPort({ acquire: source.acquire.bind(source), read: source.read.bind(source),
    activeContext: source.activeContext.bind(source), list: source.list.bind(source),
    append: source.append.bind(source), recordUsage: source.recordUsage.bind(source),
    archive: source.archive.bind(source), commitCompaction: source.commitCompaction.bind(source) });
  const feature: TideFeature = createTideFeature({ dataDir, seasonSessions: port, execute });
  t.after(() => feature.scheduler.drain());
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([feature.module]),
    async () => ({ toolMode: 'all', tools: [] }));
  return { dataDir, feature, gateway, sessions, port };
}

function invalid(error: unknown): boolean {
  return error instanceof FrameworkError && error.data.code === 'TIDE_TASK_INPUT_INVALID';
}
function busy(error: unknown): boolean {
  return error instanceof FrameworkError && error.data.code === 'TIDE_TASK_RUNNING';
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
