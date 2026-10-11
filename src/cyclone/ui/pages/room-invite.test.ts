import assert from 'node:assert/strict';
import test from 'node:test';
import { inviteSeatToRoom } from './room-invite.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(event: object): Response {
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

test('静默邀请只修改成员名单', async () => {
  const calls: string[] = [];
  const result = await inviteSeatToRoom({ join: async () => { calls.push('join'); }, fetcher: async (url) => {
    calls.push(String(url));
    return jsonResponse({ participantSeatIds: ['seat-a'] });
  }, introUrl: '/room-a/intro', seatId: 'seat-a', behavior: 'none' });

  assert.deepEqual(calls, ['join']);
  assert.deepEqual(result, { joined: true });
});

test('成员已加入但入会发言失败时返回部分成功', async () => {
  let call = 0;
  const result = await inviteSeatToRoom({ join: async () => { call += 1; }, fetcher: async () => {
    call += 1;
    return sseResponse({ type: 'error', message: '模型不可用' });
  }, introUrl: '/room-a/intro', seatId: 'seat-a', behavior: 'summary' });

  assert.deepEqual(result, { joined: true, introError: '模型不可用' });
});

test('成员加入失败时真实抛出且不启动入会发言', async () => {
  let calls = 0;
  await assert.rejects(
    inviteSeatToRoom({ join: async () => {
      calls += 1;
      throw new Error('会议运行中');
    }, fetcher: async () => { calls += 1; return jsonResponse({}); },
    introUrl: '/room-a/intro', seatId: 'seat-a', behavior: 'intro' }),
    /会议运行中/,
  );
  assert.equal(calls, 1);
});

test('邀请使用本地化 fallback 且保留部分成功语义', async () => {
  let call = 0;
  const result = await inviteSeatToRoom({ join: async () => { call += 1; }, fetcher: async () => {
    call += 1;
    return sseResponse({ type: 'error' });
  }, introUrl: '/room-a/intro', seatId: 'seat-a', behavior: 'intro', messages: {
    joinFailed: 'Failed to invite seat',
    introFailed: 'Introduction failed',
    missingStream: 'Missing SSE stream',
    disconnected: 'SSE disconnected',
  } });

  assert.deepEqual(result, { joined: true, introError: 'Introduction failed' });
});
