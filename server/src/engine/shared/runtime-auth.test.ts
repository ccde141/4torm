import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveModelPromptBudget } from './llm-bridge.js';

test('LM Studio 预算探测从提供商配置传递认证，401 保持真实失败', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-runtime-auth-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'local', baseUrl: 'http://localhost:1234/v1', apiKey: 'test-only',
    customHeaders: { 'x-proxy-auth': 'test-proxy' }, models: ['local-model'],
    providerType: 'lm-studio', transport: 'openai-chat-completions',
  }] }));
  let fail = false;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls++;
    assert.equal(url, 'http://localhost:1234/api/v1/models');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-only');
    assert.equal(new Headers(init?.headers).get('x-proxy-auth'), 'test-proxy');
    if (fail) return new Response('', { status: 401 });
    return Response.json({ models: [{ key: 'local-model', loaded_instances: [{ id: 'instance', config: { context_length: 32768 } }] }] });
  });
  assert.ok((await resolveModelPromptBudget(dataDir, 'local:local-model'))! > 0);
  fail = true;
  await assert.rejects(resolveModelPromptBudget(dataDir, 'local:local-model'), /HTTP 401/);
  assert.equal(calls, 2);
});
