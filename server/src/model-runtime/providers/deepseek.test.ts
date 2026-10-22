import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeChatRequestBody,
  resolveMaxOutputTokens,
  resolveProviderModelCapabilities,
  resolveRequestTemperature,
} from './request-normalization.js';
import { resolveProviderAdapter } from './registry.js';

const baseIdentity = {
  baseUrl: 'https://proxy.example.test/v1',
  model: 'deepseek-v4-flash',
  providerType: 'deepseek' as const,
};

test('explicit DeepSeek identity selects its adapter independently of host', () => {
  assert.equal(resolveProviderAdapter(baseIdentity).id, 'deepseek');
  assert.equal(resolveProviderModelCapabilities(baseIdentity).reasoningHistory, 'reasoning_content');
});

test('DeepSeek formal defaults drive output budget but inherit sampling values', () => {
  assert.equal(resolveMaxOutputTokens(baseIdentity), 8192);
  assert.equal(resolveMaxOutputTokens(baseIdentity, 256), 256);
  assert.equal(resolveRequestTemperature(baseIdentity), undefined);
  assert.equal(resolveRequestTemperature(baseIdentity, 0.4), 0.4);
});

test('DeepSeek output ceilings constrain explicit and legacy budgets without changing smaller values', () => {
  assert.equal(resolveMaxOutputTokens(baseIdentity, 1_000_000), 393_216);
  const legacy = { ...baseIdentity, generationDefaults: { maxOutputTokens: 1_000_000 } };
  assert.equal(resolveMaxOutputTokens(legacy), 393_216);
  assert.equal(resolveRequestTemperature(legacy), undefined);
  assert.deepEqual(legacy.generationDefaults, { maxOutputTokens: 1_000_000 });
  assert.equal(resolveMaxOutputTokens(baseIdentity, 393_216), 393_216);
  assert.equal(resolveMaxOutputTokens(baseIdentity, 64), 64);
});

test('DeepSeek final custom output parameters cannot bypass its request ceiling', () => {
  for (const model of ['deepseek-v4-flash', 'deepseek-chat', 'future-deepseek-model']) {
    const identity = { ...baseIdentity, model,
      generationDefaults: { maxOutputTokens: 1_000_000 },
      customRequestParameters: { max_tokens: 1_000_000 } };
    const body = normalizeChatRequestBody(identity, { model, messages: [], max_tokens: 1024 });
    assert.equal(body.max_tokens, 393_216);
    assert.equal(identity.customRequestParameters.max_tokens, 1_000_000);
  }
  const lower = normalizeChatRequestBody({ ...baseIdentity,
    customRequestParameters: { max_tokens: 256 },
  }, { model: baseIdentity.model, messages: [], max_tokens: 1_000_000 });
  assert.equal(lower.max_tokens, 256);
});

test('DeepSeek rejects malformed final output values before request dispatch', () => {
  for (const max_tokens of [0, -1, 0.5, '1000000', null]) {
    assert.throws(() => normalizeChatRequestBody({ ...baseIdentity,
      customRequestParameters: { max_tokens },
    }, { model: baseIdentity.model, messages: [] }), /max_tokens.*正整数/);
  }
});

test('DeepSeek V4 auto mode preserves API default thinking and removes ignored sampling', () => {
  const body = normalizeChatRequestBody(baseIdentity, {
    model: baseIdentity.model, messages: [], max_tokens: 8192,
    temperature: 0.7, top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.1,
  });
  assert.equal('thinking' in body, false);
  for (const field of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) {
    assert.equal(field in body, false);
  }
});

test('DeepSeek explicit thinking controls compatible request fields', () => {
  const disabled = normalizeChatRequestBody({
    ...baseIdentity,
    generationDefaults: { thinkingMode: 'disabled', temperature: 1.3, topP: 0.8 },
  }, { model: baseIdentity.model, messages: [], max_tokens: 8192, temperature: 0.7 });
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
  assert.equal(disabled.temperature, 1.3);
  assert.equal(disabled.top_p, 0.8);

  const enabled = normalizeChatRequestBody({
    ...baseIdentity,
    generationDefaults: { thinkingMode: 'enabled', reasoningEffort: 'max' },
  }, { model: baseIdentity.model, messages: [], max_tokens: 8192, temperature: 0.7 });
  assert.deepEqual(enabled.thinking, { type: 'enabled' });
  assert.equal(enabled.reasoning_effort, 'max');
  assert.equal('temperature' in enabled, false);
});

test('legacy DeepSeek model names keep their established auto-mode semantics', () => {
  const chat = normalizeChatRequestBody({
    ...baseIdentity, model: 'deepseek-chat', generationDefaults: { temperature: 1 },
  }, { model: 'deepseek-chat', messages: [], max_tokens: 1024, temperature: 0.7 });
  const reasoner = normalizeChatRequestBody({
    ...baseIdentity, model: 'deepseek-reasoner', generationDefaults: {},
  }, { model: 'deepseek-reasoner', messages: [], max_tokens: 1024, temperature: 0.7 });
  assert.equal(chat.temperature, 1);
  assert.equal('thinking' in chat, false);
  assert.equal('temperature' in reasoner, false);
});

test('DeepSeek body-only finalization disables thinking after custom parameters are merged', () => {
  const adapter = resolveProviderAdapter(baseIdentity);
  const body = normalizeChatRequestBody({ ...baseIdentity,
    customRequestParameters: { thinking: { type: 'enabled' }, reasoning_effort: 'max' },
  }, { model: baseIdentity.model, messages: [], max_tokens: 20_000 });
  assert.equal(adapter.disableThinking?.(body, baseIdentity), true);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in body, false);
});
