import assert from 'node:assert/strict';
import test from 'node:test';
import { CycloneRoomActivity } from './room-activity.js';

const execution = {
  operationId: 'room:workshop-a:room-a', runId: 'run-a',
  workshopId: 'workshop-a', targetKind: 'room' as const,
  targetId: 'room-a', phase: 'room-speak' as const,
  startedAt: '2026-10-10T00:00:00.000Z',
};

test('external room activity returns ordered incremental events and a final cursor', () => {
  const activity = new CycloneRoomActivity();
  const run = activity.begin(execution, 'Discuss the design');
  run.emit({ type: 'seat-start', speaker: 'Researcher', turnId: 'turn-a', agentId: 'agent-a' });
  run.emit({ type: 'token', speaker: 'Researcher', content: 'hello' });
  const first = activity.read('workshop-a', 'room-a', 0);
  assert.equal(first?.runId, 'run-a');
  assert.equal(first?.message, 'Discuss the design');
  assert.deepEqual(first?.events.map(item => item.seq), [1, 2]);
  assert.equal(first?.running, true);
  run.finish();
  const last = activity.read('workshop-a', 'room-a', first!.latestSeq);
  assert.deepEqual(last?.events, []);
  assert.equal(last?.running, false);
  assert.equal(activity.read('workshop-a', 'room-b', 0), null);
});

test('a new run replaces the old run and stale handles cannot append to it', () => {
  const activity = new CycloneRoomActivity();
  const old = activity.begin(execution, 'first');
  const next = activity.begin({ ...execution, runId: 'run-b' }, 'second');
  old.emit({ type: 'token', speaker: 'Researcher', content: 'stale' });
  old.finish();
  next.emit({ type: 'token', speaker: 'Researcher', content: 'fresh' });
  const snapshot = activity.read('workshop-a', 'room-a', 0);
  assert.equal(snapshot?.runId, 'run-b');
  assert.equal(snapshot?.running, true);
  assert.deepEqual(snapshot?.events.map(item => item.event.type), ['token']);
});

test('a bounded activity reports a cursor gap rather than pretending to have full history', () => {
  const activity = new CycloneRoomActivity({ maxEvents: 2 });
  const run = activity.begin(execution, 'message');
  for (const content of ['one', 'two', 'three']) {
    run.emit({ type: 'token', speaker: 'Researcher', content });
  }
  assert.equal(activity.read('workshop-a', 'room-a', 0)?.truncated, true);
  assert.deepEqual(activity.read('workshop-a', 'room-a', 1)?.events.map(item => item.seq), [2, 3]);
});

test('large retained activity is delivered in bounded ordered pages', () => {
  const activity = new CycloneRoomActivity({ maxEvents: 300 });
  const run = activity.begin(execution, 'message');
  for (let index = 0; index < 300; index += 1) run.emit({ type: 'token', content: String(index) });
  const first = activity.read('workshop-a', 'room-a', 0);
  assert.equal(first?.latestSeq, 300);
  assert.equal(first?.events.length, 128);
  assert.equal(first?.events.at(-1)?.seq, 128);
  const second = activity.read('workshop-a', 'room-a', 128);
  assert.equal(second?.events[0]?.seq, 129);
  assert.equal(second?.events.length, 128);
});

test('oversized room tool output is bounded and marked incomplete without changing event type', () => {
  const activity = new CycloneRoomActivity();
  activity.begin(execution, 'message').emit({ type: 'tool-result', tool: 'read', ok: true,
    result: { body: 'x'.repeat(2_000_000) } });
  const snapshot = activity.read('workshop-a', 'room-a', 0);
  assert.equal(snapshot?.truncated, true);
  assert.equal(snapshot?.events[0]?.event.type, 'tool-result');
  assert.equal(typeof (snapshot?.events[0]?.event.result as { body?: unknown })?.body, 'string');
  assert.ok(JSON.stringify(snapshot?.events[0]?.event).length <= 8_192);
});
