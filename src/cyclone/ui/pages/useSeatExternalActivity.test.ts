import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSeatExternalActivity, settleMissingSeatActivity } from './useSeatExternalActivity.js';
import { emptyLive } from './seat-stream-events.js';

test('legacy seat activity reports HTTP failure and resumes from the same cursor', async () => {
  const payload = { id: 'contact-1', kind: 'contact', label: 'Contact',
    running: true, latestSeq: 4, events: [] };
  await assert.rejects(
    fetchSeatExternalActivity('workshop', 'seat', 3,
      async () => new Response('unavailable', { status: 503 })),
    /503/,
  );
  let requestedUrl = '';
  const recovered = await fetchSeatExternalActivity('workshop', 'seat', 3,
    async input => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(payload), { status: 200 });
    });
  assert.match(requestedUrl, /activity\?since=3$/);
  assert.deepEqual(recovered, payload);
});

test('a successful missing snapshot exposes one settled frame for queue recovery', () => {
  const running = { id: 'contact-1', kind: 'contact' as const, label: 'Contact',
    running: true, live: emptyLive() };
  const settled = settleMissingSeatActivity(running);
  assert.equal(settled?.id, running.id);
  assert.equal(settled?.running, false);
  assert.equal(settleMissingSeatActivity(settled), null);
});
