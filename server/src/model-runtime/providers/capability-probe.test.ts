import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify from 'fastify';
import { modelRuntimeRoutes } from '../../routes/model-runtime.js';
import { createProvider, findProvider, mutateProviderDocument, patchProvider, type StoredProvider } from '../config/provider-store.js';
import { buildProbeBody, probeConfiguredProvider, requestProbe } from './capability-probe.js';

const provider: StoredProvider = { id: 'fixture', baseUrl: 'https://provider.test/v1', models: ['model'] };
const ping = { choices: [{ message: { tool_calls: [{ function: { name: 'ping' } }] } }] };

test('backend probes preserve ordinary, Kimi, proxy-profile and llama.cpp request semantics', () => {
  const ordinary = buildProbeBody(provider, 'model', 'tools');
  assert.equal(ordinary.temperature, undefined); assert.equal(ordinary.tool_choice, 'auto');
  assert.equal(ordinary.max_tokens, 64);
  for (const configured of [
    { ...provider, baseUrl: 'https://api.moonshot.cn/v1' },
    { ...provider, modelProfiles: { 'kimi-k3': 'kimi' } },
    { ...provider, providerType: 'kimi', transport: 'openai-chat-completions' },
  ]) {
    const body = buildProbeBody(configured, 'kimi-k3', 'tools');
    assert.equal(body.max_completion_tokens, 64); assert.equal(body.max_tokens, undefined);
  }
  const llama = buildProbeBody({ ...provider, modelProfiles: { model: 'llama-cpp' } }, 'model', 'tools');
  assert.deepEqual(llama.chat_template_kwargs, { enable_thinking: false });
  assert.equal(llama.max_tokens, 64);
  const proxy = buildProbeBody({ ...provider, modelProfiles: { 'vendor-model': 'kimi' } }, 'vendor-model', 'tools');
  assert.equal(proxy.max_completion_tokens, 64);
});

test('backend vision and Anthropic probes retain their native image/tool block shapes', () => {
  const vision = buildProbeBody(provider, 'model', 'vision') as {
    temperature?: unknown; messages: Array<{ content: Array<{ image_url: { url: string } }> }>;
  };
  assert.equal(vision.temperature, undefined);
  assert.match(vision.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  const anthropic = buildProbeBody(provider, 'model', 'tools', true) as {
    tool_choice: unknown; tools: Array<{ name: string; input_schema: { type: string } }>;
  };
  assert.deepEqual(anthropic.tool_choice, { type: 'auto' });
  assert.equal(anthropic.tools[0].name, 'ping'); assert.equal(anthropic.tools[0].input_schema.type, 'object');
  const image = buildProbeBody(provider, 'model', 'vision', true) as {
    messages: Array<{ content: Array<{ source: { data: string } }> }>;
  };
  assert.deepEqual(image.messages[0].content[1].source, {
    type: 'base64', media_type: 'image/png', data: image.messages[0].content[1].source.data,
  });
});

test('only actual ping calls confirm native support; ordinary successful replies remain unknown', async () => {
  for (const [body, expected] of [[ping, 'native-confirmed'], [{ choices: [{ message: {} }] }, 'unknown'],
    [{ content: [{ type: 'tool_use', name: 'ping' }] }, 'native-confirmed']] as const) {
    const result = await requestProbe(provider, 'model', 'tools', { fetchImpl: async () => Response.json(body) });
    assert.equal(result.status, expected);
  }
});

test('explicit unsupported input differs from credentials, transient errors and incompatible tool choice', async () => {
  for (const [capability, status, message, expected] of [
    ['tools', 400, 'This model does not support tools or function calling.', 'text-required'],
    ['tools', 400, "tool_choice 'specified' is incompatible with this model", 'unknown'],
    ['tools', 401, 'Invalid API key', 'unknown'], ['tools', 429, 'Rate limit exceeded', 'unknown'],
    ['tools', 503, 'Model is busy', 'unknown'],
    ['tools', 400, 'invalid temperature: only 1 is allowed for this model', 'unknown'],
    ['vision', 400, 'This model does not support image inputs.', 'unsupported'],
    ['vision', 401, 'Invalid API key', 'inconclusive'],
  ] as const) {
    const result = await requestProbe(provider, 'model', capability,
      { fetchImpl: async () => Response.json({ error: { message } }, { status }) });
    assert.equal(result.status, expected); assert.equal(result.error, message);
  }
});

test('failed and redirected probes never leak authentication or retry requests', async () => {
  let requests = 0;
  const secret = { ...provider, apiKey: 'private-key', customHeaders: { 'x-secret': 'header-secret' } };
  const result = await requestProbe(secret, 'model', 'tools', { fetchImpl: async (_input, init) => {
    requests++; assert.equal(init?.redirect, 'manual');
    return Response.json({ error: { message: 'Denied private-key header-secret' } }, { status: 401 });
  } });
  assert.equal(result.error, 'Denied [已隐藏] [已隐藏]'); assert.equal(requests, 1);
  const redirected = await requestProbe(secret, 'model', 'vision', { fetchImpl: async () => {
    requests++; return new Response('', { status: 307, headers: { Location: 'https://another.test' } });
  } });
  assert.equal(redirected.status, 'inconclusive'); assert.equal(requests, 2);
  const timedOut = await requestProbe(secret, 'model', 'tools', { timeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests++;
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException('fixture timeout', 'TimeoutError');
    },
  });
  assert.equal(timedOut.status, 'unknown'); assert.match(timedOut.error!, /超时/);
  assert.equal(requests, 3);
});

test('empty-address draft probes are rejected before making a provider request', async () => {
  let requests = 0;
  await assert.rejects(requestProbe({ ...provider, baseUrl: '' }, 'model', 'tools', {
    fetchImpl: async () => { requests++; return Response.json(ping); },
  }), { statusCode: 400, code: 'MODEL_PROBE_INPUT_INVALID' });
  assert.equal(requests, 0);
});

test('a changed configuration cannot receive stale probe evidence or overwrite a concurrent edit', async t => {
  const dataDir = await temporaryData(t);
  const configured = await createProvider(dataDir, { ...providerPatch(), apiKey: 'first-key' });
  const result = await probeConfiguredProvider(dataDir, { providerId: configured.id, model: 'model', capability: 'tools' }, {
    fetchImpl: async () => {
      await patchProvider(dataDir, configured.id, { apiKey: 'new-key', label: 'Concurrent edit' });
      return Response.json(ping);
    },
  });
  assert.equal('persisted' in result && result.persisted, false);
  const current = await findProvider(dataDir, configured.id);
  assert.equal(current.nativeProbe, undefined); assert.equal(current.apiKey, 'new-key');
  assert.equal(current.label, 'Concurrent edit');
});

test('configuration-backed model lists and probes use backend credentials against a real service without CORS', async t => {
  const dataDir = await temporaryData(t);
  const observed: Array<{ path: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const upstream = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    observed.push({ path: request.url!, headers: request.headers, body });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url?.endsWith('/models') ? { data: [{ id: 'model' }] }
      : { content: [{ type: 'tool_use', name: 'ping' }] }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const app = Fastify(); app.decorate('dataDir', dataDir); app.decorate('projectRoot', dataDir);
  await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
  t.after(async () => {
    await app.close(); upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  });
  const configured = await createProvider(dataDir, { ...providerPatch(),
    baseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
    providerType: 'anthropic', transport: 'anthropic-messages', apiKey: 'server-only-secret' });
  const list = await app.inject({ method: 'POST', url: '/api/model-runtime/models', payload: { providerId: configured.id } });
  assert.equal(list.statusCode, 200); assert.deepEqual(list.json(), { data: [{ id: 'model' }] });
  const probe = await app.inject({ method: 'POST', url: '/api/model-runtime/probes',
    payload: { providerId: configured.id, model: 'model', capability: 'tools' } });
  assert.equal(probe.statusCode, 200); assert.equal(probe.json().status, 'native-confirmed');
  assert.equal(probe.json().persisted, true);
  assert.equal(observed.length, 2);
  assert.deepEqual(observed.map(item => item.path), ['/v1/models', '/v1/messages']);
  for (const request of observed) {
    assert.equal(request.headers['x-api-key'], 'server-only-secret');
    assert.equal(request.headers.authorization, undefined);
  }
  assert.equal(JSON.parse(observed[1].body).tools[0].name, 'ping');
  assert.equal((await findProvider(dataDir, configured.id)).nativeProbe?.model.native, true);
  assert.ok(!probe.body.includes('server-only-secret'));
  await mutateProviderDocument(dataDir, document => {
    document.providers.push({ id: 'legacy-header-provider', baseUrl: configured.baseUrl,
      headers: { Authorization: 'Legacy header-secret' }, models: ['model'] });
  });
  for (const [endpoint, payload] of [
    ['/models', { providerId: 'legacy-header-provider' }],
    ['/probes', { providerId: 'legacy-header-provider', model: 'model', capability: 'tools' }],
  ] as const) {
    const response = await app.inject({ method: 'POST', url: `/api/model-runtime${endpoint}`, payload });
    assert.equal(response.statusCode, 200);
  }
  assert.equal(observed.length, 4);
  for (const request of observed.slice(2)) assert.equal(request.headers.authorization, 'Legacy header-secret');
  const configuration = await app.inject({ method: 'GET', url: '/api/model-runtime/configuration' });
  assert.ok(!configuration.body.includes('header-secret'));
  assert.deepEqual(configuration.json().providers[1].customHeaders, { Authorization: '' });
});

function providerPatch() { return { label: 'Fixture provider', baseUrl: provider.baseUrl, models: ['model'] }; }
async function temporaryData(t: test.TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-probe-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
