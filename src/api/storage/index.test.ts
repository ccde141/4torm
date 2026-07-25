import assert from 'node:assert/strict';
import test from 'node:test';
import { writeJson } from './index.js';

test('幂等写入遇到 502 后自动重试', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('', { status: calls === 1 ? 502 : 200 });
  });

  await writeJson('agents/example/session.json', { ok: true });
  assert.equal(calls, 2);
});

test('幂等写入遇到短暂网络中断后自动重试', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) throw new TypeError('fetch failed');
    return new Response('', { status: 200 });
  });

  await writeJson('agents/example/session.json', { ok: true });
  assert.equal(calls, 2);
});

test('幂等写入遇到 400 时直接抛错', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('', { status: 400 });
  });

  await assert.rejects(writeJson('agents/example/session.json', { ok: true }), /写入失败: 400/);
  assert.equal(calls, 1);
});

test('连续 502 只尝试四次并保留最终错误', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('', { status: 502 });
  });

  await assert.rejects(writeJson('agents/example/session.json', { ok: true }), /写入失败: 502/);
  assert.equal(calls, 4);
});
