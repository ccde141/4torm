import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DEEPSEEK_CONFIG, normalizeDeepSeekConfig } from './deepseek-config.js';

test('DeepSeek defaults leave optional API fields under provider control', () => {
  assert.deepEqual(normalizeDeepSeekConfig(undefined), DEFAULT_DEEPSEEK_CONFIG);
  assert.deepEqual(DEFAULT_DEEPSEEK_CONFIG.generationDefaults, {
    maxOutputTokens: 8192,
    temperature: null,
    topP: null,
    thinkingMode: 'auto',
    reasoningEffort: 'auto',
  });
});

test('DeepSeek accepts stable generation fields without mutating input', () => {
  const source = { generationDefaults: {
    maxOutputTokens: 4096,
    temperature: 1.3,
    topP: 0.8,
    thinkingMode: 'disabled',
    reasoningEffort: 'max',
  } };
  assert.deepEqual(normalizeDeepSeekConfig(source), source);
  assert.equal(Object.isFrozen(source), false);
});

test('DeepSeek rejects invalid and unknown formal fields truthfully', () => {
  assert.throws(
    () => normalizeDeepSeekConfig({ generationDefaults: { temperature: 2.1 } }),
    /generationDefaults\.temperature.*0.*2/,
  );
  assert.throws(
    () => normalizeDeepSeekConfig({ generationDefaults: { thinkingMode: 'sometimes' } }),
    /thinkingMode.*auto.*enabled.*disabled/,
  );
  assert.throws(
    () => normalizeDeepSeekConfig({ generationDefaults: { reasoningEffort: 'medium' } }),
    /reasoningEffort.*auto.*low.*high.*max/,
  );
  assert.throws(
    () => normalizeDeepSeekConfig({ generationDefaults: { beta_magic: true } }),
    /未知 DeepSeek 配置字段：generationDefaults\.beta_magic/,
  );
});
