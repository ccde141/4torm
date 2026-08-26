import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DASHSCOPE_CONFIG, normalizeDashScopeConfig } from './dashscope-config.js';

test('DashScope defaults inherit model-owned sampling and thinking behavior', () => {
  assert.deepEqual(normalizeDashScopeConfig(undefined), DEFAULT_DASHSCOPE_CONFIG);
  assert.deepEqual(DEFAULT_DASHSCOPE_CONFIG.generationDefaults, {
    maxOutputTokens: 8192,
    temperature: null,
    topP: null,
    thinkingMode: 'auto',
    thinkingBudgetTokens: null,
  });
});

test('DashScope accepts the guarded OpenAI-compatible request fields', () => {
  const source = { generationDefaults: {
    maxOutputTokens: 131072,
    temperature: 1.2,
    topP: 0.9,
    thinkingMode: 'enabled',
    thinkingBudgetTokens: 16384,
  } };
  assert.deepEqual(normalizeDashScopeConfig(source), source);
});

test('DashScope rejects invalid ranges, unstable aliases and unknown fields', () => {
  assert.throws(() => normalizeDashScopeConfig({ generationDefaults: { temperature: 2 } }), /temperature.*0.*1\.99/);
  assert.throws(() => normalizeDashScopeConfig({ generationDefaults: { topP: 0 } }), /topP.*0.*1/);
  assert.throws(() => normalizeDashScopeConfig({ generationDefaults: { thinkingBudgetTokens: 0 } }), /thinkingBudgetTokens.*1.*262144/);
  assert.throws(() => normalizeDashScopeConfig({ generationDefaults: { reasoningEffort: 'high' } }), /未知百炼配置字段.*reasoningEffort/);
});
