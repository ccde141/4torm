import assert from 'node:assert/strict';
import test from 'node:test';
import type { Node } from '@xyflow/react';
import {
  applyOrganizationCanvasNodeChanges,
  commitOrganizationNodePositions,
} from './organization-canvas-state';

const draft = {
  baseRevision: 1,
  activatesExplicitMode: false,
  groups: [{ id: 'group-a', title: 'A', seatIds: ['seat-a'], position: { x: 20, y: 30 } }],
  externalRelations: [],
  seatPositions: { 'seat-a': { x: 80, y: 90 }, 'seat-b': { x: 400, y: 100 } },
};
const nodes: Node[] = [
  { id: 'group-a', type: 'group', position: { x: 20, y: 30 }, data: {} },
  { id: 'seat-a', type: 'seat', position: { x: 80, y: 90 }, data: {} },
  { id: 'seat-b', type: 'seat', position: { x: 400, y: 100 }, data: {} },
];

test('拖动帧只更新画布节点并同步移动组内工位', () => {
  const next = applyOrganizationCanvasNodeChanges(nodes, [{
    id: 'group-a', type: 'position', position: { x: 50, y: 70 }, dragging: true,
  }], draft);
  assert.deepEqual(next.find(node => node.id === 'group-a')?.position, { x: 50, y: 70 });
  assert.deepEqual(next.find(node => node.id === 'seat-a')?.position, { x: 110, y: 130 });
  assert.deepEqual(draft.groups[0].position, { x: 20, y: 30 });
});

test('拖动结束才一次性把画布位置写入组织草稿', () => {
  const moved = nodes.map(node => node.id === 'seat-b'
    ? { ...node, position: { x: 520, y: 180 } }
    : node);
  const next = commitOrganizationNodePositions(draft, moved);
  assert.deepEqual(next.seatPositions['seat-b'], { x: 520, y: 180 });
  assert.notEqual(next, draft);
});
