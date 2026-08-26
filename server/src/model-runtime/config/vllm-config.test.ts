import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VLLM_CONFIG, normalizeVllmConfig } from './vllm-config.js';

test('vLLM defaults inherit optional sampling and reasoning fields', () => {
  assert.deepEqual(normalizeVllmConfig(undefined), DEFAULT_VLLM_CONFIG);
  assert.deepEqual(DEFAULT_VLLM_CONFIG.generationDefaults, {
    maxOutputTokens: 2048,
    temperature: null,
    topP: null,
    topK: null,
    minP: null,
    repetitionPenalty: null,
    reasoningEffort: 'auto',
  });
});

test('vLLM accepts stable Chat Completion extensions', () => {
  const source = { generationDefaults: {
    maxOutputTokens: 4096, temperature: 0.3, topP: 0.9,
    topK: 40, minP: 0.05, repetitionPenalty: 1.1,
    reasoningEffort: 'xhigh',
  } };
  assert.deepEqual(normalizeVllmConfig(source), source);
});

test('vLLM rejects invalid and unknown formal fields', () => {
  assert.throws(
    () => normalizeVllmConfig({ generationDefaults: { topP: 1.1 } }),
    /generationDefaults\.topP.*0.*1/,
  );
  assert.throws(
    () => normalizeVllmConfig({ generationDefaults: { reasoningEffort: 'extreme' } }),
    /reasoningEffort.*auto.*none.*minimal.*low.*medium.*high.*xhigh.*max/,
  );
  assert.throws(
    () => normalizeVllmConfig({ generationDefaults: { maxModelLen: 32768 } }),
    /未知 vLLM 配置字段：generationDefaults\.maxModelLen/,
  );
});
