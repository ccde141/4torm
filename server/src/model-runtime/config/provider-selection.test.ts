import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderSelection } from './provider-selection.js';

test('explicit provider identity and transport take priority over legacy fields', () => {
  assert.deepEqual(resolveProviderSelection({
    providerType: 'llama-cpp',
    transport: 'openai-chat-completions',
    protocol: 'anthropic-messages',
    modelProfiles: { qwen: 'openai-compatible' },
  }, 'qwen'), {
    providerType: 'llama-cpp',
    transport: 'openai-chat-completions',
    source: 'explicit',
  });
});

test('legacy llama.cpp model profile remains readable without rewriting config', () => {
  assert.deepEqual(resolveProviderSelection({
    protocol: 'openai-chat-completions',
    modelProfiles: { qwen: 'llama-cpp' },
  }, 'qwen'), {
    providerType: 'llama-cpp',
    transport: 'openai-chat-completions',
    source: 'legacy',
  });
});

test('legacy Anthropic protocol maps to its provider and transport', () => {
  assert.deepEqual(resolveProviderSelection({ protocol: 'anthropic-messages' }, 'claude'), {
    providerType: 'anthropic',
    transport: 'anthropic-messages',
    source: 'legacy',
  });
});

test('unmarked legacy providers preserve generic OpenAI-compatible behavior', () => {
  assert.deepEqual(resolveProviderSelection({}, 'model'), {
    providerType: 'openai-compatible',
    transport: 'openai-chat-completions',
    source: 'legacy',
  });
});

test('invalid explicit discriminators fail instead of silently falling back', () => {
  assert.throws(
    () => resolveProviderSelection({ providerType: 'mystery' }, 'model'),
    /未知模型提供商类型/,
  );
  assert.throws(
    () => resolveProviderSelection({ providerType: 'llama-cpp', transport: 'mystery' }, 'model'),
    /未知模型传输协议/,
  );
});

test('known provider and transport conflicts are corrected with one diagnostic', () => {
  const diagnostics: unknown[] = [];
  assert.deepEqual(resolveProviderSelection({
    providerType: 'llama-cpp',
    transport: 'anthropic-messages',
  }, 'qwen', diagnostic => diagnostics.push(diagnostic)), {
    providerType: 'llama-cpp',
    transport: 'openai-chat-completions',
    source: 'explicit',
  });
  assert.deepEqual(diagnostics, [{
    code: 'transport-corrected',
    providerType: 'llama-cpp',
    configuredTransport: 'anthropic-messages',
    effectiveTransport: 'openai-chat-completions',
  }]);
});

test('valid explicit configuration emits no diagnostic', () => {
  const diagnostics: unknown[] = [];
  resolveProviderSelection({
    providerType: 'openai-compatible',
    transport: 'openai-chat-completions',
  }, 'model', diagnostic => diagnostics.push(diagnostic));
  assert.deepEqual(diagnostics, []);
});
