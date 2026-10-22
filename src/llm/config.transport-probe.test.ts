import assert from 'node:assert/strict';
import test from 'node:test';
import { invalidateCache, probeAndStore, probeVisionAndStore } from './config.js';

for (const capability of ['tools', 'vision'] as const) {
  test(`${capability} probe sends identity only to the backend, never provider credentials`, async t => {
    const previous = globalThis.fetch;
    t.after(() => { globalThis.fetch = previous; invalidateCache(); });
    const result = capability === 'tools'
      ? { reachable: true, native: true, status: 'native-confirmed' }
      : { status: 'supported' };
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push(String(input));
      assert.equal(String(input), '/api/model-runtime/probes');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { providerId: 'pvd_proxy', model: 'demo', capability });
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      return Response.json(result);
    };
    assert.deepEqual(await (capability === 'tools' ? probeAndStore : probeVisionAndStore)('pvd_proxy', 'demo'), result);
    assert.equal(calls.length, 1);
  });
}
