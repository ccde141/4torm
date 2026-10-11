import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChatRequestBody, resolveMaxOutputTokens } from './request-normalization.js';
import { resolveProviderAdapter } from './registry.js';

const source = { model: 'model', messages: [], temperature: 0.7, max_tokens: 8192, stream: true };

test('Kimi body-only finalization disables only a verified switchable model', () => {
  for (const model of ['kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3', 'kimi-unknown']) {
    const identity = { baseUrl: 'https://api.moonshot.ai/v1', model, providerType: 'kimi' as const };
    const body: Record<string, unknown> = { thinking: { type: 'enabled' } };
    assert.equal(resolveProviderAdapter(identity).disableThinking?.(body, identity), model === 'kimi-k2.6');
    assert.deepEqual(body.thinking, { type: model === 'kimi-k2.6' ? 'disabled' : 'enabled' });
  }
});

test('Kimi K3 uses its output field and reasoning effort without a K2 thinking object', () => {
  const identity = {
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', providerType: 'kimi' as const,
    generationDefaults: { maxOutputTokens: 4096, thinkingMode: 'enabled', reasoningEffort: 'low' },
  };
  const body = normalizeChatRequestBody(identity, { ...source, model: identity.model, max_tokens: 4096 });
  assert.equal(resolveMaxOutputTokens(identity), 4096);
  assert.equal(body.max_completion_tokens, 4096);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal('thinking' in body, false);
  assert.equal('temperature' in body, false);
});

test('Kimi K3 rejects a disabled thinking selection instead of silently ignoring it', () => {
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', providerType: 'kimi',
    generationDefaults: { thinkingMode: 'disabled' },
  }, { ...source, model: 'kimi-k3' }), /Kimi K3.*不能关闭思考/);
});

test('Kimi K2.6 maps explicit thinking and keeps reasoning history', () => {
  const enabled = normalizeChatRequestBody({
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.6', providerType: 'kimi',
    generationDefaults: { thinkingMode: 'enabled' },
  }, { ...source, model: 'kimi-k2.6' });
  assert.deepEqual(enabled.thinking, { type: 'enabled', keep: 'all' });
  assert.equal('reasoning_effort' in enabled, false);

  const disabled = normalizeChatRequestBody({
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.6', providerType: 'kimi',
    generationDefaults: { thinkingMode: 'disabled' },
  }, { ...source, model: 'kimi-k2.6' });
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
});

test('Kimi K2.7 Code cannot disable thinking and does not accept K3 effort', () => {
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.7-code', providerType: 'kimi',
    generationDefaults: { thinkingMode: 'disabled' },
  }, { ...source, model: 'kimi-k2.7-code' }), /Kimi K2\.7 Code.*不能关闭思考/);
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.7-code', providerType: 'kimi',
    generationDefaults: { reasoningEffort: 'high' },
  }, { ...source, model: 'kimi-k2.7-code' }), /reasoningEffort.*仅适用于 Kimi K3/);
});

test('Kimi K2.6 auto mode leaves its optional thinking switch under model control', () => {
  const body = normalizeChatRequestBody({
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.6', providerType: 'kimi',
  }, { ...source, model: 'kimi-k2.6' });
  assert.equal('thinking' in body, false);
  assert.equal('reasoning_effort' in body, false);
});

test('Kimi K2.7 Code always receives the qualified preserved-thinking contract', () => {
  const body = normalizeChatRequestBody({
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.7-code', providerType: 'kimi',
  }, { ...source, model: 'kimi-k2.7-code' });
  assert.deepEqual(body.thinking, { type: 'enabled', keep: 'all' });
  assert.equal('reasoning_effort' in body, false);
});
