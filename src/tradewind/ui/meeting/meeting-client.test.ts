import assert from 'node:assert/strict';
import test from 'node:test';
import {
  endMeeting, joinMeeting, leaveMeeting, reorderMeeting, sendChair, sendSpeak,
} from './meeting-client';

test('meeting administration uses center commands with execution identity', async t => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    return new Response(JSON.stringify(body.method === 'endMeeting'
      ? { minutes: '纪要' } : { participants: [] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await endMeeting('exec-1', 'meeting-1');
  await joinMeeting('exec-1', 'meeting-1', 'writer');
  await leaveMeeting('exec-1', 'meeting-1', 'writer');
  await reorderMeeting('exec-1', 'meeting-1', ['reviewer', 'writer']);
  await sendSpeak('exec-1', 'meeting-1', '请开始评审');
  await sendChair('exec-1', 'meeting-1', '有哪些风险？');

  assert.deepEqual(requests, [
    { feature: 'tradewind', method: 'endMeeting', input: {
      executionId: 'exec-1', nodeId: 'meeting-1',
    } },
    { feature: 'tradewind', method: 'joinMeeting', input: {
      executionId: 'exec-1', nodeId: 'meeting-1', participantNodeId: 'writer',
    } },
    { feature: 'tradewind', method: 'leaveMeeting', input: {
      executionId: 'exec-1', nodeId: 'meeting-1', participantNodeId: 'writer',
    } },
    { feature: 'tradewind', method: 'reorderMeeting', input: {
      executionId: 'exec-1', nodeId: 'meeting-1', order: ['reviewer', 'writer'],
    } },
    { feature: 'tradewind', method: 'speakMeeting', input: {
      executionId: 'exec-1', nodeId: 'meeting-1', message: '请开始评审',
    } },
    { feature: 'tradewind', method: 'messageMeetingChair', input: {
      executionId: 'exec-1', nodeId: 'meeting-1', message: '有哪些风险？',
    } },
  ]);
});

test('meeting administration exposes center failure', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '会议轮次仍在进行' }), {
    status: 409, headers: { 'Content-Type': 'application/json' },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(endMeeting('exec-1', 'meeting-1'), /会议轮次仍在进行/);
});
