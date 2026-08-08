import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchConvectionRead } from './convection-load-retry.js';

test('对流启动读取在后端短暂拒绝连接后自动恢复', async () => {
  let calls = 0;
  const request = fetchConvectionRead('/api/convection/list', async () => {
    calls++;
    if (calls === 1) throw new TypeError('fetch failed');
    return new Response('[]', { status: 200 });
  }, async () => {});

  const response = await request;

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('对流启动读取会重试代理暂时返回的 500', async () => {
  let calls = 0;
  const request = fetchConvectionRead('/api/convection/list', async () => {
    calls++;
    return new Response('', { status: calls === 1 ? 500 : 200 });
  }, async () => {});

  const response = await request;

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('对流读取不重试真实的会话不存在响应', async () => {
  let calls = 0;
  const response = await fetchConvectionRead('/api/convection/session/missing/status', async () => {
    calls++;
    return new Response('', { status: 404 });
  });

  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});
