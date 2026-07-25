import assert from 'node:assert/strict';
import test from 'node:test';
import { LLMError } from './client.js';
import {
  buildVisionProbeBody,
  classifyVisionProbeError,
  buildAnthropicVisionProbeBody,
} from './vision-probe.js';

test('vision probe uses an OpenAI-compatible inline image without temperature', () => {
  const body = buildVisionProbeBody('vision-model');
  assert.equal(body.model, 'vision-model');
  assert.equal('temperature' in body, false);
  const content = body.messages[0]?.content;
  assert.ok(Array.isArray(content));
  assert.match(content[1]?.image_url.url ?? '', /^data:image\/png;base64,/);
});

test('only explicit image-input rejection becomes unsupported', () => {
  const unsupported = new LLMError('request failed', 400, {
    error: { message: 'This model does not support image inputs.' },
  });
  const unauthorized = new LLMError('request failed', 401, {
    error: { message: 'Invalid API key' },
  });

  assert.equal(classifyVisionProbeError(unsupported), 'unsupported');
  assert.equal(classifyVisionProbeError(unauthorized), 'inconclusive');
});

test('Anthropic vision probe uses a base64 image source block', () => {
  const body = buildAnthropicVisionProbeBody('claude-test');
  const content = body.messages[0]?.content;
  assert.equal(content[1]?.type, 'image');
  assert.equal(content[1]?.source.type, 'base64');
  assert.equal(content[1]?.source.media_type, 'image/png');
});
