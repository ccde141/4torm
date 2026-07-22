import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGraph } from './workflow-validation';
import type { WorkflowGraph } from '../types';

const graph: WorkflowGraph = {
  nodes: [
    { id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} },
    { id: 'meeting', type: 'meeting', label: '讨论', position: { x: 1, y: 0 }, config: { chairAgentId: 'chair', participantNodeIds: ['agent'] } },
    { id: 'output', type: 'output', label: '出口', position: { x: 2, y: 0 }, config: {} },
  ],
  edges: [],
};

test('frontend validation keeps manual-only nodes out of automatic runs', () => {
  assert.deepEqual(validateGraph(graph, 'manual'), []);
  assert.match(validateGraph(graph, 'auto').join('\n'), /自动模式不支持会议室/);
});
