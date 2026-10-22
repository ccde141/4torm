import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

test('model discovery uses one backend GET against an IPv4 service without CORS and preserves credentials', async t => {
  const seen: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders }> = [];
  const { app, upstream } = await discoveryFixture(t, (request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'local-model', object: 'model' }] }));
  });
  const bare = await app.inject({ method: 'POST', url: '/api/model-runtime/models',
    payload: { baseUrl: `${upstream}/v1`, apiKey: 'test-key' } });
  assert.equal(bare.statusCode, 200);
  assert.deepEqual(bare.json(), { object: 'list', data: [{ id: 'local-model', object: 'model' }] });
  assert.equal(bare.headers['access-control-allow-origin'], undefined);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].url, '/v1/models');
  assert.match(seen[0].headers.host!, /^127\.0\.0\.1:/);
  assert.equal(seen[0].headers.authorization, 'Bearer test-key');
  const custom = await app.inject({ method: 'POST', url: '/api/model-runtime/models', payload: {
    baseUrl: `${upstream}/tenant/v1/models///`, apiKey: 'old-key',
    headers: { authorization: 'Custom override', 'X-Local': 'header-value' },
  } });
  assert.equal(custom.statusCode, 200);
  assert.equal(seen[1].url, '/tenant/v1/models');
  assert.equal(seen[1].headers.authorization, 'Custom override');
  assert.equal(seen[1].headers['x-local'], 'header-value');
  const anthropic = await app.inject({ method: 'POST', url: '/api/model-runtime/models', payload: {
    baseUrl: `${upstream}/v1/models/`, headers: { 'x-api-key': 'test-anthropic', 'anthropic-version': '2023-06-01' },
  } });
  assert.equal(anthropic.statusCode, 200);
  assert.equal(seen[2].headers.authorization, undefined);
  assert.equal(seen[2].headers['x-api-key'], 'test-anthropic');
  assert.equal(seen[2].headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.length, 3, 'no preflight, inference, or retry requests');
});

test('model discovery rejects bad URL credentials, protocols and schemas before requesting upstream', async t => {
  const app = Fastify();
  await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
  t.after(() => app.close());
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('unexpected network request'); });
  for (const payload of [{}, { baseUrl: 'file:///etc/passwd' }, { baseUrl: 'ftp://example.test' },
    { baseUrl: 'http://user:password@example.test/v1' }, { baseUrl: 'not a URL' },
    { baseUrl: 'http://example.test/v1', unknown: true }, { baseUrl: 'http://example.test/v1', apiKey: 4 },
    { baseUrl: 'http://example.test/v1', headers: [] },
    { baseUrl: 'http://example.test/v1', headers: { Authorization: 4 } },
    { baseUrl: 'http://example.test/v1', headers: { 'bad\nname': 'value' } },
    { baseUrl: 'http://example.test/v1', apiKey: 'key\r\ninjected' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/model-runtime/models', payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal(response.json().errorCode, 'MODEL_DISCOVERY_INPUT_INVALID');
    assert.ok(!response.body.includes('password'));
  }
  assert.equal(requests, 0);
});

test('model discovery refuses redirects and preserves an upstream HTTP error without leaking credentials', async t => {
  let redirected = 0; let requests = 0;
  const { app, upstream } = await discoveryFixture(t, (request, response) => {
    requests++;
    if (request.url === '/redirect/models') {
      response.writeHead(307, { Location: '/credential-target/models' }); response.end(); return;
    }
    if (request.url === '/credential-target/models') redirected++;
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Rejected test-secret and custom-secret' } }));
  });
  const redirect = await app.inject({ method: 'POST', url: '/api/model-runtime/models', payload: {
    baseUrl: `${upstream}/redirect`, apiKey: 'test-secret',
  } });
  assert.equal(redirect.statusCode, 502);
  assert.equal(redirect.json().upstreamStatus, 307);
  assert.equal(redirect.json().errorCode, 'MODEL_DISCOVERY_REDIRECT_REFUSED');
  assert.equal(redirect.headers.location, undefined);
  assert.equal(redirected, 0);
  const denied = await app.inject({ method: 'POST', url: '/api/model-runtime/models', payload: {
    baseUrl: `${upstream}/v1`, apiKey: 'test-secret', headers: { 'x-api-key': 'custom-secret' },
  } });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json().upstreamStatus, 401);
  assert.match(denied.json().error, /Rejected/);
  assert.ok(!denied.body.includes('test-secret') && !denied.body.includes('custom-secret'));
  assert.equal(requests, 2, 'each discovery is exactly one GET');
});

test('model discovery exposes invalid responses and transport failures without a hidden retry', async t => {
  let requests = 0;
  const { app, upstream } = await discoveryFixture(t, (request, response) => {
    requests++;
    if (request.url === '/disconnect/models') { request.socket.destroy(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(request.url === '/invalid/models' ? '{broken' : '{"data":[{"id":4}]}');
  });
  for (const endpoint of ['invalid', 'malformed', 'disconnect']) {
    const response = await app.inject({ method: 'POST', url: '/api/model-runtime/models',
      payload: { baseUrl: `${upstream}/${endpoint}` } });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().errorCode, endpoint === 'disconnect'
      ? 'MODEL_DISCOVERY_UNREACHABLE' : 'MODEL_DISCOVERY_RESPONSE_INVALID');
  }
  assert.equal(requests, 3);
});

async function discoveryFixture(t: test.TestContext, handler: http.RequestListener) {
  const upstreamServer = http.createServer(handler);
  await new Promise<void>(resolve => upstreamServer.listen(0, '127.0.0.1', resolve));
  const app = Fastify();
  await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
  t.after(async () => {
    await app.close(); upstreamServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => upstreamServer.close(error => error ? reject(error) : resolve()));
  });
  return { app, upstream: `http://127.0.0.1:${(upstreamServer.address() as AddressInfo).port}` };
}
