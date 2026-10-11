import assert from 'node:assert/strict';
import test from 'node:test';
import type { Node } from '@xyflow/react';
import { serializeWorkflowNode } from '../../../../../src/tradewind/ui/workflow-node-serialization.ts';
import type { TradewindWorkflowAdmin } from '../application/workflow-admin.js';
import { tradewindWorkflowHandlers } from './workflow-methods.js';

test('画布入口与出口连线可通过当前保存协议及 revision 校验', () => {
  const nodes = [
    { id: 'entry-1', type: 'entry', position: { x: 0, y: 0 },
      measured: { width: 160, height: 60 }, data: { label: '入口', config: {} } },
    { id: 'output-1', type: 'output', position: { x: 220, y: 0 },
      measured: { width: 160, height: 60 }, data: { label: '出口', config: {} } },
  ] as Node[];
  const graph = { nodes: nodes.map(serializeWorkflowNode), edges: [
    { id: 'e-1', source: 'entry-1', sourcePort: 0,
      target: 'output-1', targetPort: 0, kind: 'handoff' },
  ] };
  const payload = JSON.parse(JSON.stringify({ workflowId: 'wf-new', name: '未命名工作流',
    graph, expectedRevision: null }));
  const handlers = tradewindWorkflowHandlers({} as TradewindWorkflowAdmin);

  const parsed = handlers.saveWorkflow.parse(payload) as typeof payload;
  assert.equal(parsed.expectedRevision, null);
  assert.deepEqual(parsed.graph, JSON.parse(JSON.stringify(graph)));
});
