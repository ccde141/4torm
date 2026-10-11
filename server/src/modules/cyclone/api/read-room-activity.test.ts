import assert from 'node:assert/strict';
import test from 'node:test';
import { CycloneRoomActivity } from '../application/room-activity.js';
import { CyclonePrivateChatActivity } from '../application/private-chat-activity.js';
import { cycloneReadHandlers, cycloneReadManifests } from './read-methods.js';

test('room activity is a human/internal bounded query and rejects invalid cursors', async () => {
  const activity = new CycloneRoomActivity();
  const handle = activity.begin({
    workshopId: 'workshop-a', targetKind: 'room', targetId: 'room-a',
    operationId: 'room:workshop-a:room-a', runId: 'run-a',
    phase: 'room-speak', startedAt: '2026-10-10T00:00:00.000Z',
  }, 'Discuss');
  handle.emit({ type: 'token', speaker: 'Researcher', content: 'one' });
  const manifest = cycloneReadManifests(undefined, activity)
    .find(item => item.id === 'readRoomActivity');
  assert.deepEqual(manifest?.audiences, ['human', 'internal']);
  const handlers = cycloneReadHandlers({ roomActivity: activity } as never);
  const handler = handlers.readRoomActivity;
  assert.ok(handler);
  const input = handler.parse({ workshopId: 'workshop-a', roomId: 'room-a', since: 0 });
  const snapshot = await handler.invoke({} as never, input) as { runId: string; latestSeq: number };
  assert.equal(snapshot.runId, 'run-a');
  assert.equal(snapshot.latestSeq, 1);
  assert.throws(() => handler.parse({ workshopId: 'workshop-a', roomId: 'room-a', since: -1 }));
  assert.throws(() => handler.parse({ workshopId: 'workshop-a', roomId: 'room-a', since: 0, extra: true }));
});

test('private chat activity is human/internal only and rejects cross-target or invalid cursors', async () => {
  const activity = new CyclonePrivateChatActivity();
  const handle = activity.begin({
    workshopId: 'workshop-a', targetKind: 'seat', targetId: 'seat-a',
    operationId: 'seat:workshop-a:seat-a', runId: 'run-a',
    phase: 'seat-chat', startedAt: '2026-10-10T00:00:00.000Z',
  }, 'Hello');
  handle.emit({ type: 'token', content: 'one' });
  const manifest = cycloneReadManifests(undefined, undefined, activity)
    .find(item => item.id === 'readPrivateChatActivity');
  assert.deepEqual(manifest?.audiences, ['human', 'internal']);
  const handler = cycloneReadHandlers({ privateActivity: activity } as never).readPrivateChatActivity;
  const input = handler.parse({ workshopId: 'workshop-a', targetKind: 'seat', targetId: 'seat-a', since: 0 });
  const snapshot = await handler.invoke({} as never, input) as { phase: string; latestSeq: number };
  assert.equal(snapshot.phase, 'seat-chat');
  assert.equal(snapshot.latestSeq, 1);
  assert.throws(() => handler.parse({ workshopId: 'workshop-a', targetKind: 'room', targetId: 'seat-a' }));
  assert.throws(() => handler.parse({ workshopId: 'workshop-a', targetKind: 'seat', targetId: 'seat-a', since: 1.2 }));
});
