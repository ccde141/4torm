import assert from 'node:assert/strict';
import test from 'node:test';
import { LLMError } from './client.js';
import {
  buildNativeProbeBody,
  classifyNativeProbeError,
  classifyNativeProbeResponse,
  formatNativeProbeError,
  buildAnthropicNativeProbeBody,
} from './native-probe.js';

test('native capability probe leaves provider-specific temperature unset', () => {
  const requestBody = buildNativeProbeBody('fixed-temperature-model');
  assert.equal('temperature' in requestBody, false);
  assert.equal(requestBody.model, 'fixed-temperature-model');
  assert.equal(requestBody.tool_choice, 'auto');
});

test('Kimi native probe uses its accepted token field', () => {
  const requestBody = buildNativeProbeBody(
    'kimi-k3', 'https://api.moonshot.cn/v1', 'auto',
  );
  assert.equal('max_tokens' in requestBody, false);
  assert.equal(requestBody.max_completion_tokens, 64);
  assert.equal(requestBody.tool_choice, 'auto');
});

test('explicit Kimi profile normalizes compatible proxy probes', () => {
  const requestBody = buildNativeProbeBody(
    'vendor-model', 'https://proxy.example/v1', 'kimi',
  );
  assert.equal(requestBody.max_completion_tokens, 64);
});

test('native probe exposes the provider error without the generic connection hint', () => {
  const error = new LLMError('request failed', 400, {
    error: { message: 'invalid temperature: only 1 is allowed for this model' },
  });
  assert.equal(
    formatNativeProbeError(error),
    'invalid temperature: only 1 is allowed for this model',
  );
});

test('only a real tool call confirms native transport', () => {
  assert.equal(classifyNativeProbeResponse({ choices: [{ message: {} }] }), 'unknown');
  assert.equal(classifyNativeProbeResponse({
    choices: [{ message: { tool_calls: [{ function: { name: 'ping' } }] } }],
  }), 'native-confirmed');
});

test('only explicit rejection of tool fields requires text transport', () => {
  const unsupported = new LLMError('request failed', 400, {
    error: { message: 'This model does not support tools or function calling.' },
  });
  const forcedChoice = new LLMError('request failed', 400, {
    error: { message: "tool_choice 'specified' is incompatible with this model" },
  });
  const unauthorized = new LLMError('request failed', 401, {
    error: { message: 'Invalid API key' },
  });
  const limited = new LLMError('request failed', 429, {
    error: { message: 'Rate limit exceeded' },
  });
  const unavailable = new LLMError('request failed', 503, {
    error: { message: 'Model is busy' },
  });

  assert.equal(classifyNativeProbeError(unsupported), 'text-required');
  assert.equal(classifyNativeProbeError(forcedChoice), 'unknown');
  assert.equal(classifyNativeProbeError(unauthorized), 'unknown');
  assert.equal(classifyNativeProbeError(limited), 'unknown');
  assert.equal(classifyNativeProbeError(unavailable), 'unknown');
});

test('Anthropic probe allows the model to choose the ping tool', () => {
  const body = buildAnthropicNativeProbeBody('claude-test');
  assert.deepEqual(body.tool_choice, { type: 'auto' });
  assert.equal(body.tools[0]?.name, 'ping');
  assert.equal(body.tools[0]?.input_schema.type, 'object');
});
