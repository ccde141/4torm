import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { AgentToolOutput } from '../../../engine/collaboration/contracts.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { WorkflowSpec } from '../domain/workflow-spec.js';
import { createTradewindWorkflowStore } from '../runtime/workflow-store.js';
import { createTradewindFeature } from './factory.js';

interface Page { workflowId: string; revision: string; text: string; totalChars: number; nextOffset?: number }
interface Snapshot extends WorkflowSpec { workflowId: string; revision: string }
const identity = { agentId: 'coordinator', sessionId: 'design-session' };

async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-design-read-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'agents'), { recursive: true });
  await fs.writeFile(path.join(root, 'agents', 'registry.json'), JSON.stringify({ worker: { name: '执行者' } }));
  const router = new CollaborationRouter([createTradewindFeature({ dataDir: root }).module]);
  const gateway = new AgentCollaborationGateway(router, async () => ({ toolMode: 'all', tools: [] }));
  const invoke = async (name: string, input: unknown) => {
    const result = await gateway.invokeTool(name, input, identity);
    return result instanceof AgentToolOutput ? result.value : result;
  };
  return { root, invoke, router, gateway };
}

function spec(orchestration: 'strict' | 'handoff'): WorkflowSpec {
  return { name: `完整读取-${orchestration}`, orchestration, nodes: [
    { id: 'entry-a', type: 'entry', label: '入口甲', initialEnvelope: '第一份任务' },
    { id: 'entry-b', type: 'entry', label: '入口乙', initialEnvelope: '第二份任务' },
    { id: 'writer', type: 'agent', label: '撰写者', agentId: 'worker',
      role: '逐项整理资料，保留换行、引号“引用”与完整职责。\n'.repeat(1_000), deliveryDelaySec: 5 },
    { id: 'reviewer', type: 'agent', label: '审查者', agentId: 'worker', role: '根据证据复核；必要时退回。' },
    { id: 'note', type: 'note', label: '共享约定', content: '保留原始出处', targets: ['writer', 'reviewer'] },
    { id: 'output', type: 'output', label: '最终交付', archiveName: '已核验交付' },
  ], edges: [{ source: 'entry-a', target: 'writer' }, { source: 'entry-b', target: 'writer' },
    { source: 'writer', target: 'reviewer' }, { source: 'reviewer', target: 'output' },
    ...(orchestration === 'handoff' ? [{ source: 'reviewer', target: 'writer' }] : []),
  ] };
}

async function create(invoke: (name: string, input: unknown) => Promise<unknown>, input: WorkflowSpec) {
  const text = await invoke('create_workflow', input);
  const id = /wf-[a-z0-9-]+/.exec(String(text))?.[0];
  assert.ok(id);
  return id;
}

async function complete(invoke: (name: string, input: unknown) => Promise<unknown>, workflowId: string) {
  const first = await invoke('read_workflow', { workflowId, maxChars: 3_000 }) as Page;
  let page = first;
  let text = first.text;
  let pages = 1;
  while (page.nextOffset !== undefined) {
    page = await invoke('read_workflow', { workflowId, maxChars: 3_000,
      offset: page.nextOffset, revision: first.revision }) as Page;
    assert.equal(page.revision, first.revision);
    assert.ok(page.text.length <= 3_000);
    text += page.text;
    pages++;
    assert.ok(pages < 100);
  }
  assert.equal(text.length, first.totalChars);
  assert.ok(pages > 1);
  return { first, value: JSON.parse(text) as Snapshot };
}

test('Agent 完整续读双模式大图后更新，职责、回边、多入口与画布信息不丢失', async t => {
  const { root, invoke } = await fixture(t);
  const store = createTradewindWorkflowStore(root);
  for (const orchestration of ['strict', 'handoff'] as const) {
    const input = spec(orchestration);
    const workflowId = await create(invoke, input);
    const original = await store.read(workflowId);
    const writer = original.graph.nodes.find(node => node.id === 'writer')!;
    Object.assign(writer, { position: { x: 314, y: 159 }, width: 250, height: 180, memo: '保留画布备注' });
    writer.config.compatibilityMarker = { preserved: true };
    const before = await store.save({ workflowId, name: original.name, graph: original.graph,
      expectedRevision: original.revision });
    assert.match(String(await invoke('list_workflows', { workflowId })), /输出已按预算截断/);
    const { first, value } = await complete(invoke, workflowId);
    assert.equal(first.revision, before.revision);
    assert.equal(value.orchestration, orchestration);
    assert.deepEqual(value.nodes, input.nodes);
    assert.deepEqual(value.edges, input.edges);
    const { workflowId: _id, revision: _revision, ...fullSpec } = value;
    await invoke('update_workflow', { workflowId, expectedRevision: first.revision,
      ...fullSpec, name: '只调整标题' });
    const after = await store.read(workflowId);
    assert.equal(after.name, '只调整标题');
    assert.equal(after.graph.orchestration, orchestration);
    assert.deepEqual(after.graph.nodes, before.graph.nodes);
    assert.deepEqual(after.graph.edges, before.graph.edges);
    await assert.rejects(invoke('read_workflow', { workflowId, offset: first.nextOffset,
      revision: first.revision }), /内容已变化/);
    await assert.rejects(invoke('update_workflow', { workflowId, expectedRevision: first.revision,
      ...fullSpec }), /已在其他位置更改/);
  }
});

test('大图续读严格校验身份、偏移、页长与版本，不返回混合版本正文', async t => {
  const { invoke, root } = await fixture(t);
  const workflowId = await create(invoke, spec('strict'));
  const first = await invoke('read_workflow', { workflowId, maxChars: 1 }) as Page;
  assert.equal(first.nextOffset, 1);
  assert.equal(first.text.length, 1);
  for (const extra of [
    { offset: -1 }, { offset: 1.5 }, { offset: Number.MAX_SAFE_INTEGER + 1 },
    { offset: 1 }, { offset: first.totalChars + 1, revision: first.revision },
    { maxChars: 0 }, { maxChars: 16_385 }, { maxChars: '100' },
    { revision: 'bad' }, { revision: 'a'.repeat(64) }, { unexpected: true },
  ]) await assert.rejects(invoke('read_workflow', { workflowId, ...extra }), /参数无效|内容已变化/);
  for (const invalidId of ['', '../outside', 'x'.repeat(121), 1]) {
    await assert.rejects(invoke('read_workflow', { workflowId: invalidId }), /参数无效/);
  }
  await assert.rejects(invoke('read_workflow', { workflowId: 'missing' }), /工作流不存在/);
  const end = await invoke('read_workflow', { workflowId, offset: first.totalChars,
    revision: first.revision }) as Page;
  assert.equal(end.text, '');
  assert.equal(end.nextOffset, undefined);
  const store = createTradewindWorkflowStore(root);
  const original = await store.read(workflowId);
  await store.save({ workflowId, name: '人类修改标题', graph: original.graph,
    expectedRevision: original.revision });
  await assert.rejects(invoke('read_workflow', { workflowId, offset: 1,
    revision: first.revision }), /内容已变化/);
});

test('大图读取遵守 Agent 实时工具开关及中心输出预算', async t => {
  const { invoke, router } = await fixture(t);
  const workflowId = await create(invoke, spec('handoff'));
  let tools = ['read_workflow'];
  const gateway = new AgentCollaborationGateway(router, async () => ({ toolMode: 'selected', tools }));
  assert.deepEqual((await gateway.tools(identity)).map(item => item.name), ['read_workflow']);
  const page = await router.invoke({ feature: 'tradewind', method: 'readWorkflow',
    input: { workflowId, maxChars: 16_384 }, budget: { textChars: 73 } }, {
    actor: { type: 'agent', id: identity.agentId, actingAs: 'human' }, audience: 'agent',
    enabledFeatures: new Set(['tradewind']), permissions: new Set(['observe']), requestId: 'budget-test',
  }) as Page;
  assert.equal(page.text.length, 73);
  assert.equal(page.nextOffset, 73);
  tools = [];
  await assert.rejects(gateway.invokeTool('read_workflow', { workflowId }, identity), /未启用/);
});

test('出口归档名只接受文件名，完整更新可清除已有归档名且不能注入未知配置', async t => {
  const { root, invoke } = await fixture(t);
  const input = spec('strict');
  for (const archiveName of ['../outside', 'C:\\outside', '..', '.', 'a\nb', 'x'.repeat(201)]) {
    await assert.rejects(invoke('create_workflow', { ...input,
      nodes: input.nodes.map(node => node.type === 'output' ? { ...node, archiveName } : node) }), /参数无效/);
  }
  const store = createTradewindWorkflowStore(root);
  assert.deepEqual(await store.list(), []);
  const workflowId = await create(invoke, input);
  const { value, first } = await complete(invoke, workflowId);
  const { workflowId: _id, revision: _revision, ...fullSpec } = value;
  await invoke('update_workflow', { workflowId, expectedRevision: first.revision, ...fullSpec,
    nodes: fullSpec.nodes.map(node => {
      if (node.type === 'output') {
        const { archiveName: _name, ...rest } = node;
        return { ...rest, unknownConfig: '不能注入' };
      }
      return node;
    }),
  });
  assert.deepEqual((await store.read(workflowId)).graph.nodes.find(node => node.type === 'output')?.config, {});
});
