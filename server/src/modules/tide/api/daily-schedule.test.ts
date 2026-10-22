import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { AgentToolOutput, CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import type { TideTask } from '../domain/task.js';
import { createTideFeature } from './factory.js';

const identity = { agentId: 'main', sessionId: 'daily-test' };
const human: CollaborationContext = {
  actor: { type: 'human', id: 'daily-human', actingAs: 'human' }, audience: 'human',
  enabledFeatures: new Set(['tide']),
  permissions: new Set(['observe', 'design', 'intervene']), requestId: 'daily-human',
};

test('Agent daily 计划沿中心工具创建、回读并展示本地整点的下一次时间', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: localTime(3, 7, 59) });
  const { gateway, feature, router } = await fixture(t);
  const taskId = await create(gateway, 'daily 08:00');
  const result = await gateway.invokeTool('get_automation', { taskId }, identity) as { task: TideTask };
  assert.equal(result.task.schedule, 'daily 08:00');
  assert.equal(result.task.nextRun, localTime(3, 8).toISOString());
  assert.equal(result.task.enabled, true);
  assert.equal(result.task.agentId, 'worker');

  const listed = await gateway.invokeTool('list_automations', {}, identity) as {
    items: Array<{ operationId: string; schedule: string }>;
  };
  assert.deepEqual(listed.items.map(item => [item.operationId, item.schedule]), [[taskId, 'daily 08:00']]);
  const humanDetail = await router.invoke({ feature: 'tide', method: 'readTaskDetail',
    input: { taskId } }, human) as { task: TideTask };
  assert.deepEqual(humanDetail.task, result.task);
  assert.equal((await feature.tasks.list()).length, 1);
});

test('daily 草稿启用及跨日暂停后恢复仅安排未来，重复启用保持原计划', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: localTime(3, 7, 59) });
  const { gateway, feature } = await fixture(t);
  const taskId = await create(gateway, 'daily 08:00', false);
  assert.equal((await feature.tasks.detail(taskId)).task.nextRun, undefined);
  assert.equal((await feature.tasks.detail(taskId)).task.enabled, false);

  t.mock.timers.setTime(localTime(3, 8).getTime());
  await gateway.invokeTool('set_automation_enabled', { taskId, enabled: true }, identity);
  const scheduled = (await feature.tasks.detail(taskId)).task.nextRun;
  assert.equal(scheduled, localTime(4, 8).toISOString());
  t.mock.timers.setTime(localTime(3, 9).getTime());
  await gateway.invokeTool('set_automation_enabled', { taskId, enabled: true }, identity);
  assert.equal((await feature.tasks.detail(taskId)).task.nextRun, scheduled);

  await gateway.invokeTool('set_automation_enabled', { taskId, enabled: false }, identity);
  t.mock.timers.setTime(localTime(6, 10).getTime());
  await gateway.invokeTool('set_automation_enabled', { taskId, enabled: true }, identity);
  const resumed = (await feature.tasks.detail(taskId)).task;
  assert.equal(resumed.nextRun, localTime(7, 8).toISOString());
  assert.equal((await feature.tasks.listRuns(taskId, 10)).length, 0);
});

test('修改 daily 时刻及 every 切换即时重排未来计划，草稿修改保持未启用', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: localTime(3, 10) });
  const { gateway, feature } = await fixture(t);
  const taskId = await create(gateway, 'every 5m');
  assert.equal((await feature.tasks.detail(taskId)).task.nextRun, localTime(3, 10, 5).toISOString());
  await gateway.invokeTool('update_automation', { taskId, schedule: 'daily 09:00' }, identity);
  assert.equal((await feature.tasks.detail(taskId)).task.nextRun, localTime(4, 9).toISOString());
  await gateway.invokeTool('update_automation', { taskId, schedule: 'daily 11:00' }, identity);
  assert.equal((await feature.tasks.detail(taskId)).task.nextRun, localTime(3, 11).toISOString());
  await gateway.invokeTool('update_automation', { taskId, schedule: 'every 1m' }, identity);
  assert.equal((await feature.tasks.detail(taskId)).task.nextRun, localTime(3, 10, 1).toISOString());
  await assert.rejects(gateway.invokeTool('update_automation', { taskId, schedule: 'every 59s' }, identity));
  assert.equal((await feature.tasks.detail(taskId)).task.schedule, 'every 1m');

  const draftId = await create(gateway, 'daily 08:00', false);
  await gateway.invokeTool('update_automation', { taskId: draftId, schedule: 'daily 16:00' }, identity);
  const draft = (await feature.tasks.detail(draftId)).task;
  assert.equal(draft.enabled, false);
  assert.equal(draft.nextRun, undefined);
  t.mock.timers.setTime(localTime(3, 17).getTime());
  await gateway.invokeTool('set_automation_enabled', { taskId: draftId, enabled: true }, identity);
  assert.equal((await feature.tasks.detail(draftId)).task.nextRun, localTime(4, 16).toISOString());
});

test('人类更新启用标记恢复 daily 任务同样重排未来，非法计划不会创建或覆盖任务', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: localTime(3, 7) });
  const { gateway, feature, router } = await fixture(t);
  const taskId = await create(gateway, 'daily 08:00');
  await router.invoke({ feature: 'tide', method: 'updateTask',
    input: { taskId, patch: { enabled: false } } }, human);
  t.mock.timers.setTime(localTime(8, 9).getTime());
  await router.invoke({ feature: 'tide', method: 'updateTask',
    input: { taskId, patch: { enabled: true } } }, human);
  assert.equal((await feature.tasks.detail(taskId)).task.nextRun, localTime(9, 8).toISOString());

  for (const schedule of ['daily 24:00', 'daily 08:60', 'daily 8:00', 'daily 08:00 UTC', 'every 59s']) {
    await assert.rejects(create(gateway, schedule), schedule);
    await assert.rejects(gateway.invokeTool('update_automation', { taskId, schedule }, identity), schedule);
    assert.equal((await feature.tasks.detail(taskId)).task.schedule, 'daily 08:00');
    assert.equal((await feature.tasks.list()).length, 1);
  }
});

test('Agent 的计划参数和能力指南说明 daily、时区以及关闭时不补跑', async t => {
  const { gateway } = await fixture(t);
  const tools = await gateway.tools(identity);
  for (const name of ['create_automation', 'update_automation']) {
    const tool = tools.find(item => item.name === name);
    assert.ok(tool, name);
    const schema = tool.parameters as { properties: { schedule: { description?: string } } };
    assert.match(schema.properties.schedule.description ?? '', /daily/);
    assert.match(schema.properties.schedule.description ?? '', /every/);
    assert.match(tool.frameworkCapability?.guidance ?? '', /daily/);
    assert.match(tool.frameworkCapability?.guidance ?? '', /时区/);
    assert.match(tool.frameworkCapability?.guidance ?? '', /不补|跳过/);
  }
});

function localTime(day: number, hour: number, minute = 0): Date {
  return new Date(2031, 0, day, hour, minute, 0, 0);
}

async function create(gateway: AgentCollaborationGateway, schedule: string, enabled = true): Promise<string> {
  const result = await gateway.invokeTool('create_automation', {
    name: '晨间简报', schedule, prompt: '整理简报', agentId: 'worker', enabled,
  }, identity) as AgentToolOutput;
  return (result.meta?.pendingAutomation as { taskId: string }).taskId;
}

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-daily-api-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify(Object.fromEntries(['main', 'worker'].map(id => [
    id, { id, name: id, model: 'test:model', config: { tools: [] } },
  ]))));
  const feature = createTideFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const gateway = new AgentCollaborationGateway(router, async () => ({
    toolMode: 'selected', tools: ['framework_capability_tide'],
  }));
  return { feature, gateway, router };
}
