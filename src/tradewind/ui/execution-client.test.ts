import assert from 'node:assert/strict';
import test from 'node:test';
import { requestStop } from './execution-client';

test('stop request reports a real server failure', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: '停止请求失败' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(requestStop(), /停止请求失败/);
});

test('stop treats an already finished execution as stopped', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.doesNotReject(requestStop());
});
