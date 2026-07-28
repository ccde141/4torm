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
  const result = await inviteSeatToRoom(async (url) => {
    calls.push(String(url));
    return jsonResponse({ participantSeatIds: ['seat-a'] });
  }, '/room-a', 'seat-a', 'none');

  assert.deepEqual(calls, ['/room-a/join']);
  assert.deepEqual(result, { joined: true });
});

test('成员已加入但入会发言失败时返回部分成功', async () => {
  let call = 0;
  const result = await inviteSeatToRoom(async () => {
    call += 1;
    return call === 1
      ? jsonResponse({ participantSeatIds: ['seat-a'] })
      : sseResponse({ type: 'error', message: '模型不可用' });
  }, '/room-a', 'seat-a', 'summary');

  assert.deepEqual(result, { joined: true, introError: '模型不可用' });
});

test('成员加入失败时真实抛出且不启动入会发言', async () => {
  let calls = 0;
  await assert.rejects(
    inviteSeatToRoom(async () => {
      calls += 1;
      return jsonResponse({ error: '会议运行中' }, 409);
    }, '/room-a', 'seat-a', 'intro'),
    /会议运行中/,
  );
  assert.equal(calls, 1);
});
