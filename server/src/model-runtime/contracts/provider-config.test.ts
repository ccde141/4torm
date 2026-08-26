import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isProviderType,
  isTransportId,
  PROVIDER_TYPES,
  TRANSPORT_IDS,
} from './provider-config.js';

test('provider identity and wire transport remain independent discriminators', () => {
  assert.equal(isProviderType('llama-cpp'), true);
  assert.equal(isProviderType('deepseek'), true);
  assert.equal(isTransportId('openai-chat-completions'), true);
  assert.equal(isProviderType('openai-chat-completions'), false);
  assert.equal(isTransportId('llama-cpp'), false);
});

test('provider identities include the cloud candidates without conflating them with transports', () => {
  assert.ok(PROVIDER_TYPES.includes('openai-compatible'));
  assert.ok(PROVIDER_TYPES.includes('llama-cpp'));
  for (const provider of ['kimi', 'dashscope', 'zhipu', 'openrouter', 'minimax', 'siliconflow'] as const) {
    assert.equal(isProviderType(provider), true);
  }
  assert.ok(TRANSPORT_IDS.includes('openai-chat-completions'));
});
