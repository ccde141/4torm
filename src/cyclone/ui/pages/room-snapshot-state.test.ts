import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileRoomSnapshot } from './room-snapshot-state.js';
import type { RoomData } from './room-messages.js';
import { applyModelRequest } from '../../../lib/model-usage';

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

test('repeated input previews preserve idle history while accepting a lower effective input', () => {
  const current: RoomData = { ...room, publicCurrentInput: { tokens: 800, images: 0,
    model: 'fixture:model', estimatedAt: '2026-10-24T00:00:00Z' } };
  const refreshed = structuredClone(current);
  refreshed.publicCurrentInput!.estimatedAt = '2026-10-24T00:00:03Z';
  assert.equal(reconcileRoomSnapshot(current, refreshed), current);
  refreshed.publicCurrentInput!.tokens = 400;
  assert.equal(reconcileRoomSnapshot(current, refreshed), refreshed);
});

test('an unchanged count still refreshes the estimate after the last model request', () => {
  const current: RoomData = { ...room, publicCurrentInput: { tokens: 800, images: 0,
    model: 'fixture:model', estimatedAt: '2026-10-24T00:00:00Z' }, modelUsage: applyModelRequest(undefined, {
    id: 'r', purpose: 'conversation', state: 'completed', startedAt: '2026-10-24T00:00:00Z',
    updatedAt: '2026-10-24T00:00:01Z', estimatedInputTokens: 500, imageCount: 0, usageComplete: false,
  }) };
  const refreshed = structuredClone(current);
  refreshed.publicCurrentInput!.estimatedAt = '2026-10-24T00:00:03Z';
  assert.equal(reconcileRoomSnapshot(current, refreshed), refreshed);
  const next = structuredClone(refreshed);
  next.publicCurrentInput!.estimatedAt = '2026-10-24T00:00:06Z';
  assert.equal(reconcileRoomSnapshot(refreshed, next), refreshed);
});
