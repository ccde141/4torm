import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_KIMI_CONFIG, normalizeKimiConfig } from './kimi-config.js';

test('Kimi defaults expose only stable generation controls', () => {
  assert.deepEqual(normalizeKimiConfig(undefined), DEFAULT_KIMI_CONFIG);
  assert.deepEqual(DEFAULT_KIMI_CONFIG.generationDefaults, {
    maxOutputTokens: 8192,
    thinkingMode: 'auto',
    reasoningEffort: 'auto',
  });
});

test('Kimi accepts qualified candidate values without mutating input', () => {
  const source = { generationDefaults: {
    maxOutputTokens: 4096,
    thinkingMode: 'enabled',
    reasoningEffort: 'low',
  } };
  assert.deepEqual(normalizeKimiConfig(source), source);
  assert.equal(Object.isFrozen(source), false);
});

test('Kimi rejects invalid and unknown formal fields truthfully', () => {
  assert.throws(
    () => normalizeKimiConfig({ generationDefaults: { maxOutputTokens: 0 } }),
    /maxOutputTokens.*1.*1_000_000|maxOutputTokens.*1.*1000000/,
  );
  assert.throws(
    () => normalizeKimiConfig({ generationDefaults: { thinkingMode: 'adaptive' } }),
    /thinkingMode.*auto.*enabled.*disabled/,
  );
  assert.throws(
    () => normalizeKimiConfig({ generationDefaults: { reasoningEffort: 'medium' } }),
    /reasoningEffort.*auto.*low.*high.*max/,
  );
  assert.throws(
    () => normalizeKimiConfig({ generationDefaults: { temperature: 0.7 } }),
    /未知 Kimi 配置字段：generationDefaults\.temperature/,
  );
});
