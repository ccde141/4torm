import assert from 'node:assert/strict';
import test from 'node:test';
import { CyclonePrivateChatActivity } from './private-chat-activity.js';

const seatRun = {
  operationId: 'seat:workshop-a:seat-a', runId: 'run-a', workshopId: 'workshop-a',
  targetKind: 'seat' as const, targetId: 'seat-a', phase: 'seat-chat' as const,
  startedAt: '2026-10-10T00:00:00.000Z',
};

test('private chat activity keeps seat and chair events under exact target and run identities', () => {
  const activity = new CyclonePrivateChatActivity();
  const seat = activity.begin(seatRun, 'Seat question');
  const chair = activity.begin({ ...seatRun, operationId: 'room:workshop-a:room-a',
    targetKind: 'room', targetId: 'room-a', phase: 'chair-chat', runId: 'run-chair' }, 'Chair question');
  seat.emit({ type: 'token', content: 'seat' });
  chair.emit({ type: 'reasoning', content: 'chair' });
  assert.deepEqual(activity.read('workshop-a', 'seat', 'seat-a', 0)?.events.map(item => item.event.type), ['token']);
  assert.deepEqual(activity.read('workshop-a', 'chair', 'room-a', 0)?.events.map(item => item.event.type), ['reasoning']);
  assert.equal(activity.read('workshop-a', 'chair', 'seat-a', 0), null);
  seat.finish();
  assert.equal(activity.read('workshop-a', 'seat', 'seat-a', 1)?.running, false);
});

test('private chat activity paginates bounded replay and ignores a stale handle', () => {
  const activity = new CyclonePrivateChatActivity({ maxEvents: 300 });
  const old = activity.begin(seatRun, 'old');
  for (let index = 0; index < 300; index += 1) old.emit({ type: 'token', content: String(index) });
  const page = activity.read('workshop-a', 'seat', 'seat-a', 0);
  assert.equal(page?.events.length, 128);
  assert.equal(page?.latestSeq, 300);
  assert.equal(activity.read('workshop-a', 'seat', 'seat-a', 128)?.events[0]?.seq, 129);
  const next = activity.begin({ ...seatRun, runId: 'run-b' }, 'new');
  old.emit({ type: 'token', content: 'stale' });
  old.finish();
  next.emit({ type: 'token', content: 'fresh' });
  assert.equal(activity.read('workshop-a', 'seat', 'seat-a', 0)?.runId, 'run-b');
  assert.deepEqual(activity.read('workshop-a', 'seat', 'seat-a', 0)?.events.map(item => item.event.content), ['fresh']);
});

test('private chat activity rejects unrelated execution phases', () => {
  const activity = new CyclonePrivateChatActivity();
  assert.throws(() => activity.begin({ ...seatRun, phase: 'seat-resume' }, 'bad'));
});

test('oversized private tool output is bounded and marked incomplete before retention', () => {
  const activity = new CyclonePrivateChatActivity();
  activity.begin(seatRun, 'message').emit({ type: 'tool-result', tool: 'read', ok: true,
    result: { body: 'y'.repeat(2_000_000) } });
  const snapshot = activity.read('workshop-a', 'seat', 'seat-a', 0);
  assert.equal(snapshot?.truncated, true);
  assert.equal(snapshot?.events[0]?.event.type, 'tool-result');
  assert.equal(typeof (snapshot?.events[0]?.event.result as { body?: unknown })?.body, 'string');
  assert.ok(JSON.stringify(snapshot?.events[0]?.event).length <= 8_192);
});
