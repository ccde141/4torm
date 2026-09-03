import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FrameworkError,
  frameworkError,
  frameworkErrorFromUnknown,
  frameworkErrorToHttp,
  frameworkErrorToSse,
  isFrameworkErrorData,
} from './framework-error.js';

test('preserves a stable framework error across HTTP and SSE transports', () => {
  const error = frameworkError({
    code: 'MODEL_HTTP_ERROR',
    kind: 'provider',
    message: '模型服务返回 HTTP 500',
    source: 'llm-bridge',
    retryable: true,
  });

  assert.deepEqual(frameworkErrorToHttp(error), {
    statusCode: 502,
    body: {
      error: '模型服务返回 HTTP 500',
      errorCode: 'MODEL_HTTP_ERROR',
      errorKind: 'provider',
    },
  });
  assert.deepEqual(frameworkErrorToSse(error), {
    type: 'error',
    message: '模型服务返回 HTTP 500',
    code: 'MODEL_HTTP_ERROR',
    kind: 'provider',
  });
});

test('does not expose an unknown internal error message or cause', () => {
  const source = new Error('C:\\private\\providers.json contained secret-token');
  const error = frameworkErrorFromUnknown(source, 'runtime');

  assert.equal(error.code, 'INTERNAL_ERROR');
  assert.equal(error.kind, 'internal');
  assert.equal(error.message, '服务器内部错误');
  assert.equal(error.source, 'runtime');
  assert.equal(error.retryable, false);
  assert.equal(JSON.stringify(error).includes('secret-token'), false);
  assert.deepEqual(frameworkErrorToHttp(error), {
    statusCode: 500,
    body: {
      error: '服务器内部错误',
      errorCode: 'INTERNAL_ERROR',
      errorKind: 'internal',
    },
  });
});

test('retains typed framework errors while keeping the original cause off the data contract', () => {
  const cause = new Error('provider body');
  const thrown = new FrameworkError({
    code: 'MODEL_TIMEOUT',
    kind: 'timeout',
    message: '模型响应超时',
    source: 'react-loop',
    retryable: false,
  }, { cause });

  const normalized = frameworkErrorFromUnknown(thrown, 'fallback');
  assert.equal(normalized, thrown.data);
  assert.equal(thrown.cause, cause);
  assert.equal('cause' in normalized, false);
});

test('rejects malformed persisted error data at the runtime boundary', () => {
  assert.equal(isFrameworkErrorData({
    code: 'STATE_CONFLICT', kind: 'conflict', message: '状态冲突',
    source: 'cyclone', retryable: false,
  }), true);
  assert.equal(isFrameworkErrorData({
    code: '', kind: 'conflict', message: '状态冲突',
    source: 'cyclone', retryable: false,
  }), false);
  assert.equal(isFrameworkErrorData({
    code: 'STATE_CONFLICT', kind: 'unknown', message: '状态冲突',
    source: 'cyclone', retryable: false,
  }), false);
});
