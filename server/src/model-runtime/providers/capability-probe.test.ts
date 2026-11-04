import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import { modelRuntimeRoutes } from '../../routes/model-runtime.js';
import { createProvider, findProvider, mutateProviderDocument, patchProvider, type StoredProvider } from '../config/provider-store.js';
import { buildProbeBody, probeConfiguredProvider, requestProbe } from './capability-probe.js';
import { resolveToolTransportContract } from '../config/tool-transport-contract.js';

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
  assert.equal(llama.chat_template_kwargs, undefined);
  assert.equal(llama.max_tokens, 64);
  const proxy = buildProbeBody({ ...provider, modelProfiles: { 'vendor-model': 'kimi' } }, 'vendor-model', 'tools');
  assert.equal(proxy.max_completion_tokens, 64);
  const enabled = buildProbeBody({ ...provider, providerType: 'llama-cpp', generationDefaults: { thinkingMode: 'enabled' },
    customRequestParameters: { max_tokens: 2000 } }, 'model', 'tools');
  assert.deepEqual(enabled.chat_template_kwargs, { enable_thinking: true }); assert.equal(enabled.max_tokens, 64);
  const configured = buildProbeBody({ ...provider, providerType: 'zhipu', generationDefaults: { thinkingMode: 'disabled' },
    customRequestParameters: { top_k: 12, max_tokens: 2000 } }, 'glm-5.3', 'tools');
  assert.deepEqual(configured.thinking, { type: 'disabled' });
  assert.equal(configured.top_k, 12); assert.equal(configured.max_tokens, 64);
});

test('only correct image answers confirm vision; empty, ignored, wrong and embedded errors stay inconclusive', async () => {
  for (const protocol of ['openai-chat-completions', 'anthropic-messages'] as const) {
    for (const response of ['correct', 'empty', 'ignored', 'wrong', 'error']) {
      const result = await requestProbe({ ...provider, providerType: protocol === 'anthropic-messages'
        ? 'anthropic' : 'openai-compatible', transport: protocol }, 'model', 'vision', {
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          const [, image] = body.messages[0].content;
          const png = protocol === 'anthropic-messages' ? image.source.data : image.image_url.url.split(',')[1];
          const { data } = await sharp(Buffer.from(png, 'base64')).raw().toBuffer({ resolveWithObject: true });
          const correct = ['RED', 'GREEN', 'BLUE'][data.indexOf(Math.max(...data.subarray(0, 3)))];
          const answer = response === 'correct' ? correct : response === 'wrong'
            ? ['RED', 'GREEN', 'BLUE'].find(value => value !== correct) : 'OK';
          return Response.json(response === 'empty' ? {} : response === 'error' ? { error: { message: 'probe failed' } }
            : protocol === 'anthropic-messages' ? { content: [{ type: 'text', text: answer }] }
              : { choices: [{ message: { content: answer } }] });
        },
      });
      assert.equal(result.status, response === 'correct' ? 'supported' : 'inconclusive', `${protocol}: ${response}`);
    }
  }
});

test('settings changes invalidate native evidence without exposing custom parameter values', () => {
  const configured = { ...provider, generationDefaults: { thinkingMode: 'disabled' } };
  const fingerprint = resolveToolTransportContract(configured, 'model').fingerprint;
  for (const change of [{ generationDefaults: { thinkingMode: 'enabled' } },
    { customRequestParameters: { private_value: 'not-for-logs' } }, { runtimePolicy: { sentinel: true } }]) {
    const next = resolveToolTransportContract({ ...configured, ...change }, 'model').fingerprint;
    assert.notEqual(next, fingerprint); assert.ok(!next.includes('not-for-logs'));
  }
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
  for (const [name, patch] of [['credentials', { apiKey: 'new-key' }],
    ['generation', { generationDefaults: { thinkingMode: 'enabled' } }],
    ['custom parameters', { customRequestParameters: { top_k: 24 } }]] as const) {
    const dataDir = await temporaryData(t);
    const configured = await createProvider(dataDir, { ...providerPatch(), apiKey: 'first-key', providerType: 'zhipu',
      transport: 'openai-chat-completions', models: ['glm-5.3'], generationDefaults: { thinkingMode: 'disabled' } });
    const result = await probeConfiguredProvider(dataDir, { providerId: configured.id, model: 'glm-5.3', capability: 'tools' }, {
      fetchImpl: async () => {
        await patchProvider(dataDir, configured.id, { ...patch, label: 'Concurrent edit' });
        return Response.json(ping);
      },
    });
    assert.equal('persisted' in result && result.persisted, false, name);
    const current = await findProvider(dataDir, configured.id);
    assert.equal(current.nativeProbe, undefined); assert.equal(current.toolTransports, undefined);
    assert.equal(current.apiKey, 'apiKey' in patch ? patch.apiKey : 'first-key');
    assert.equal(current.label, 'Concurrent edit');
  }
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
    providerType: 'anthropic', transport: 'anthropic-messages', apiKey: 'server-only-secret',
    customRequestParameters: { top_k: 12, max_tokens: 2000 } });
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
  const body = JSON.parse(observed[1].body);
  assert.equal(body.tools[0].name, 'ping'); assert.equal(body.tools[0].input_schema.type, 'object');
  assert.deepEqual(body.tool_choice, { type: 'auto' }); assert.equal(body.top_k, 12); assert.equal(body.max_tokens, 64);
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
