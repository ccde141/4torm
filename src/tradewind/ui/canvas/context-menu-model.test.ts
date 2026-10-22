import assert from 'node:assert/strict';
import test from 'node:test';
import { CANVAS_NODE_ITEMS, contextMenuKind, nodeItemsForMode } from './context-menu-model';

test('canvas context menu distinguishes node, edge, and pane targets', () => {
  assert.equal(contextMenuKind({ nodeId: 'node-1', edgeId: null }), 'node');
  assert.equal(contextMenuKind({ nodeId: null, edgeId: 'edge-1' }), 'edge');
  assert.equal(contextMenuKind({ nodeId: null, edgeId: null }), 'pane');
});

test('handoff palette and menu do not offer automatic meeting nodes', () => {
  assert.equal(nodeItemsForMode('strict').some(item => item.type === 'meeting'), true);
  assert.equal(nodeItemsForMode('handoff').some(item => item.type === 'meeting'), false);
  assert.equal(nodeItemsForMode('handoff').length, 5);
});

test('canvas add menus expose every supported node type', () => {
  assert.deepEqual(
    CANVAS_NODE_ITEMS.map((item) => item.type),
    ['entry', 'agent', 'meeting', 'human-gate', 'note', 'output'],
  );
});
