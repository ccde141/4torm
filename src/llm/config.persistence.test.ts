import assert from 'node:assert/strict';
import test from 'node:test';
import { getProviders, invalidateCache, updateProvider } from './config.js';

test('provider edits reach storage in invocation order', async t => {
  const originalFetch = globalThis.fetch;
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  const writes: string[] = [];
  t.after(() => { globalThis.fetch = originalFetch; invalidateCache(); });
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/read')) return new Response(JSON.stringify({ providers: [{
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
  assert.deepEqual(writes.map(body => JSON.parse(body).providers[0].apiKey), ['a', 'ab']);
});
