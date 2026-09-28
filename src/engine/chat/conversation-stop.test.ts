import assert from 'node:assert/strict';
import test from 'node:test';
import { requestConversationStop } from './conversation-stop';

test('stopping keeps the local SSE alive until the server closes the run', async () => {
  let finish!: (response: Response) => void;
  const requested = new Promise<Response>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const runner = { userStopped: false, abort: () => calls.push('local-abort') };
  const request = (async () => requested) as typeof fetch;

  const stopping = requestConversationStop('session-a', runner, '/abort', request);
  assert.equal(runner.userStopped, true);
  assert.deepEqual(calls, []);

  finish(Response.json({ ok: true }));
  await stopping;
  assert.deepEqual(calls, []);
});

test('a failed stop remains visible and restores steering eligibility', async () => {
  const runner = { userStopped: false, abort: () => undefined };
  const request = (async () => Response.json({ error: 'stop failed' }, { status: 500 })) as typeof fetch;

  await assert.rejects(requestConversationStop('session-a', runner, '/abort', request), /stop failed/);
  assert.equal(runner.userStopped, false);
});
