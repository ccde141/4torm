import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileWorkshopSummary, type WorkshopSnapshot } from './workshop-summary-state.js';

const initial: WorkshopSnapshot = {
  workshopId: 'workshop-a', chairAgentId: 'chair-a',
  seats: [{ id: 'seat-a', agentId: 'agent-a', title: '工位 A' }],
  rooms: [{ id: 'room-a', title: '讨论室 A' }],
  bulletin: [],
};

test('unchanged workshop summary retains its identity during background refresh', () => {
  assert.equal(reconcileWorkshopSummary(initial, structuredClone(initial)), initial);
});

test('external structure and room changes replace the visible workshop summary', () => {
  const next = structuredClone(initial);
  next.seats.push({ id: 'seat-b', agentId: 'agent-b', title: '工位 B' });
  next.rooms[0].title = '新议题';
  assert.deepEqual(reconcileWorkshopSummary(initial, next), next);
  assert.notEqual(reconcileWorkshopSummary(initial, next), initial);
});

test('a different selected workshop never inherits the previous summary', () => {
  const next = { ...structuredClone(initial), workshopId: 'workshop-b' };
  assert.equal(reconcileWorkshopSummary(initial, next), next);
});
