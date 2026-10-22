import assert from 'node:assert/strict';
import test from 'node:test';
import { DEEPSEEK_CONFIG_LIMITS, DEFAULT_DEEPSEEK_CONFIG, normalizeDeepSeekConfig,
  normalizeDeepSeekRuntimeConfig } from './deepseek-config.js';

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

test('DeepSeek output cap accepts 393216 and rejects larger configuration values', () => {
  assert.equal(DEEPSEEK_CONFIG_LIMITS.maxOutputTokens.max, 393_216);
  assert.equal(normalizeDeepSeekConfig({ generationDefaults: { maxOutputTokens: 393_216 } })
    .generationDefaults.maxOutputTokens, 393_216);
  for (const maxOutputTokens of [0, -1, 393_217, 1_000_000, 1.5, Infinity]) {
    assert.throws(() => normalizeDeepSeekConfig({ generationDefaults: { maxOutputTokens } }), /maxOutputTokens/);
  }
});

test('DeepSeek runtime keeps older excessive budgets usable without mutating stored settings', () => {
  const input = { generationDefaults: { maxOutputTokens: 1_000_000, temperature: 1.2 } };
  assert.equal(normalizeDeepSeekRuntimeConfig(input).generationDefaults.maxOutputTokens, 393_216);
  assert.equal(input.generationDefaults.maxOutputTokens, 1_000_000);
  assert.equal(normalizeDeepSeekRuntimeConfig({ generationDefaults: { maxOutputTokens: 1024 } })
    .generationDefaults.maxOutputTokens, 1024);
  for (const maxOutputTokens of [-1, 0, NaN, Infinity, 1.5, '1000000']) {
    assert.throws(() => normalizeDeepSeekRuntimeConfig({ generationDefaults: { maxOutputTokens } }), /maxOutputTokens/);
  }
  assert.throws(() => normalizeDeepSeekRuntimeConfig({ generationDefaults: { maxOutputTokens: 1_000_000, topP: 2 } }), /topP/);
});
