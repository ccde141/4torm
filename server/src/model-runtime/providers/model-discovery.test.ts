import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverModels, ModelDiscoveryError } from './model-discovery.js';

test('discovery preserves IPv6 and remote hosts, sends only GET, and never follows redirects', async () => {
  for (const baseUrl of ['http://[::1]:8080/v1', 'https://models.example.test/tenant/v1/models/']) {
    let calls = 0;
    const result = await discoverModels({ baseUrl }, { fetchImpl: async (input, init) => {
      calls++;
      const actual = new URL(String(input));
      const source = new URL(baseUrl);
      assert.equal(actual.hostname, source.hostname);
      assert.equal(actual.port, source.port);
      assert.equal(actual.pathname, source.pathname.replace(/\/$/, '').endsWith('/models')
        ? source.pathname.replace(/\/$/, '') : `${source.pathname}/models`);
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, 'manual');
      assert.ok(init?.signal);
      return Response.json({ data: [] });
    } });
    assert.deepEqual(result, { data: [] });
    assert.equal(calls, 1);
  }
});

test('discovery timeout is an explicit 504 and does not retry', async () => {
  let calls = 0;
  await assert.rejects(discoverModels({ baseUrl: 'http://127.0.0.1:8080/v1' }, {
    timeoutMs: 1,
    fetchImpl: async (_input, init) => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException('fixture timeout', 'TimeoutError');
    },
  }), error => error instanceof ModelDiscoveryError && error.statusCode === 504
    && error.code === 'MODEL_DISCOVERY_TIMEOUT');
  assert.equal(calls, 1);
});
