import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { validateWorkflow } from '../../../engine/tradewind/foundation/workflow-validator.js';
import type { WorkflowGraph } from '../../../engine/tradewind/foundation/types/index.js';
import { startTradewindExecution, getActiveTradewindOrchestrator } from '../../../services/tradewind-execution.js';
import { tradewindWorkflowHandlers } from '../api/workflow-methods.js';
import { tradewindDesignHandlers } from '../api/design-methods.js';
import type { TradewindWorkflowAdmin } from '../application/workflow-admin.js';
import type { TradewindDesignPort } from '../application/design-port.js';
import { buildWorkflowGraph, workflowAgentView } from '../domain/workflow-spec.js';
import { validateWorkflowSpec } from '../domain/workflow-spec-validator.js';
import { createTradewindWorkflowStore } from './workflow-store.js';
import { createTradewindDesignPort } from './design-adapter.js';
import { createTradewindWorkflowAdmin } from './workflow-admin.js';

const knownTypes = new Set(['entry', 'agent', 'output', 'note', 'human-gate', 'meeting']);
function fixture(): WorkflowGraph {
  return { orchestration: 'handoff', nodes: [
    node('input', 'entry'), node('writer', 'agent'), node('reviewer', 'agent'), node('result', 'output'),
  ], edges: [edge('input', 'writer'), edge('writer', 'reviewer'),
    edge('reviewer', 'writer'), edge('reviewer', 'result')] };
}
function node(id: string, type: string) {
  return { id, type, label: id, position: { x: 0, y: 0 },
    config: type === 'agent' ? { agentId: 'worker' } : {} };
}
function edge(source: string, target: string) {
  return { id: `${source}-${target}`, source, target, sourcePort: 0, targetPort: 0, kind: 'handoff' as const };
}
async function temporary(action: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-orchestration-'));
  try { await action(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('人类保存保留编排类型，旧图不被强制改写，非法类型明确拒绝', () => {
  const parse = tradewindWorkflowHandlers({} as TradewindWorkflowAdmin).saveWorkflow.parse;
  const input = { workflowId: 'wf-1', name: '工作流', graph: fixture(), expectedRevision: null };
  assert.equal((parse(input) as typeof input).graph.orchestration, 'handoff');
  const { orchestration: _mode, ...legacy } = fixture();
  assert.deepEqual((parse({ ...input, graph: legacy }) as typeof input).graph, legacy);
  assert.throws(() => parse({ ...input, graph: { ...legacy, orchestration: 'unknown' } }),
    error => error instanceof FrameworkError && error.data.kind === 'validation');
  const agentParse = tradewindDesignHandlers({} as TradewindDesignPort).createWorkflow.parse;
  assert.throws(() => agentParse({ name: '非法编排', nodes: [], edges: [], orchestration: 'unknown' }),
    error => error instanceof FrameworkError && error.data.kind === 'validation');
});

test('两种编排形态保存回读及列表保留，损坏类型不被静默当成严格模式', async () => {
  await temporary(async root => {
    const store = createTradewindWorkflowStore(root);
    for (const orchestration of ['strict', 'handoff'] as const) {
      const graph = { ...fixture(), orchestration };
      await store.save({ workflowId: `wf-${orchestration}`, name: orchestration, graph, expectedRevision: null });
      assert.deepEqual((await store.read(`wf-${orchestration}`)).graph, graph);
    }
    assert.deepEqual(new Set((await store.list()).map(item => item.orchestration)), new Set(['strict', 'handoff']));
    const file = path.join(root, 'tradewind', 'workflows', 'wf-handoff', 'definition.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    raw.graph.orchestration = 'unknown';
    await fs.writeFile(file, JSON.stringify(raw));
    await assert.rejects(store.read('wf-handoff'), error =>
      error instanceof FrameworkError && error.data.code === 'TRADEWIND_WORKFLOW_DATA_INVALID');
  });
});

test('人类与 Agent 的条件交接校验允许预设回边，严格模式仍拒绝环', async () => {
  await temporary(async root => {
    assert.deepEqual(await validateWorkflow(fixture(), root, knownTypes), []);
    const strict = { ...fixture(), orchestration: 'strict' as const };
    assert.ok((await validateWorkflow(strict, root, knownTypes)).some(error => error.code === 'cycle-detected'));
    const view = workflowAgentView({ schemaVersion: 1, workflowId: 'wf-1', name: '返工',
      updatedAt: new Date().toISOString(), revision: 'a'.repeat(64), graph: fixture() });
    const parse = tradewindDesignHandlers({} as TradewindDesignPort).createWorkflow.parse;
    const spec = parse({ name: view.name, orchestration: view.orchestration, nodes: view.nodes, edges: view.edges });
    assert.deepEqual(validateWorkflowSpec(spec as Parameters<typeof validateWorkflowSpec>[0], new Set(['worker'])), []);
    assert.equal(buildWorkflowGraph(spec as Parameters<typeof buildWorkflowGraph>[0]).orchestration, 'handoff');
  });
});

test('条件交接禁止入口分裂、不可达节点、封闭环与会议节点', async () => {
  await temporary(async root => {
    const split = fixture(); split.edges.push(edge('input', 'reviewer'));
    assert.ok((await validateWorkflow(split, root, knownTypes)).some(error => error.code === 'handoff-entry-target-count'));
    const closed = fixture(); closed.edges = closed.edges.filter(item => item.target !== 'result');
    assert.ok((await validateWorkflow(closed, root, knownTypes)).some(error => error.code === 'handoff-no-output-path'));
    const isolated = fixture(); isolated.nodes.push(node('unused', 'agent'));
    assert.ok((await validateWorkflow(isolated, root, knownTypes)).some(error => error.code === 'handoff-unreachable-node'));
    const meeting = fixture(); meeting.nodes.find(item => item.id === 'writer')!.type = 'meeting';
    assert.ok((await validateWorkflow(meeting, root, knownTypes)).some(error => error.code === 'handoff-node-type'));
    const badBoundary = fixture(); badBoundary.edges.push(edge('result', 'writer'));
    assert.ok((await validateWorkflow(badBoundary, root, knownTypes)).some(error => error.code === 'handoff-boundary-route'));
  });
});

test('条件交接经统一执行入口创建真实运行并完成单信封交接', async () => {
  await temporary(async root => {
    const graph: WorkflowGraph = { orchestration: 'handoff',
      nodes: [node('input', 'entry'), node('result', 'output')], edges: [edge('input', 'result')] };
    for (const mode of ['manual', 'auto'] as const) {
      const receipt = await startTradewindExecution({ dataDir: root, workflowId: 'wf-handoff',
        graph, initialInput: '真实统一入口交接', trigger: { source: 'user' }, mode });
      const execution = getActiveTradewindOrchestrator({ executionId: receipt.executionId });
      assert.ok(execution);
      assert.equal(await execution.whenSettled(), 'done');
      assert.match(await fs.readFile(path.join(receipt.runDir, 'output.json'), 'utf8'), /真实统一入口交接/);
    }
  });
});

test('Agent 完整创建和更新保留编排类型，人类保存返回相同类型', async () => {
  await temporary(async root => {
    await fs.mkdir(path.join(root, 'agents'), { recursive: true });
    await fs.writeFile(path.join(root, 'agents', 'registry.json'), JSON.stringify({ worker: { name: '执行者' } }));
    const store = createTradewindWorkflowStore(root);
    const design = createTradewindDesignPort(root, store);
    const view = workflowAgentView({ schemaVersion: 1, workflowId: 'wf-1', name: '返工流程',
      updatedAt: new Date().toISOString(), revision: 'a'.repeat(64), graph: fixture() });
    const spec = { name: view.name, orchestration: view.orchestration, nodes: view.nodes, edges: view.edges };
    const created = await design.createWorkflow(spec);
    const workflowId = /wf-[a-z0-9-]+/.exec(created)![0];
    const first = await store.read(workflowId);
    assert.equal(first.graph.orchestration, 'handoff');
    const { orchestration: _omitted, ...oldCaller } = spec;
    await design.updateWorkflow(workflowId, oldCaller, first.revision);
    const updated = await store.read(workflowId);
    assert.equal(updated.graph.orchestration, 'handoff');
    const saved = await createTradewindWorkflowAdmin(root, { open: async () => {} }, store)
      .save({ workflowId, name: updated.name, graph: updated.graph, expectedRevision: updated.revision });
    assert.equal(saved.orchestration, 'handoff');
    assert.equal(JSON.parse(await design.listWorkflows(workflowId)).orchestration, 'handoff');
  });
});
