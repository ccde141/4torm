import assert from 'node:assert/strict';
import test from 'node:test';
import { getProviders, invalidateCache, probeAndStore, updateProvider } from './config.js';

test('provider patches reach the backend in invocation order without resending other configuration', async t => {
  const originalFetch = globalThis.fetch;
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  const writes: string[] = [];
  t.after(() => { globalThis.fetch = originalFetch; invalidateCache(); });
  globalThis.fetch = async (input, init) => {
    if (String(input) === '/api/model-runtime/configuration') return new Response(JSON.stringify({ providers: [{
      id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: [],
    }], activeModel: '' }));
    writes.push(String(init?.body));
    if (writes.length === 1) await firstResponse;
    return new Response('{}');
  };
  invalidateCache();
  await getProviders();
  const first = updateProvider('deepseek', { apiKey: 'a' });
  await new Promise(resolve => setImmediate(resolve));
  const second = updateProvider('deepseek', { apiKey: 'ab' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(writes.map(body => JSON.parse(body).apiKey), ['a', 'ab']);
});

test('a probe clicked during an address save waits for that save without replaying either call', async t => {
  const previous = globalThis.fetch;
  let finish!: () => void;
  const saving = new Promise<void>(resolve => { finish = resolve; });
  const calls: string[] = [];
  t.after(() => { globalThis.fetch = previous; invalidateCache(); });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (init?.method === 'PATCH') { await saving; return Response.json({}); }
    assert.equal(url, '/api/model-runtime/probes');
    return Response.json({ reachable: true, native: true, status: 'native-confirmed' });
  };
  const write = updateProvider('local', { baseUrl: 'http://127.0.0.1:8080/v1' });
  const probe = probeAndStore('local', 'demo');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['/api/model-runtime/configuration/providers/local']);
  finish();
  await Promise.all([write, probe]);
  assert.deepEqual(calls, ['/api/model-runtime/configuration/providers/local', '/api/model-runtime/probes']);
});
