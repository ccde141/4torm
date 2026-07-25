import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_PRESETS } from './config.js';

test('Anthropic preset declares its native protocol', () => {
  const anthropic = PROVIDER_PRESETS.find(preset => preset.label === 'Anthropic');
  assert.deepEqual(anthropic, {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    protocol: 'anthropic-messages',
  });
});

test('OpenAI-compatible presets remain explicit', () => {
  for (const preset of PROVIDER_PRESETS.filter(item => item.label !== 'Anthropic')) {
    assert.equal(preset.protocol, 'openai-chat-completions');
  }
});
