import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_OLLAMA_CONFIG, normalizeOllamaConfig } from './ollama-config.js';

test('Ollama has JSON-safe generation defaults without a fabricated context limit', () => {
  assert.deepEqual(normalizeOllamaConfig(undefined), DEFAULT_OLLAMA_CONFIG);
  assert.deepEqual(DEFAULT_OLLAMA_CONFIG, {
    generationDefaults: {
      maxOutputTokens: 2048,
      temperature: null,
      topP: null,
      reasoningEffort: 'auto',
    },
  });
});

test('Ollama validates official OpenAI-compatible generation fields', () => {
  assert.deepEqual(normalizeOllamaConfig({ generationDefaults: {
    maxOutputTokens: 4096,
    temperature: 0.2,
    topP: 0.9,
    reasoningEffort: 'high',
  } }), {
    generationDefaults: {
      maxOutputTokens: 4096,
      temperature: 0.2,
      topP: 0.9,
      reasoningEffort: 'high',
    },
  });
  assert.throws(
    () => normalizeOllamaConfig({ generationDefaults: { reasoningEffort: 'extreme' } }),
    /reasoningEffort.*auto、none、low、medium 或 high/,
  );
  assert.throws(
    () => normalizeOllamaConfig({ generationDefaults: { numCtx: 32768 } }),
    /未知 Ollama 配置字段.*numCtx/,
  );
});
