import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MINIMAX_CONFIG, normalizeMiniMaxConfig } from './minimax-config.js';

test('MiniMax defaults preserve model sampling and thinking choices', () => {
  assert.deepEqual(normalizeMiniMaxConfig(undefined), DEFAULT_MINIMAX_CONFIG);
  assert.deepEqual(DEFAULT_MINIMAX_CONFIG.generationDefaults, {
    maxOutputTokens: 8192,
    temperature: null,
    topP: null,
    thinkingMode: 'auto',
  });
});

test('MiniMax accepts qualified OpenAI-compatible values', () => {
  const source = { generationDefaults: {
    maxOutputTokens: 204800, temperature: 1, topP: 0.9, thinkingMode: 'disabled',
  } };
  assert.deepEqual(normalizeMiniMaxConfig(source), source);
});

test('MiniMax rejects invalid ranges and unqualified fields', () => {
  assert.throws(() => normalizeMiniMaxConfig({ generationDefaults: { temperature: 2.1 } }), /temperature.*0.*2/);
  assert.throws(() => normalizeMiniMaxConfig({ generationDefaults: { topP: -0.1 } }), /topP.*0.*1/);
  assert.throws(() => normalizeMiniMaxConfig({ generationDefaults: { maxOutputTokens: 0 } }), /maxOutputTokens.*1.*204800/);
  assert.throws(() => normalizeMiniMaxConfig({ generationDefaults: { serviceTier: 'priority' } }), /未知 MiniMax 配置字段.*serviceTier/);
});
