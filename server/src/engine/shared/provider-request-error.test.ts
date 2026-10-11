import assert from 'node:assert/strict';
import test from 'node:test';
import { isProviderContextOverflow, providerHttpError, providerResponseError } from './provider-request-error.js';

test('only explicit context-capacity diagnostics authorize overflow recovery', () => {
  for (const error of [
    { code: 'context_length_exceeded', message: 'bad' },
    { message: "This model's maximum context length is 32768 tokens" },
    { type: 'invalid_request_error', message: 'prompt is too long: 32790 tokens > 32768 maximum' },
  ]) assert.equal(isProviderContextOverflow(providerHttpError(400, JSON.stringify({ error }))), true);
  for (const message of ['unsupported temperature', 'invalid tools', 'invalid reasoning level',
    'quota exceeded', 'max_tokens exceeds output limit']) {
    assert.equal(isProviderContextOverflow(providerHttpError(422, JSON.stringify({ error: { message } }))), false);
  }
  assert.equal(isProviderContextOverflow(providerHttpError(500,
    JSON.stringify({ error: { code: 'context_length_exceeded' } }))), false);
});

test('error packets inside successful stream responses retain typed diagnostics and sanitize keys', () => {
  const error = providerResponseError({ error: { code: 'context_length_exceeded',
    message: 'prompt is too long; Bearer abc-secret sk-123456789abcdef' } });
  assert.equal(isProviderContextOverflow(error), true);
  assert.doesNotMatch(error!.message, /abc-secret|123456789abcdef/);
  assert.equal(providerResponseError({ choices: [{ delta: { content: 'ok' } }] }), null);
});
