import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { tideRuntimeDir } from '../../../services/data-paths.js';
import { TideTaskService } from '../application/task-service.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { FileTideRunStateRepository } from '../infrastructure/run-state-repository.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { createTideFeature } from './factory.js';

const context: CollaborationContext = {
  actor: { type: 'agent', id: 'main', actingAs: 'human' },
  audience: 'agent', enabledFeatures: new Set(['tide']),
  permissions: new Set(['observe', 'design', 'execute', 'intervene', 'administer']),
  requestId: 'tide-delete-fact',
};

test('删除潮汐任务后清理新旧运行事实，Agent 查询只得到不存在', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const gateway = new AgentCollaborationGateway(router,
    async () => ({ toolMode: 'all', tools: [] }));
  const identity = { agentId: 'main', sessionId: 'session-main' };
  const removed = await feature.tasks.create(taskInput('待删除'));
  const kept = await feature.tasks.create(taskInput('保留'));
  const removedRun = await feature.runStates.create(removed.id, 'manual', 'main');
  await feature.runStates.finish(removed.id, removedRun.runId, 'completed');
  const keptRun = await feature.runStates.create(kept.id, 'manual', 'main');
  await feature.runStates.finish(kept.id, keptRun.runId, 'completed');
  const runs = new FileTideRunRepository(dataDir);
  await runs.save(record(removed.id, removedRun.runId, removedRun.createdAt));
  await runs.save(record(kept.id, keptRun.runId, keptRun.createdAt));
  const legacyFile = path.join(tideRuntimeDir(dataDir),
    `${createHash('sha256').update(removed.id).digest('hex')}.json`);
  await fs.writeFile(legacyFile, JSON.stringify({ ...removedRun,
    runId: 'tide-run-legacy', status: 'completed' }));

  const result = await gateway.invokeTool('delete_automation',
    { taskId: removed.id }, identity) as { deleted: boolean };
  assert.equal(result.deleted, true);
  assert.equal(await feature.runStates.get(removed.id), null);
  assert.deepEqual((await feature.runStates.listAll()).map(item => item.taskId), [kept.id]);
  assert.equal(await runs.get(removed.id, removedRun.runId), null);
  assert.ok(await runs.get(kept.id, keptRun.runId));
  assert.equal((await feature.runStates.get(kept.id))?.runId, keptRun.runId);
  await assert.rejects(fs.stat(legacyFile), { code: 'ENOENT' });

  const listed = await gateway.invokeTool('list_automations', {}, identity) as {
    items: Array<{ operationId: string }>;
  };
  assert.deepEqual(listed.items.map(item => item.operationId), [kept.id]);
  await assert.rejects(gateway.invokeTool('get_automation',
    { taskId: removed.id }, identity), isCode('TIDE_TASK_NOT_FOUND'));
  await assert.rejects(gateway.invokeTool('delete_automation',
    { taskId: removed.id }, identity), isCode('TIDE_TASK_NOT_FOUND'));
  await assert.rejects(router.inspectOperation('tide', {
    operationId: removed.id, runId: removedRun.runId,
  }, context), isCode('FEATURE_OPERATION_NOT_FOUND'));
  const found = await router.listOperationRecords('tide', {}, context);
  assert.deepEqual(found.items.map(item => item.operationId), [kept.id]);
  await assert.rejects(router.readOperationRecord('tide', {
    operationId: removed.id, runId: removedRun.runId,
  }, {}, context), isCode('RECORD_NOT_FOUND'));
});

test('旧版残留运行事实不让已删任务重新出现在索引或检查口', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const task = await feature.tasks.create(taskInput('已删'));
  const run = await feature.runStates.create(task.id, 'manual', 'main');
  await feature.runStates.finish(task.id, run.runId, 'failed', {
    code: 'TIDE_RUN_FAILED', message: '测试失败',
  });
  await new FileTideTaskRepository(dataDir).remove(task.id);
  const router = new CollaborationRouter([feature.module]);
  assert.equal((await feature.runStates.getRun(task.id, run.runId))?.status, 'failed');
  assert.deepEqual((await router.listOperationRecords('tide', {}, context)).items, []);
  await assert.rejects(router.inspectOperation('tide', {
    operationId: task.id, runId: run.runId,
  }, context), isCode('FEATURE_OPERATION_NOT_FOUND'));
  await assert.rejects(router.readOperationRecord('tide', {
    operationId: task.id, runId: run.runId,
  }, {}, context), isCode('RECORD_NOT_FOUND'));
});

test('运行事实清理失败会报告失败并保留任务供再次删除', async t => {
  const dataDir = await tempDataDir(t);
  const feature = createTideFeature({ dataDir });
  const task = await feature.tasks.create(taskInput('清理失败'));
  const run = await feature.runStates.create(task.id, 'manual', 'main');
  await feature.runStates.finish(task.id, run.runId, 'failed');
  class FailingRunStates extends FileTideRunStateRepository {
    override async removeTask(): Promise<void> { throw new Error('simulated delete failure'); }
  }
  const service = new TideTaskService(dataDir, new FileTideTaskRepository(dataDir),
    new FileTideRunRepository(dataDir), new FailingRunStates(dataDir), feature.scheduler);

  await assert.rejects(service.remove(task.id), /simulated delete failure/);
  assert.equal((await feature.tasks.detail(task.id)).task.id, task.id);
  assert.equal((await feature.runStates.getRun(task.id, run.runId))?.status, 'failed');
});

function taskInput(name: string) {
  return { name, schedule: 'every 5m', prompt: name, agentId: 'main' };
}

function record(taskId: string, runId: string, timestamp: string) {
  return { taskId, runId, timestamp, status: 'success' as const,
    sessionId: 'session-main', answer: '完成', rawContent: '完成',
    toolCalls: [], turns: 1, durationMs: 1 };
}

function isCode(code: string) {
  return (error: unknown) => error instanceof FrameworkError && error.data.code === code;
}

async function tempDataDir(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-delete-fact-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
