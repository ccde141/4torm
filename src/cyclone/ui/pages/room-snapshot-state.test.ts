import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileRoomSnapshot } from './room-snapshot-state.js';
import type { RoomData } from './room-messages.js';

const room: RoomData = {
  id: 'room-a', title: '讨论室', topic: '议题', participantSeatIds: ['seat-a'], publicMessages: [],
};

test('unchanged room reads do not replace chat history during idle synchronization', () => {
  assert.equal(reconcileRoomSnapshot(room, structuredClone(room)), room);
});

test('external membership and message changes become visible through the same room status', () => {
  const next = structuredClone(room);
  next.participantSeatIds.push('seat-b');
  next.publicMessages.push({ speaker: '系统', content: '工位 B 已加入', timestamp: 1, kind: 'membership' });
  assert.equal(reconcileRoomSnapshot(room, next), next);
});
