import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { AgentToolOutput, type CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { createTradewindFeature } from './factory.js';
import { tradewindValidationHandlers, tradewindValidationManifests } from './validation-methods.js';
import type { TradewindValidationPort } from '../application/validation-port.js';
import { tradewindWorkflowHandlers } from './workflow-methods.js';
import type { TradewindWorkflowAdmin } from '../application/workflow-admin.js';
import { createTradewindWorkflowStore } from '../runtime/workflow-store.js';
import type { WorkflowGraph } from '../../../engine/tradewind/foundation/types/index.js';

function graph(orchestration?: 'strict' | 'handoff') {
  return { ...(orchestration ? { orchestration } : {}), nodes: ['entry', 'worker', 'review', 'output'].map(id => ({
    id, type: id === 'entry' || id === 'output' ? id : 'agent', label: id,
    position: { x: 0, y: 0 }, config: id === 'worker' || id === 'review' ? { agentId: 'worker' } : {},
  })), edges: [['entry', 'worker'], ['worker', 'review'], ['review', 'worker'], ['review', 'output']].map(([source, target]) => ({
    id: `${source}-${target}`, source, target, sourcePort: 0, targetPort: 0, kind: 'handoff',
  })) };
}
const context: CollaborationContext = { actor: { type: 'human', id: 'owner', actingAs: 'human' },
  audience: 'human', enabledFeatures: new Set(['tradewind']), permissions: new Set(['observe']), requestId: 'validate-test' };

test('校验与人类保存共用完整 graph 解析，非法模式与未知键被拒绝', () => {
  const parse = tradewindValidationHandlers({} as TradewindValidationPort).validateWorkflow.parse;
  const graphInput = graph('handoff');
  const saved = tradewindWorkflowHandlers({} as TradewindWorkflowAdmin).saveWorkflow.parse({
    graph: graphInput, workflowId: 'wf-1', name: '流程', expectedRevision: null,
  }) as { graph: unknown };
  assert.deepEqual((parse({ graph: graphInput }) as { graph: unknown }).graph, saved.graph);
  assert.deepEqual(parse({ workflowId: 'wf-saved', mode: 'auto' }), { workflowId: 'wf-saved', mode: 'auto' });
  for (const input of [
    { graph: graphInput, mode: 'unsupported' }, { graph: graphInput, mode: null },
    { graph: graphInput, extra: true }, { graph: { ...graphInput, fork: true } },
    { graph: { ...graphInput, orchestration: 'unknown' } },
    {}, { workflowId: 'wf-saved', graph: graphInput }, { workflowId: '../escape' }, { workflowId: null },
  ]) assert.throws(() => parse(input), error => error instanceof FrameworkError && error.data.kind === 'validation');
});

test('三类调用者经中心用同一权威图校验；旧图严格拒绝环，条件交接允许预设返工', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-validation-center-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const feature = createTradewindFeature({ dataDir: root });
  const router = new CollaborationRouter([feature.module]);
  await createTradewindWorkflowStore(root).save({ workflowId: 'wf-saved', name: '已保存条件交接',
    graph: graph('handoff') as WorkflowGraph, expectedRevision: null });
  for (const audience of ['human', 'internal', 'agent'] as const) {
    const result = await router.invoke({ feature: 'tradewind', method: 'validateWorkflow',
      input: { graph: graph('handoff'), mode: 'manual' } }, { ...context, audience });
    assert.deepEqual(result instanceof AgentToolOutput ? result.value : result, { valid: true, issues: [] });
    const saved = await router.invoke({ feature: 'tradewind', method: 'validateWorkflow',
      input: { workflowId: 'wf-saved', mode: 'manual' } }, { ...context, audience });
    assert.deepEqual(saved instanceof AgentToolOutput ? saved.value : saved, { valid: true, issues: [] });
  }
  const strict = await router.invoke({ feature: 'tradewind', method: 'validateWorkflow', input: { graph: graph() } }, context) as
    { valid: boolean; issues: Array<{ code: string; nodeId?: string }> };
  assert.equal(strict.valid, false);
  assert.ok(strict.issues.some(issue => issue.code === 'cycle-detected' && issue.nodeId));
  const handoff = graph('handoff'); handoff.edges = handoff.edges.filter(edge => edge.target !== 'output');
  const invalid = await router.invoke({ feature: 'tradewind', method: 'validateWorkflow', input: { graph: handoff } }, context) as
    { valid: boolean; issues: Array<{ code: string; nodeId?: string }> };
  assert.ok(invalid.issues.some(issue => issue.code === 'handoff-no-output-path'));
  await assert.rejects(router.invoke({ feature: 'tradewind', method: 'validateWorkflow',
    input: { workflowId: 'wf-missing' } }, context), error =>
    error instanceof FrameworkError && error.data.code === 'TRADEWIND_WORKFLOW_NOT_FOUND');
});

test('中心装配保护 manifest/handler/schema，Agent 暴露同 graph 契约而非 spec', () => {
  const feature = createTradewindFeature({ dataDir: 'not-read-for-manifest' });
  const [declaration] = tradewindValidationManifests();
  const method = feature.module.manifest.methods.find(item => item.id === 'validateWorkflow');
  assert.deepEqual(method, declaration);
  assert.ok(feature.module.handlers.validateWorkflow);
  const schema = method!.inputSchema as { oneOf: Array<{ required: string[] }>; properties: Record<string, unknown> };
  assert.deepEqual(schema.oneOf.map(item => item.required), [['graph'], ['workflowId']]);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['graph', 'mode', 'workflowId']);
  const router = new CollaborationRouter([feature.module]);
  const tool = router.listAgentTools().find(item => item.definition.name === 'validate_workflow');
  assert.deepEqual(tool?.definition.parameters, method!.inputSchema);
  const changed = { ...feature.module, handlers: { ...feature.module.handlers } };
  delete changed.handlers.validateWorkflow;
  assert.throws(() => new CollaborationRouter([changed]));
});
