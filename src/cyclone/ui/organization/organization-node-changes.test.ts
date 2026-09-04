import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOrganizationNodePositions } from './organization-node-changes';

const draft = {
  baseRevision: 1,
  activatesExplicitMode: false,
  groups: [{ id: 'group-a', title: 'A', seatIds: ['seat-a'], position: { x: 20, y: 30 } }],
  externalRelations: [],
  seatPositions: { 'seat-a': { x: 80, y: 90 }, 'seat-b': { x: 400, y: 100 } },
};

test('moving a group moves every member by the same delta', () => {
  const next = applyOrganizationNodePositions(draft, [
    { id: 'group-a', type: 'position', position: { x: 50, y: 70 } },
  ]);
  assert.deepEqual(next.groups[0].position, { x: 50, y: 70 });
  assert.deepEqual(next.seatPositions['seat-a'], { x: 110, y: 130 });
  assert.deepEqual(next.seatPositions['seat-b'], { x: 400, y: 100 });
});

test('moving a seat updates only its draft position', () => {
  const next = applyOrganizationNodePositions(draft, [
    { id: 'seat-b', type: 'position', position: { x: 460, y: 180 } },
  ]);
  assert.deepEqual(next.seatPositions['seat-b'], { x: 460, y: 180 });
  assert.equal(next.groups, draft.groups);
});

test('moving a newly added seat creates its first draft position', () => {
  const next = applyOrganizationNodePositions(draft, [
    { id: 'seat-new', type: 'position', position: { x: 520, y: 180 } },
  ]);
  assert.deepEqual(next.seatPositions['seat-new'], { x: 520, y: 180 });
});

test('selection and unchanged positions preserve the draft reference', () => {
  assert.equal(applyOrganizationNodePositions(draft, [
    { id: 'seat-a', type: 'select', selected: true },
    { id: 'seat-b', type: 'position', position: { x: 400, y: 100 } },
  ]), draft);
});
