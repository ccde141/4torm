import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapRequestError } from './client.js';

test('request timeout keeps the original abort error as its cause', () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  const wrapped = wrapRequestError(abortError, 'https://example.invalid/models');

  assert.equal(wrapped.cause, abortError);
});
