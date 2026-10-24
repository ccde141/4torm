import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { estimateCurrentInput } from './llm-bridge.js';
import { observeModelRequests } from './model-request-usage.js';

test('input previews compile messages and tools locally without sending or billing', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-preview-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://example.invalid/v1', models: ['fixture-model'],
  }] }));
  const requests: unknown[] = [];
  let network = 0;
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => { network++; throw new Error('No network allowed'); };
  t.after(() => { globalThis.fetch = fetchBefore; });
  await observeModelRequests(event => requests.push(event), async () => {
    const base = { dataDir, fullModelKey: 'fixture:fixture-model' };
    const long = await estimateCurrentInput({ ...base, messages: [{ role: 'system', content: 'Rules' },
      { role: 'user', content: 'Long input '.repeat(3000) }] });
    const shorter = await estimateCurrentInput({ ...base, messages: [{ role: 'system', content: 'Rules' },
      { role: 'user', content: 'Edited input' }] });
    const tools = await estimateCurrentInput({ ...base, messages: [{ role: 'user', content: 'Edited input' }],
      tools: [{ name: 'fixture_tool', description: 'Tool documentation '.repeat(200), parameters: { type: 'object' } }] });
    assert.equal(long.basis, 'compiled');
    assert.ok(long.tokens > shorter.tokens);
    assert.ok(tools.tokens > shorter.tokens);
  });
  assert.equal(network, 0);
  assert.deepEqual(requests, []);
});

test('unconfigured models still estimate canonical context without counting image base64 as text', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-fallback-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const preview = (length: number) => estimateCurrentInput({ dataDir, fullModelKey: 'removed:model', messages: [
    { role: 'user', content: 'Screenshot', images: [{ id: 'image', name: 'image.png', mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${'A'.repeat(length)}` }] },
  ] });
  const small = await preview(10);
  const large = await preview(100000);
  assert.equal(small.basis, 'canonical');
  assert.equal(large.images, 1);
  assert.equal(small.tokens, large.tokens);
});
