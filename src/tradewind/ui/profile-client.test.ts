import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteProfile, listProfiles, saveProfiles } from './profile-client';

test('profile writes only use the collaboration center', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ saved: true }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const profiles = [{ id: 'p-1', name: '持续检查', cadence: { kind: 'relative' as const, gapSec: 30 },
    overlap: 'skip' as const, lapBound: null, carryOver: 'accumulate' as const }];
  await saveProfiles('wf-1', profiles);
  await deleteProfile('wf-1', 'p-1');

  assert.deepEqual(requests, [{
    url: '/api/collaboration/invoke', body: {
      feature: 'tradewind', method: 'saveWorkflowProfiles', input: { workflowId: 'wf-1', profiles },
    },
  }, {
    url: '/api/collaboration/invoke', body: {
      feature: 'tradewind', method: 'deleteWorkflowProfile', input: { workflowId: 'wf-1', profileId: 'p-1' },
    },
  }]);
});

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

test('profile requests use the caller locale fallback when no server detail exists', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 500 });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(saveProfiles('wf-1', [], 'Failed to save loop profiles'), /Failed to save loop profiles \(HTTP 500\)/);
});

test('profile reads use the collaboration center and preserve server failures', async (t) => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([{ id: 'p-1' }]), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.deepEqual(await listProfiles('wf-1'), [{ id: 'p-1' }]);
  assert.deepEqual(body, {
    feature: 'tradewind', method: 'loadWorkflowProfiles', input: { workflowId: 'wf-1' },
  });
});
