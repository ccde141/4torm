import assert from 'node:assert/strict';
import test from 'node:test';
import { requestConversationStop } from './conversation-stop';

test('stopping keeps the local SSE alive until the server closes the run', async () => {
  let finish!: (response: Response) => void;
  const requested = new Promise<Response>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const runner = { userStopped: false, abort: () => calls.push('local-abort') };
  let sent = '';
  const request = (async (_url, init) => {
    sent = String(init?.body); return requested;
  }) as typeof fetch;

  const stopping = requestConversationStop('session-a', 'run-a', runner, request);
  assert.equal(runner.userStopped, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(JSON.parse(sent), {
    feature: 'monsoon', method: 'stopRun',
    input: { sessionId: 'session-a', runId: 'run-a' },
  });

  finish(Response.json({ ok: true }));
  await stopping;
  assert.deepEqual(calls, []);
});

test('a failed stop remains visible and restores steering eligibility', async () => {
  const runner = { userStopped: false, abort: () => undefined };
  const request = (async () => Response.json({ error: 'stop failed' }, { status: 500 })) as typeof fetch;

  await assert.rejects(requestConversationStop('session-a', 'run-a', runner, request), /stop failed/);
  assert.equal(runner.userStopped, false);
});
