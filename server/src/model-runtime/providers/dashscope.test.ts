import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChatRequestBody, resolveMaxOutputTokens, resolveRequestTemperature } from './request-normalization.js';

const baseBody = { model: 'qwen3.8-max', messages: [], stream: true, temperature: 0.7, max_tokens: 4096 };

test('DashScope auto mode does not override model-owned thinking defaults', () => {
  const body = normalizeChatRequestBody({
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    providerType: 'dashscope',
  }, baseBody);
  assert.equal('enable_thinking' in body, false);
  assert.equal('preserve_thinking' in body, false);
  assert.equal('thinking_budget' in body, false);
});

test('DashScope sends only explicit qualified generation controls', () => {
  const identity = {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    providerType: 'dashscope' as const,
    generationDefaults: {
      maxOutputTokens: 32768, temperature: 1.1, topP: 0.85,
      thinkingMode: 'enabled', thinkingBudgetTokens: 16384,
    },
  };
  const body = normalizeChatRequestBody(identity, baseBody);
  assert.equal(body.enable_thinking, true);
  assert.equal(body.thinking_budget, 16384);
  assert.equal(body.temperature, 1.1);
  assert.equal(body.top_p, 0.85);
  assert.equal(resolveMaxOutputTokens(identity), 32768);
  assert.equal(resolveRequestTemperature(identity), 1.1);
});

test('DashScope rejects Qwen-specific controls for unrelated hosted models', () => {
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'deepseek-v3.2',
    providerType: 'dashscope',
    generationDefaults: { thinkingMode: 'enabled' },
  }, { ...baseBody, model: 'deepseek-v3.2' }), /未验证显式思考模式/);
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    providerType: 'dashscope',
    generationDefaults: { thinkingBudgetTokens: 4096 },
  }, { ...baseBody, model: 'qwen-turbo' }), /thinkingBudgetTokens.*仅适用于/);
});
