import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ZHIPU_CONFIG, normalizeZhipuConfig } from './zhipu-config.js';

test('Zhipu defaults leave sampling and model-specific thinking under explicit control', () => {
  assert.deepEqual(normalizeZhipuConfig(undefined), DEFAULT_ZHIPU_CONFIG);
  assert.deepEqual(DEFAULT_ZHIPU_CONFIG.generationDefaults, {
    maxOutputTokens: 8192,
    temperature: null,
    topP: null,
    thinkingMode: 'auto',
    reasoningEffort: 'auto',
  });
});

test('Zhipu accepts the qualified field values', () => {
  const source = { generationDefaults: {
    maxOutputTokens: 4096, temperature: 0.8, topP: 0.9,
    thinkingMode: 'disabled', reasoningEffort: 'max',
  } };
  assert.deepEqual(normalizeZhipuConfig(source), source);
});

test('Zhipu rejects unstable aliases, invalid ranges and unknown fields', () => {
  assert.throws(() => normalizeZhipuConfig({ generationDefaults: { temperature: 1.1 } }), /temperature.*0\.01.*1/);
  assert.throws(() => normalizeZhipuConfig({ generationDefaults: { topP: 0 } }), /topP.*0\.01.*1/);
  assert.throws(() => normalizeZhipuConfig({ generationDefaults: { reasoningEffort: 'none' } }), /reasoningEffort.*auto.*low.*high.*max/);
  assert.throws(() => normalizeZhipuConfig({ generationDefaults: { doSample: false } }), /未知智谱配置字段.*doSample/);
});
