import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeFetch } from './runtime-fetch.js';

test('探测复用 Key 和自定义头，Key 优先且大小写不产生重复认证', async () => {
  const request = createRuntimeFetch({ baseUrl: 'http://localhost:1234/v1', apiKey: 'test-only',
    headers: { authorization: 'old', 'x-local': 'yes' } }, async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-only');
    assert.equal(headers.get('x-local'), 'yes');
    assert.equal(init?.redirect, 'error');
    return new Response('{}');
  });
  await request('http://localhost:1234/api/v1/models');
});

test('无 Key 不制造认证头，也支持单独的自定义认证', async () => {
  for (const headers of [undefined, { Authorization: 'Custom token' }]) {
    await createRuntimeFetch({ baseUrl: 'http://localhost:1234/v1', headers }, async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), headers?.Authorization ?? null);
      return new Response('{}');
    })('http://localhost:1234/api/v1/models');
  }
});

test('跨 origin 请求在发送前拒绝；401 不重试、不伪装成功', async () => {
  let calls = 0;
  const request = createRuntimeFetch({ baseUrl: 'http://localhost:1234/v1', apiKey: 'test-only' }, async () => {
    calls++; return new Response('', { status: 401 });
  });
  await assert.rejects(request('http://localhost:9999/models'), /origin/);
  assert.equal(calls, 0);
  assert.equal((await request('http://localhost:1234/api/v1/models')).status, 401);
  assert.equal(calls, 1);
});
