import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { callLLM, resolveModelPromptBudget } from './llm-bridge.js';
import { FrameworkError } from './framework-error.js';
import { buildProbeBody } from '../../model-runtime/providers/capability-probe.js';
import type { StoredProvider } from '../../model-runtime/config/provider-store.js';
import { modelRuntimeRoutes } from '../../routes/model-runtime.js';

test('configured model lists, probes and inference share authentication precedence without duplicate casing', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-auth-consistency-'));
  const app = Fastify(); app.decorate('dataDir', dataDir); app.decorate('projectRoot', dataDir);
  await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  let expectedProtocol = 'openai-chat-completions';
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    requests++;
    const headers = new Headers(init?.headers);
    if (expectedProtocol === 'openai-chat-completions') {
      assert.equal(headers.get('authorization'), 'Bearer preferred-key');
      assert.equal([...headers.keys()].filter(key => key === 'authorization').length, 1);
    } else {
      assert.equal(headers.get('x-api-key'), 'custom-anthropic-key');
      assert.equal(headers.get('anthropic-version'), '2024-01-01');
      assert.equal(headers.get('authorization'), null);
    }
    return Response.json(init?.method === 'GET' ? { data: [{ id: 'model' }] } : {
      choices: [{ message: { content: 'fixture' }, finish_reason: 'stop' }],
      content: [{ type: 'text', text: 'fixture' }], stop_reason: 'end_turn',
    });
  });
  for (const protocol of ['openai-chat-completions', 'anthropic-messages']) {
    expectedProtocol = protocol;
    const provider = { id: 'p', baseUrl: 'https://provider.test/v1', models: ['model'],
      providerType: protocol === 'anthropic-messages' ? 'anthropic' : 'openai-compatible', transport: protocol,
      apiKey: 'preferred-key', customHeaders: protocol === 'anthropic-messages'
        ? { 'X-Api-Key': 'custom-anthropic-key', 'Anthropic-Version': '2024-01-01' }
        : { authorization: 'first-custom-token', Authorization: 'second-custom-token' } };
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [provider] }));
    const listed = await app.inject({ method: 'POST', url: '/api/model-runtime/models', payload: { providerId: 'p' } });
    assert.equal(listed.statusCode, 200);
    const probe = await app.inject({ method: 'POST', url: '/api/model-runtime/probes',
      payload: { providerId: 'p', model: 'model', capability: 'tools' } });
    assert.equal(probe.statusCode, 200);
    const result = await callLLM({ dataDir, fullModelKey: 'p:model', messages: [{ role: 'user', content: 'fixture' }] });
    assert.equal(result.content, 'fixture');
  }
  assert.equal(requests, 6, 'one list, one probe and one inference per protocol, without replay');
});

test('inference and capability probes honor the same legacy profiles and explicit provider precedence', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-adapter-consistency-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const cases: Array<{ provider: StoredProvider; model: string; field: string }> = [
    { provider: { id: 'p', baseUrl: 'https://proxy.test/v1', modelProfiles: { 'vendor-model': 'kimi' } },
      model: 'vendor-model', field: 'max_completion_tokens' },
    { provider: { id: 'p', baseUrl: 'https://api.moonshot.cn/v1' },
      model: 'kimi-k3', field: 'max_completion_tokens' },
    { provider: { id: 'p', baseUrl: 'https://api.moonshot.cn/v1', providerType: 'openai-compatible',
      transport: 'openai-chat-completions', modelProfiles: { 'kimi-k3': 'kimi' } },
      model: 'kimi-k3', field: 'max_tokens' },
    { provider: { id: 'p', baseUrl: 'https://proxy.test/v1', modelProfiles: { qwen: 'llama-cpp' } },
      model: 'qwen', field: 'max_tokens' },
    { provider: { id: 'p', baseUrl: 'https://proxy.test/v1', providerType: 'kimi',
      transport: 'openai-chat-completions', modelProfiles: { 'vendor-model': 'llama-cpp' } },
      model: 'vendor-model', field: 'max_completion_tokens' },
  ];
  let expected: string;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body[expected], 64);
    assert.equal(body[expected === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'], undefined);
    return Response.json({ choices: [{ message: { content: 'fixture' }, finish_reason: 'stop' }] });
  });
  for (const scenario of cases) {
    expected = scenario.field;
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [scenario.provider] }));
    assert.equal(buildProbeBody(scenario.provider, scenario.model, 'tools')[expected], 64);
    const result = await callLLM({ dataDir, fullModelKey: `p:${scenario.model}`,
      messages: [{ role: 'user', content: 'fixture' }], options: { maxTokens: 64 } });
    assert.equal(result.content, 'fixture');
  }
});

test('an explicit framework budget survives Anthropic custom output defaults', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-output-budget-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://example.test/v1', models: ['claude'],
    providerType: 'anthropic', transport: 'anthropic-messages',
    customRequestParameters: { max_tokens: 512 },
  }] }));
  const received: number[] = [];
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    received.push(JSON.parse(String(init?.body)).max_tokens);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '完成。' }], stop_reason: 'end_turn' }));
  });
  await callLLM({ dataDir, fullModelKey: 'p:claude', messages: [{ role: 'user', content: '压缩记录。' }],
    options: { maxTokens: 52_000 }, outputTokenBudget: 52_000 });
  await callLLM({ dataDir, fullModelKey: 'p:claude', messages: [{ role: 'user', content: '普通对话。' }],
    options: { maxTokens: 52_000 } });
  assert.deepEqual(received, [52_000, 512]);
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for LLM request');
}

test('model prompt budget uses the live llama.cpp slot context', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-llama-budget-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/props');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      default_generation_settings: { n_ctx: 8_192 },
      total_slots: 4,
    }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'local',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    models: ['qwen'],
    providerType: 'llama-cpp',
    transport: 'openai-chat-completions',
  }] }));

  assert.equal(await resolveModelPromptBudget(dataDir, 'local:qwen'), 5_734);
});

test('model prompt budget consumes configured llama.cpp caps and output defaults', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-llama-config-budget-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ default_generation_settings: { n_ctx: 8_192 }, total_slots: 2 }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'local', baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['qwen'],
    providerType: 'llama-cpp', transport: 'openai-chat-completions',
    runtimePolicy: { contextWindowTokens: 6_000, maxConcurrency: 1 },
    generationDefaults: { maxOutputTokens: 1_000 },
  }] }));

  assert.equal(await resolveModelPromptBudget(dataDir, 'local:qwen'), 4_700);
});

test('request execution logs a corrected provider transport without rewriting config', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-correction-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const config = { providers: [{
    id: 'local', baseUrl: 'http://127.0.0.1:8080/v1', models: ['qwen'],
    providerType: 'llama-cpp', transport: 'anthropic-messages',
  }] };
  const configPath = path.join(dataDir, 'providers.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(String(input), 'http://127.0.0.1:8080/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, 2048);
    assert.equal('temperature' in body, false);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
  });

  const result = await callLLM({
    dataDir, fullModelKey: 'local:qwen', messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(result.content, 'ok');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /local.*llama-cpp.*anthropic-messages.*openai-chat-completions/);
  assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')), config);
});

test('OpenAI-compatible requests apply custom provider parameters after defaults', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-custom-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'custom', baseUrl: 'https://example.test/v1', models: ['model'],
    providerType: 'openai-compatible', transport: 'openai-chat-completions',
    customRequestParameters: {
      max_tokens: 321,
      reasoning_effort: 'high',
      chat_template_kwargs: { custom_mode: true },
    },
  }] }));
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, 321);
    assert.equal(body.reasoning_effort, 'high');
    assert.deepEqual(body.chat_template_kwargs, { custom_mode: true });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
  });

  const result = await callLLM({
    dataDir, fullModelKey: 'custom:model', messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(result.content, 'ok');
});

test('protected custom provider fields fail before an OpenAI-compatible request is sent', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-protected-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'custom', baseUrl: 'https://example.test/v1', models: ['model'],
    customRequestParameters: { messages: [] },
  }] }));
  let fetched = false;
  t.mock.method(globalThis, 'fetch', async () => {
    fetched = true;
    return new Response('{}');
  });

  await assert.rejects(callLLM({
    dataDir, fullModelKey: 'custom:model', messages: [{ role: 'user', content: 'hi' }],
  }), /不能覆盖核心字段.*messages/);
  assert.equal(fetched, false);
});

test('provider HTTP failures are surfaced after one request without implicit retry', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-no-retry-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'cloud', baseUrl: 'https://example.test/v1', models: ['model'],
    providerType: 'openai-compatible', transport: 'openai-chat-completions',
  }] }));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response('{"error":{"message":"temporary unavailable"}}', { status: 503 });
  });

  await assert.rejects(callLLM({
    dataDir, fullModelKey: 'cloud:model', messages: [{ role: 'user', content: 'hi' }],
  }), (error: unknown) => error instanceof FrameworkError
    && error.data.code === 'MODEL_PROVIDER_HTTP_503'
    && error.data.message === '模型服务暂时不可用（HTTP 503）');
  assert.equal(requests, 1);
});

test('provider authentication failure is typed without exposing its response body', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-auth-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'cloud', baseUrl: 'https://example.test/v1', models: ['model'], apiKey: 'secret-key',
    providerType: 'openai-compatible', transport: 'openai-chat-completions',
  }] }));
  t.mock.method(globalThis, 'fetch', async () => new Response(
    '{"error":{"message":"bad secret-key"}}', { status: 401 },
  ));

  await assert.rejects(callLLM({
    dataDir, fullModelKey: 'cloud:model', messages: [{ role: 'user', content: 'hi' }],
  }), (error: unknown) => error instanceof FrameworkError
    && error.data.code === 'MODEL_AUTH_FAILED'
    && error.data.message === '模型服务鉴权失败（HTTP 401），请检查 API Key'
    && !JSON.stringify(error.data).includes('secret-key'));
});

test('provider validation failure keeps the safe upstream reason', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-validation-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'cloud', baseUrl: 'https://example.test/v1', models: ['model'],
    providerType: 'openai-compatible', transport: 'openai-chat-completions',
  }] }));
  t.mock.method(globalThis, 'fetch', async () => new Response(
    '{"error":{"message":"reasoning_effort is incompatible with thinking=auto"}}', { status: 400 },
  ));

  await assert.rejects(callLLM({
    dataDir, fullModelKey: 'cloud:model', messages: [{ role: 'user', content: 'hi' }],
  }), (error: unknown) => error instanceof FrameworkError
    && error.data.code === 'MODEL_REQUEST_REJECTED'
    && error.data.message.includes('reasoning_effort is incompatible'));
});

test('callLLM isolates configured concurrency by provider instance', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-scheduling-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    {
      id: 'local-a', baseUrl: 'https://a.test/v1', models: ['qwen'],
      providerType: 'llama-cpp', transport: 'openai-chat-completions',
      runtimePolicy: { maxConcurrency: 1 },
    },
    {
      id: 'local-b', baseUrl: 'https://b.test/v1', models: ['qwen'],
      providerType: 'llama-cpp', transport: 'openai-chat-completions',
      runtimePolicy: { maxConcurrency: 1 },
    },
  ] }));
  const firstResponse = deferred<Response>();
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = String(input);
    requests.push(url);
    if (url.includes('a.test') && requests.filter(item => item.includes('a.test')).length === 1) {
      return firstResponse.promise;
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
  });

  const first = callLLM({
    dataDir, fullModelKey: 'local-a:qwen', messages: [{ role: 'user', content: 'first' }],
  });
  const queued = callLLM({
    dataDir, fullModelKey: 'local-a:qwen', messages: [{ role: 'user', content: 'queued' }],
  });
  const independent = callLLM({
    dataDir, fullModelKey: 'local-b:qwen', messages: [{ role: 'user', content: 'independent' }],
  });

  await waitUntil(() => requests.some(url => url.includes('b.test')));
  assert.equal(requests.filter(url => url.includes('a.test')).length, 1);
  firstResponse.resolve(new Response(JSON.stringify({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  })));
  await Promise.all([first, queued, independent]);
  assert.equal(requests.filter(url => url.includes('a.test')).length, 2);
});
