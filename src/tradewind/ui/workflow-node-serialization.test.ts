import assert from 'node:assert/strict';
import test from 'node:test';
import { deserializeWorkflowNode, serializeWorkflowNode } from './workflow-node-serialization';

test('workflow node human memo survives save and reload', () => {
  const serialized = serializeWorkflowNode({
    id: 'agent-1',
    type: 'agent',
    position: { x: 10, y: 20 },
    width: 280,
    height: 160,
    data: { label: '资料员', memo: '只供人类识别', config: { agentId: 'a-1' } },
  });

  assert.equal(serialized.memo, '只供人类识别');
  assert.equal(serialized.width, 280);
  const reloaded = deserializeWorkflowNode(serialized);
  assert.equal((reloaded.data as { memo?: string }).memo, '只供人类识别');
  assert.equal(reloaded.height, 160);
});

test('a workflow node without memo remains valid after loading and saving again', () => {
  const loaded = deserializeWorkflowNode({
    id: 'entry-1', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {},
  });
  const saved = serializeWorkflowNode(loaded);
  assert.equal(Object.hasOwn(saved, 'memo'), false);
});
