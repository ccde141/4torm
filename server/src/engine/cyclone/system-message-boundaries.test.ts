import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCycloneChairContext } from './chair-context.js';
import type { RoomData } from './types.js';

test('Cyclone chairs receive complete public history as compressible entries, not a static transcript', () => {
  const identity = { role: 'system' as const, content: 'Static role and permissions' };
  const publicMessages = [{ speaker: '人类', content: 'Public request '.repeat(3000), timestamp: 1 },
    { speaker: 'Worker', content: 'Evidence and result', timestamp: 2 }];
  const room: RoomData = { id: 'room-a', title: 'Meeting', topic: 'Topic', publicMessages,
    participantSeatIds: ['seat-a'], chairMessages: [{ role: 'user', content: 'Private chair request' }],
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
  const messages = buildCycloneChairContext(room, identity);
  assert.deepEqual(messages[0], identity);
  assert.equal(messages.length, 4);
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content, `[公共会议：人类] ${publicMessages[0].content}`);
  assert.equal(messages.at(-1)?.content, 'Private chair request');
});
