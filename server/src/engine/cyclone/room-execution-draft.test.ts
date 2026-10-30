import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomData } from './types.js';
import { retainRoomExecutionDraft } from './room-execution-draft.js';
import { cycloneMeetingContext } from './meeting-compaction-caller.js';
import { createHash } from 'node:crypto';
import { buildCycloneChairContext } from './chair-context.js';

test('legacy chair anchors keep their exact compacted context when no participant projection field exists', () => {
  const publicRecord = { speaker: 'Writer', content: 'Public checkpoint', timestamp: 1 };
  const room: RoomData = { id: 'room', title: 'Review', topic: '', participantSeatIds: [],
    createdAt: '', updatedAt: '', publicMessages: [publicRecord],
    chairMessages: [{ role: 'user', content: 'ARCHIVED_PRIVATE_INPUT' }],
    chairActiveContext: [{ role: 'system', content: 'Compacted chair handoff' }], chairContextRawCount: 1,
    chairContextPublicVersion: 0, chairContextPublicAnchor: { timestamp: 1,
      hash: createHash('sha256').update(JSON.stringify([publicRecord.speaker, publicRecord.content, undefined])).digest('hex') } };
  const context = buildCycloneChairContext(room, { role: 'system', content: 'Chair rules' });
  assert.match(JSON.stringify(context), /Compacted chair handoff/);
  assert.doesNotMatch(JSON.stringify(context), /ARCHIVED_PRIVATE_INPUT/);
});

test('interrupted compaction progress remains an unfinished execution fact with its actual side effects', () => {
  const room: RoomData = { id: 'room', title: 'Review', topic: '', participantSeatIds: [], publicMessages: [],
    createdAt: '', updatedAt: '', publicExecutionDraft: { id: 'turn', turnId: 'turn', speaker: 'Writer',
      content: '正在核验', timestamp: 1, executionStatus: 'running', reasoning: 'received thought',
      toolCalls: [{ tool: 'write_file', args: { path: 'result.md' }, result: 'written' }],
      segments: [{ kind: 'compaction', id: 'compact', summary: 'handoff' }] } };
  const snapshot = structuredClone(room.publicExecutionDraft);
  retainRoomExecutionDraft(room, 'stopped', 'human stop');
  assert.equal(room.publicExecutionDraft, undefined);
  assert.equal(room.publicMessages[0].executionStatus, 'stopped');
  assert.equal(room.publicMessages[0].reasoning, 'received thought');
  assert.deepEqual(room.publicMessages[0].segments, snapshot?.segments);
  assert.match(cycloneMeetingContext(room.publicMessages)[0].content, /stopped.*human stop/);
  assert.match(cycloneMeetingContext(room.publicMessages)[0].content, /write_file.*result.md.*written/);
  retainRoomExecutionDraft(room, 'stopped', 'duplicate event', snapshot);
  assert.equal(room.publicMessages.length, 1);
});
