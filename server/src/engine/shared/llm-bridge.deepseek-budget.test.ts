import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM } from './llm-bridge.js';

test('DeepSeek inference applies its ceiling to defaults, custom parameters and framework budgets', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-deepseek-budget-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const provider = {
    id: 'p', baseUrl: 'https://provider.test/v1', models: ['deepseek-v4-flash'],
    providerType: 'deepseek', generationDefaults: { maxOutputTokens: 1_000_000 },
    modelCapabilities: { 'deepseek-v4-flash': { maxOutputTokens: 1_000_000 } },
  };
  const cases = [
    { config: provider, expected: 393_216 },
    { config: provider, options: { maxTokens: 1_000_000 }, expected: 393_216 },
    { config: { ...provider, customRequestParameters: { max_tokens: 1_000_000 } }, expected: 393_216 },
    { config: { ...provider, customRequestParameters: { max_tokens: 1024 } },
      options: { maxTokens: 1_000_000 }, expected: 1024 },
    { config: { ...provider, customRequestParameters: { max_tokens: 1024 } },
      outputTokenBudget: 1_000_000, expected: 393_216 },
    { config: provider, outputTokenBudget: 64, expected: 64 },
    { config: { ...provider, providerType: 'openai-compatible' },
      options: { maxTokens: 1_000_000 }, expected: 1_000_000 },
  ];
  let received = 0;
  let expected = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, expected);
    received += 1;
    return Response.json({ choices: [{ message: { content: 'fixture' }, finish_reason: 'stop' }] });
  });
  for (const scenario of cases) {
    expected = scenario.expected;
    const original = JSON.stringify({ providers: [scenario.config] });
    const configPath = path.join(dataDir, 'providers.json');
    await fs.writeFile(configPath, original);
    await callLLM({ dataDir, fullModelKey: 'p:deepseek-v4-flash',
      messages: [{ role: 'user', content: 'fixture' }],
      options: scenario.options, outputTokenBudget: scenario.outputTokenBudget });
    assert.equal(await fs.readFile(configPath, 'utf8'), original, 'runtime must not rewrite stored settings');
  }
  assert.equal(received, cases.length, 'each invocation dispatches exactly once');
});

test('DeepSeek service rejection remains a single request without automatic replay', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-deepseek-rejection-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://provider.test/v1', models: ['deepseek-v4-flash'], providerType: 'deepseek',
  }] }));
  let received = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    received += 1;
    return new Response('Invalid max_tokens value', { status: 400 });
  });
  await assert.rejects(callLLM({ dataDir, fullModelKey: 'p:deepseek-v4-flash',
    messages: [{ role: 'user', content: 'fixture' }] }), /HTTP 400/);
  assert.equal(received, 1);
});
