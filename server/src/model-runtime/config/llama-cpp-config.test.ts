import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LLAMA_CPP_CONFIG,
  normalizeLlamaCppConfig,
} from './llama-cpp-config.js';

test('llama.cpp has one complete JSON-safe default configuration', () => {
  assert.deepEqual(DEFAULT_LLAMA_CPP_CONFIG, {
    runtimePolicy: {
      contextWindowTokens: null,
      maxConcurrency: null,
    },
    generationDefaults: {
      maxOutputTokens: 2048,
      temperature: null,
      topK: null,
      topP: null,
      minP: null,
      repeatPenalty: null,
      thinkingMode: 'auto',
      thinkingBudgetTokens: null,
    },
  });
  assert.deepEqual(normalizeLlamaCppConfig({}), DEFAULT_LLAMA_CPP_CONFIG);
  assert.notEqual(normalizeLlamaCppConfig({}), DEFAULT_LLAMA_CPP_CONFIG);
});

test('manual partial configuration is completed without mutating its source', () => {
  const source = {
    runtimePolicy: { contextWindowTokens: 12_000, maxConcurrency: 1 },
    generationDefaults: { maxOutputTokens: 3072, temperature: 0.6, minP: 0.1 },
  };
  assert.deepEqual(normalizeLlamaCppConfig(source), {
    runtimePolicy: { contextWindowTokens: 12_000, maxConcurrency: 1 },
    generationDefaults: {
      maxOutputTokens: 3072,
      temperature: 0.6,
      topK: null,
      topP: null,
      minP: 0.1,
      repeatPenalty: null,
      thinkingMode: 'auto',
      thinkingBudgetTokens: null,
    },
  });
  assert.equal('topK' in source.generationDefaults, false);
});

test('invalid llama.cpp values report their complete configuration path', () => {
  assert.throws(
    () => normalizeLlamaCppConfig({ runtimePolicy: { maxConcurrency: 0 } }),
    /runtimePolicy\.maxConcurrency.*1.*1024/,
  );
  assert.throws(
    () => normalizeLlamaCppConfig({ generationDefaults: { topP: 1.5 } }),
    /generationDefaults\.topP.*0.*1/,
  );
  assert.throws(
    () => normalizeLlamaCppConfig({ generationDefaults: { maxOutputTokens: 'large' } }),
    /generationDefaults\.maxOutputTokens.*整数/,
  );
  assert.throws(
    () => normalizeLlamaCppConfig({ generationDefaults: { thinkingMode: 'sometimes' } }),
    /generationDefaults\.thinkingMode.*auto.*enabled.*disabled/,
  );
  assert.throws(
    () => normalizeLlamaCppConfig({ generationDefaults: { thinkingBudgetTokens: -2 } }),
    /generationDefaults\.thinkingBudgetTokens.*-1.*1000000/,
  );
  assert.throws(
    () => normalizeLlamaCppConfig({
      runtimePolicy: { contextWindowTokens: 2048 },
      generationDefaults: { maxOutputTokens: 2048 },
    }),
    /maxOutputTokens.*contextWindowTokens/,
  );
});

test('unknown llama.cpp configuration sections are rejected instead of ignored', () => {
  assert.throws(
    () => normalizeLlamaCppConfig({ runtimePolicy: {}, mystery: true }),
    /未知 llama\.cpp 配置字段：mystery/,
  );
  assert.throws(
    () => normalizeLlamaCppConfig({ generationDefaults: { magic: 1 } }),
    /未知 llama\.cpp 配置字段：generationDefaults\.magic/,
  );
});
