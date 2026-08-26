import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverProviderRuntimeCapabilities,
  normalizeChatRequestBody,
  resolveMaxOutputTokens,
  resolveRequestTemperature,
} from './request-normalization.js';

const identity = {
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen3.5:9b',
  providerType: 'ollama' as const,
};

test('Ollama reads the loaded runner context instead of the model theoretical maximum', async () => {
  let requestedUrl = '';
  const runtime = await discoverProviderRuntimeCapabilities(identity, async input => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ models: [{
      name: identity.model, model: identity.model, context_length: 8192,
    }] }));
  });
  assert.equal(requestedUrl, 'http://127.0.0.1:11434/api/ps');
  assert.deepEqual(runtime, { contextWindowTokens: 8192 });
});

test('Ollama leaves the framework budget unknown when the model is not loaded', async () => {
  const runtime = await discoverProviderRuntimeCapabilities(
    identity,
    async () => new Response(JSON.stringify({ models: [] })),
  );
  assert.equal(runtime, undefined);
});

test('Ollama applies explicit generation defaults while auto reasoning inherits the server', () => {
  const configured = {
    ...identity,
    generationDefaults: {
      maxOutputTokens: 4096, temperature: 0.2, topP: 0.9, reasoningEffort: 'auto',
    },
  };
  assert.equal(resolveMaxOutputTokens(configured), 4096);
  assert.equal(resolveRequestTemperature(configured), 0.2);
  assert.deepEqual(normalizeChatRequestBody(configured, {
    model: identity.model, messages: [], max_tokens: 4096, temperature: 0.2,
  }), {
    model: identity.model, messages: [], max_tokens: 4096, temperature: 0.2, top_p: 0.9,
  });
});

test('Ollama reasoning effort is configurable and custom JSON remains the final override', () => {
  const body = normalizeChatRequestBody({
    ...identity,
    generationDefaults: { reasoningEffort: 'medium' },
    customRequestParameters: { reasoning_effort: 'high' },
  }, { model: identity.model, messages: [], max_tokens: 2048 });
  assert.equal(body.reasoning_effort, 'high');
});
