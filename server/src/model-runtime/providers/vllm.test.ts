import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverProviderRuntimeCapabilities,
  normalizeChatRequestBody,
  resolveMaxOutputTokens,
  resolveProviderModelCapabilities,
  resolveRequestTemperature,
} from './request-normalization.js';
import { resolveProviderAdapter } from './registry.js';

const identity = {
  baseUrl: 'http://127.0.0.1:8000/v1',
  model: 'Qwen/Qwen3-8B',
  providerType: 'vllm' as const,
};

test('explicit vLLM identity owns reasoning replay independently of model family', () => {
  assert.equal(resolveProviderAdapter(identity).id, 'vllm');
  assert.equal(resolveProviderModelCapabilities(identity).reasoningHistory, 'reasoning');
});

test('vLLM discovers loaded context and scheduler concurrency without user guesses', async () => {
  const requested: string[] = [];
  const runtime = await discoverProviderRuntimeCapabilities(identity, async input => {
    requested.push(input);
    if (input.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [
      { id: 'Qwen/Qwen3-8B', max_model_len: 32768 },
    ] }));
    return new Response(JSON.stringify({
      vllm_config: { scheduler_config: { max_num_seqs: 16 } },
    }));
  });
  assert.deepEqual(requested, [
    'http://127.0.0.1:8000/v1/models',
    'http://127.0.0.1:8000/server_info?config_format=json',
  ]);
  assert.deepEqual(runtime, { contextWindowTokens: 32768, parallelSlots: 16 });
});

test('vLLM keeps discovered context when server config metadata is not exposed', async () => {
  const runtime = await discoverProviderRuntimeCapabilities(identity, async input => {
    if (input.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [
      { id: 'Qwen/Qwen3-8B', max_model_len: 32768 },
    ] }));
    return new Response('Not Found', { status: 404 });
  });
  assert.deepEqual(runtime, { contextWindowTokens: 32768 });
});

test('vLLM reports invalid runtime metadata and leaves unloaded models unknown', async () => {
  const unloaded = await discoverProviderRuntimeCapabilities(identity, async () => (
    new Response(JSON.stringify({ data: [{ id: 'another-model', max_model_len: 8192 }] }))
  ));
  assert.equal(unloaded, undefined);
  await assert.rejects(
    discoverProviderRuntimeCapabilities(identity, async () => (
      new Response(JSON.stringify({ data: [{ id: identity.model, max_model_len: 0 }] }))
    )),
    /vLLM 未返回有效上下文容量/,
  );
});

test('vLLM applies only request-owned generation controls', () => {
  const configured = {
    ...identity,
    generationDefaults: {
      maxOutputTokens: 4096, temperature: 0.2, topP: 0.9,
      topK: 40, minP: 0.05, repetitionPenalty: 1.1,
      reasoningEffort: 'low',
    },
  };
  assert.equal(resolveMaxOutputTokens(configured), 4096);
  assert.equal(resolveRequestTemperature(configured), 0.2);
  const body = normalizeChatRequestBody(configured, {
    model: identity.model, messages: [], max_tokens: 8192, temperature: 0.2,
  });
  assert.equal(body.top_p, 0.9);
  assert.equal(body.top_k, 40);
  assert.equal(body.min_p, 0.05);
  assert.equal(body.repetition_penalty, 1.1);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal('max_model_len' in body, false);
  assert.equal('max_num_seqs' in body, false);
  const explicit = normalizeChatRequestBody(configured, {
    model: identity.model, messages: [], max_tokens: 8192, temperature: 0.7,
  });
  assert.equal(explicit.temperature, 0.7);
});

test('vLLM auto fields inherit the loaded model and server defaults', () => {
  assert.equal(resolveMaxOutputTokens(identity), 2048);
  assert.equal(resolveRequestTemperature(identity), undefined);
  const body = normalizeChatRequestBody(identity, {
    model: identity.model, messages: [], max_tokens: 2048,
  });
  for (const key of ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'reasoning_effort']) {
    assert.equal(key in body, false);
  }
});
