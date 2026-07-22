import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteProfile, saveProfiles } from './profile-client';

test('profile save reports the server error', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: '循环档案写入失败' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(saveProfiles('wf-1', []), /循环档案写入失败/);
});

test('profile delete reports failure instead of updating the local list', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: '档案不存在：p-1' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  );
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(deleteProfile('wf-1', 'p-1'), /档案不存在/);
});
