import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { modelRuntimeRoutes } from './model-runtime.js';
import { resolveNativeMode } from '../engine/shared/llm-bridge.js';

test('model runtime provider catalog is available without reading user configuration', async (t) => {
  const app = Fastify();
  await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/model-runtime/providers' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(Array.isArray(body.providers), true);
  assert.equal(Array.isArray(body.presets), true);
  assert.equal(body.providers.some((provider: { id: string }) => provider.id === 'llama-cpp'), true);
  assert.equal(JSON.stringify(body).includes('apiKey'), false);
});

test('tool transport descriptor agrees with runtime for explicit and legacy providers', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-transport-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const providers = [
    { id: 'explicit-openai', baseUrl: 'https://openai.test/v1', providerType: 'openai-compatible',
      transport: 'openai-chat-completions', protocol: 'anthropic-messages', models: ['demo'] },
    { id: 'explicit-anthropic', baseUrl: 'https://claude.proxy.test/v1', providerType: 'anthropic',
      transport: 'anthropic-messages', protocol: 'openai-chat-completions', models: ['demo'] },
    { id: 'corrected-anthropic', baseUrl: 'https://corrected.proxy.test/v1', providerType: 'anthropic',
      transport: 'openai-chat-completions', protocol: 'openai-chat-completions', models: ['demo'] },
    { id: 'legacy', baseUrl: 'https://legacy.test/v1', protocol: 'anthropic-messages', models: ['demo'] },
  ];
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers }));

  const missingQuery = await app.inject({ method: 'GET', url: '/api/model-runtime/tool-transport' });
  assert.equal(missingQuery.statusCode, 400);
  assert.deepEqual(missingQuery.json(), { error: 'providerId and model are required' });
  const unknownProvider = await app.inject({ method: 'GET',
    url: '/api/model-runtime/tool-transport?providerId=missing&model=demo' });
  assert.equal(unknownProvider.statusCode, 404);
  assert.deepEqual(unknownProvider.json(), { error: 'Provider not found' });

  for (const [id, protocol, parts] of [
    ['explicit-openai', 'openai-chat-completions', 7],
    ['explicit-anthropic', 'anthropic-messages', 7],
    ['corrected-anthropic', 'anthropic-messages', 7],
    ['legacy', 'anthropic-messages', 6],
  ] as const) {
    const response = await app.inject({ method: 'GET',
      url: `/api/model-runtime/tool-transport?providerId=${id}&model=demo` });
    assert.equal(response.statusCode, 200, id);
    const descriptor = response.json();
    assert.equal(descriptor.protocol, protocol, id);
    assert.equal(JSON.parse(descriptor.fingerprint).length, parts, id);
    if (id === 'corrected-anthropic') {
      assert.equal(JSON.parse(descriptor.fingerprint)[2], 'anthropic-messages');
    }
    const provider = providers.find(item => item.id === id)!;
    provider.toolTransports = { demo: { status: 'text-required', checkedAt: 'now',
      fingerprint: descriptor.fingerprint } };
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers }));
    assert.equal((await resolveNativeMode(dataDir, `${id}:demo`)).native, false, id);
  }
});
