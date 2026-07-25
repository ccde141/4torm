import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderProtocol } from './provider-protocol.js';

test('explicit provider protocol wins over URL inference', () => {
  assert.equal(
    resolveProviderProtocol('https://api.anthropic.com/v1', 'openai-chat-completions'),
    'openai-chat-completions',
  );
});

test('Anthropic official endpoint is recognized in automatic mode', () => {
  assert.equal(
    resolveProviderProtocol('https://api.anthropic.com/v1', 'auto'),
    'anthropic-messages',
  );
});

test('legacy and unknown endpoints remain OpenAI compatible by default', () => {
  assert.equal(resolveProviderProtocol('https://example.com/claude/v1'), 'openai-chat-completions');
  assert.equal(resolveProviderProtocol('not a url', 'auto'), 'openai-chat-completions');
});
