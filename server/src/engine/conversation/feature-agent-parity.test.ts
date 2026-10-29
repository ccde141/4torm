import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createCycloneFeature } from '../../modules/cyclone/public.js';
import { createTradewindFeature } from '../../modules/tradewind/public.js';
import { agentRegistryFile } from '../../services/data-paths.js';
import { AgentCollaborationGateway } from '../collaboration/agent-gateway.js';
import { CollaborationRouter } from '../collaboration/router.js';
import { AgentCollaborationTools } from './agent-collaboration-tools.js';
import { executeFrameworkGuideTool } from './framework-guide-tool.js';

const additions = {
  tradewind: ['read_workflow', 'stop_workflow', 'abort_workflow_node_round',
    'pause_workflow_node_round', 'resume_workflow_node_round',
    'list_workflow_profiles', 'save_workflow_profile', 'list_workflow_runs',
    'read_workflow_run', 'read_workflow_run_events', 'read_workflow_run_archive'],
  cyclone: ['configure_collaboration_supervisor', 'read_collaboration_supervisor',
    'start_collaboration_supervisor_chat', 'read_collaboration_seat_history'],
};

test('新增信风和气旋能力经过真实功能岛装配进入超级工具和按需指南', async t => {
  const fixture = await createFixture(t);
  const bridge = await fixture.bridge();
  for (const [capability, actions] of Object.entries(additions)) {
    assert.equal(bridge.runtimeDefinitions.filter(tool =>
      tool.name === `framework_capability_${capability}`).length, 1);
    const summary = fixture.guide(bridge, capability);
    assert.equal(summary.ok, true, capability);
    for (const action of actions) {
      const definition = bridge.definitions.find(tool => tool.name === action);
      assert.equal(definition?.frameworkCapability?.id, capability, action);
      assert.ok(definition?.description, action);
      assert.match(summary.result, new RegExp(`\\b${action}\\b`));
      const detail = fixture.guide(bridge, capability, action);
      assert.equal(detail.ok, true, action);
      assert.match(detail.result, new RegExp(`#### action: ${action}\\b`));
      assert.ok(detail.result.includes(JSON.stringify(definition!.parameters)), action);
      assert.equal(detail.result.includes('#### action: create_workflow'), false);
      assert.equal(detail.result.includes('#### action: create_collaboration_group'), false);
    }
  }
  for (const [action, fields] of [
    ['create_collaboration_group', ['supervisorAgentId', 'supervisorRolePrompt']],
    ['save_workflow_profile', ['expectedRevision', 'gapSec', 'carryOver', 'lapBound']],
    ['read_workflow_run_archive', ['kind', 'nodeId', 'round', 'offset', 'maxChars']],
    ['read_collaboration_seat_history', ['workshopId', 'seatId', 'cursor']],
  ] as const) {
    const definition = bridge.definitions.find(tool => tool.name === action)!;
    for (const field of fields) assert.ok(JSON.stringify(definition.parameters).includes(`"${field}"`), `${action}.${field}`);
  }
  for (const action of ['read_collaboration_thread', 'read_collaboration_message']) {
    const definition = bridge.definitions.find(tool => tool.name === action)!;
    assert.match(JSON.stringify(definition.parameters), /"supervisor"/);
  }
  const start = bridge.definitions.find(tool => tool.name === 'start_collaboration_supervisor_chat')!;
  assert.doesNotMatch(JSON.stringify(start.parameters), /"sourceKind"|"sourceSeatId"|"actor"/);
});

test('新增 action 单项选择不扩展其他权限，旧超级工具在配置撤销后也不能执行', async t => {
  const fixture = await createFixture(t);
  const original = await fixture.bridge();
  for (const [capability, actions] of Object.entries(additions)) {
    for (const action of actions) {
      fixture.select([action]);
      const selected = await fixture.bridge();
      assert.deepEqual(selected.definitions.map(tool => tool.name), [action]);
      assert.deepEqual(selected.runtimeDefinitions.map(tool => tool.name), [`framework_capability_${capability}`]);
      assert.equal(fixture.guide(selected, capability, action).ok, true);
      const sibling = actions.find(name => name !== action)!;
      const unavailable = fixture.guide(selected, capability, sibling);
      assert.equal(unavailable.result.includes(`#### action: ${sibling}`), false);
      if (capability === 'cyclone') assert.equal(unavailable.ok, false);
      await assert.rejects(() => selected.call(`framework_capability_${capability}`,
        { action: sibling, input: {} }), /FRAMEWORK_CAPABILITY_ACTION_UNAVAILABLE/);
      await assert.rejects(() => fixture.gateway.invokeTool(sibling, {}, fixture.identity), hasCode('CAPABILITY_DISABLED'));
    }
  }
  fixture.select([]);
  assert.deepEqual((await fixture.bridge()).definitions, []);
  for (const [capability, actions] of Object.entries(additions)) {
    const disabled = await fixture.bridge();
    assert.equal(fixture.guide(disabled, capability).ok, true);
    const unavailable = fixture.guide(disabled, capability, undefined, 'tools');
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.result, /该能力当前未开放/);
    for (const action of actions) {
      assert.equal(fixture.guide(disabled, capability, action).ok, false);
      await assert.rejects(() => original.call(`framework_capability_${capability}`,
        { action, input: {} }), hasCode('CAPABILITY_DISABLED'));
    }
  }
});

test('Agent 通过当前指南保存循环档案并回读真实版本，不获得运行或人类维护权限', async t => {
  const fixture = await createFixture(t);
  const all = await fixture.bridge();
  await all.call('framework_capability_tradewind', { action: 'create_workflow', input: {
    name: '档案回归', nodes: [
      { id: 'entry', type: 'entry', label: '输入', initialEnvelope: '核对资料' },
      { id: 'output', type: 'output', label: '交付' },
    ], edges: [{ source: 'entry', target: 'output' }],
  } });
  const workflows = await call<Array<{ workflowId: string }>>(all, 'tradewind', 'list_workflows', {});
  assert.equal(workflows.length, 1);
  const workflowId = workflows[0].workflowId;
  fixture.select(['list_workflow_profiles', 'save_workflow_profile', 'list_workflow_runs']);
  const bridge = await fixture.bridge();
  const catalog = await call<{ revision: string; text: string }>(bridge,
    'tradewind', 'list_workflow_profiles', { workflowId });
  assert.deepEqual(JSON.parse(catalog.text), []);
  const save = { workflowId, expectedRevision: catalog.revision, profile: {
    id: 'bounded-check', name: '两次核验', cadence: { kind: 'relative', gapSec: 60 },
    overlap: 'skip', lapBound: 2, carryOver: 'summary', summaryPrompt: '保留核验结果与待办',
  } };
  const result = await call<{ saved: boolean; revision: string }>(bridge, 'tradewind', 'save_workflow_profile', save);
  assert.equal(result.saved, true);
  assert.notEqual(result.revision, catalog.revision);
  const updated = await call<{ revision: string; text: string }>(bridge,
    'tradewind', 'list_workflow_profiles', { workflowId });
  assert.equal(updated.revision, result.revision);
  assert.deepEqual(JSON.parse(updated.text), [save.profile]);
  await assert.rejects(() => call(bridge, 'tradewind', 'save_workflow_profile', save), hasCode('TRADEWIND_PROFILES_CONFLICT'));
  const runs = await call<{ items: unknown[] }>(bridge, 'tradewind', 'list_workflow_runs', { workflowId });
  assert.deepEqual(runs.items, []);
  await assert.rejects(() => fixture.gateway.invokeTool('start_workflow', { workflowId }, fixture.identity), hasCode('CAPABILITY_DISABLED'));
  for (const method of ['saveWorkflowProfiles', 'deleteWorkflow', 'deleteWorkflowProfile']) {
    await assert.rejects(() => fixture.gateway.invoke({ feature: 'tradewind', method,
      input: { workflowId } }, fixture.identity), hasCode('FEATURE_AGENT_METHOD_UNAVAILABLE'));
  }
});

test('主管和工位履历支持单项授权，读取不开放主管改绑和人类维护原接口', async t => {
  const fixture = await createFixture(t);
  const workshop = await fixture.cyclone.workshops.create({ title: '主管回归' });
  const seat = await fixture.cyclone.workshops.addSeat({
    workshopId: workshop.id, agentId: 'worker', title: '资料核验',
  });
  fixture.select(['read_collaboration_supervisor', 'read_collaboration_seat_history']);
  const bridge = await fixture.bridge();
  const status = await call<{ configured: boolean }>(bridge, 'cyclone',
    'read_collaboration_supervisor', { workshopId: workshop.id });
  assert.equal(status.configured, false);
  const history = await call<{ items: unknown[] }>(bridge, 'cyclone',
    'read_collaboration_seat_history', { workshopId: workshop.id, seatId: seat.id });
  assert.ok(Array.isArray(history.items));
  await assert.rejects(() => fixture.gateway.invokeTool('configure_collaboration_supervisor', {
    workshopId: workshop.id, agentId: 'coordinator',
  }, fixture.identity), hasCode('CAPABILITY_DISABLED'));
  for (const method of ['configureSupervisor', 'resetSupervisorContext', 'editSupervisorMessage', 'deleteSeat']) {
    await assert.rejects(() => fixture.gateway.invoke({ feature: 'cyclone', method,
      input: { workshopId: workshop.id } }, fixture.identity), hasCode('FEATURE_AGENT_METHOD_UNAVAILABLE'));
  }
});

test('功能岛二级示例引用真实公开操作，三级目录与执行按当前单项权限开放', async t => {
  const fixture = await createFixture(t);
  const bridge = await fixture.bridge();
  const bindings = fixture.router.listAgentTools();
  for (const feature of fixture.features) {
    const descriptor = feature.manifest.agentCapability!;
    const summary = fixture.guide(bridge, descriptor.id);
    for (const example of descriptor.examples ?? []) {
      for (const action of example.actions) {
        assert.ok(bindings.some(binding => binding.feature === descriptor.id
          && binding.definition.name === action), `${descriptor.id}: ${action}`);
        assert.match(summary.result, new RegExp(`\\b${action}\\b`));
      }
    }
  }
  fixture.select(['read_collaboration_supervisor']);
  const selected = await fixture.bridge();
  const publicGuide = fixture.guide(selected, 'cyclone');
  assert.equal(publicGuide.ok, true);
  assert.match(publicGuide.result, /### 使用示例/);
  assert.match(publicGuide.result, /start_collaboration_supervisor_chat/);
  assert.doesNotMatch(publicGuide.result, /#### action:|input JSON Schema/);
  const restricted = fixture.guide(selected, 'cyclone', undefined, 'tools');
  assert.equal(restricted.ok, true);
  assert.match(restricted.result, /- `read_collaboration_supervisor`/);
  assert.doesNotMatch(restricted.result, /start_collaboration_supervisor_chat|### 使用示例|input JSON Schema/);
  const denied = fixture.guide(selected, 'cyclone', 'start_collaboration_supervisor_chat');
  assert.equal(denied.ok, false);
  assert.match(denied.result, /FRAMEWORK_GUIDE_ACTION_UNAVAILABLE/);
  await assert.rejects(() => selected.call('framework_capability_cyclone', {
    action: 'start_collaboration_supervisor_chat', input: {},
  }), /FRAMEWORK_CAPABILITY_ACTION_UNAVAILABLE/);
  await assert.rejects(() => fixture.gateway.invokeTool('start_collaboration_supervisor_chat', {}, fixture.identity),
    hasCode('CAPABILITY_DISABLED'));
});

async function createFixture(t: TestContext) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'feature-agent-parity-'));
  const cyclone = createCycloneFeature({ dataDir });
  t.after(async () => { await cyclone.shutdown(); cyclone.dispose(); await rm(dataDir, { recursive: true, force: true }); });
  const registry = agentRegistryFile(dataDir);
  await mkdir(path.dirname(registry), { recursive: true });
  await writeFile(registry, JSON.stringify({
    coordinator: { name: '统筹', model: 'unused:test', config: { toolMode: 'selected', tools: [] } },
    worker: { name: '资料员', model: 'unused:test', config: { toolMode: 'selected', tools: [] } },
  }));
  const features = [cyclone.module, createTradewindFeature({ dataDir }).module];
  const router = new CollaborationRouter(features);
  let selection: string[] | undefined;
  const gateway = new AgentCollaborationGateway(router, async () => selection === undefined
    ? { toolMode: 'all', tools: [] } : { toolMode: 'selected', tools: selection });
  const identity = { agentId: 'coordinator', sessionId: 'parity-session' };
  return {
    cyclone, gateway, router, features, identity,
    select(tools: string[]) { selection = [...tools]; },
    bridge: () => AgentCollaborationTools.load(identity, [], {
      list: id => gateway.tools(id), invoke: (name, input, id) => gateway.invokeTool(name, input, id),
    }),
    guide: (bridge: AgentCollaborationTools, capability: string, action?: string, view?: 'guide' | 'tools') => executeFrameworkGuideTool({
      mainAgent: true, dataDir, agentId: identity.agentId, sessionId: identity.sessionId,
      toolDefs: bridge.definitions, guideCatalog: router.listAgentTools().map(binding => binding.definition),
      args: { capability, ...(action ? { action } : {}), ...(view ? { view } : {}) },
    }),
  };
}

async function call<T = unknown>(bridge: AgentCollaborationTools,
  capability: string, action: string, input: Record<string, unknown>): Promise<T> {
  return JSON.parse((await bridge.call(`framework_capability_${capability}`, { action, input })).result) as T;
}

function hasCode(code: string) {
  return (error: unknown) => (error as { data?: { code?: string } }).data?.code === code;
}
