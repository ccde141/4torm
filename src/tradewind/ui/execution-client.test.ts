import assert from 'node:assert/strict';
import test from 'node:test';
import {
  abortMeetingRound, abortNodeRound, pauseNodeRound, requestStart, requestStop,
  resumeNodeRound, sendNodeMessage, submitHumanGate,
} from './execution-client';

test('all execution controls use the collaboration center with exact identities', async t => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(input), body });
    const result = body.method === 'startWorkflow'
      ? { operationId: 'wf-1', runId: 'exec-1', executionId: 'exec-1' }
      : { ok: true };
    return new Response(JSON.stringify(result), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await requestStart({ workflowId: 'wf-1' });
  await requestStop('exec-1');
  await submitHumanGate('exec-1', 'gate-1', '通过');
  await abortNodeRound('writer', 'round-1');
  await pauseNodeRound('writer', 'round-2');
  await resumeNodeRound('writer', 'exec-1');
  await abortMeetingRound('review', 'meeting-round-1');
  await sendNodeMessage('exec-1', 'writer', '继续检查');

  assert.deepEqual(requests.map(item => item.url), Array(8).fill('/api/collaboration/invoke'));
  assert.deepEqual(requests.map(item => item.body), [
    { feature: 'tradewind', method: 'startWorkflow', input: { workflowId: 'wf-1' } },
    { feature: 'tradewind', method: 'stopWorkflow', input: { executionId: 'exec-1' } },
    { feature: 'tradewind', method: 'submitHumanGate', input: {
      executionId: 'exec-1', nodeId: 'gate-1', content: '通过',
    } },
    { feature: 'tradewind', method: 'abortNodeRound', input: { nodeId: 'writer', runId: 'round-1' } },
    { feature: 'tradewind', method: 'pauseNodeRound', input: { nodeId: 'writer', runId: 'round-2' } },
    { feature: 'tradewind', method: 'resumeNodeRound', input: { nodeId: 'writer', executionId: 'exec-1' } },
    { feature: 'tradewind', method: 'abortMeetingRound', input: {
      nodeId: 'review', runId: 'meeting-round-1',
    } },
    { feature: 'tradewind', method: 'sendNodeMessage', input: {
      executionId: 'exec-1', nodeId: 'writer', message: '继续检查',
    } },
  ]);
});

test('control failure is reported without a local success transition', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: '轮次已经变化' }),
    { status: 409, headers: { 'Content-Type': 'application/json' } },
  );
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(abortNodeRound('writer', 'stale'), /轮次已经变化/);
});

test('stop request uses the caller locale fallback when no detail exists', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 500 });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(requestStop('exec-1', 'Failed to stop workflow'),
    /Failed to stop workflow \(HTTP 500\)/);
});
