import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError } from './framework-error.js';
import {
  frameworkHttpErrorFromUnknown,
  frameworkSseErrorFromUnknown,
} from './framework-error-transport.js';

test('HTTP 传输保留旧 error 字段并附加稳定错误身份', () => {
  const result = frameworkHttpErrorFromUnknown(new FrameworkError({
    code: 'MODEL_HTTP_ERROR', kind: 'provider', message: '模型服务返回 503',
    source: 'conversation.model', retryable: true,
  }), 'http.conversation');

  assert.deepEqual(result, {
    statusCode: 502,
    body: {
      error: '模型服务返回 503',
      errorCode: 'MODEL_HTTP_ERROR',
      errorKind: 'provider',
    },
  });
});

test('既有 4xx HTTP 异常保留状态和用户可修正文案', () => {
  const result = frameworkHttpErrorFromUnknown(
    Object.assign(new Error('会话不存在'), { statusCode: 404 }),
    'http.conversation',
  );

  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.body, {
    error: '会话不存在', errorCode: 'HTTP_NOT_FOUND', errorKind: 'not_found',
  });
});

test('未知 HTTP 异常不会向前端泄露路径或堆栈', () => {
  const result = frameworkHttpErrorFromUnknown(
    new Error('ENOENT: C:\\private\\secret.txt\n at internal()'),
    'http.storage',
  );

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, {
    error: '服务器内部错误', errorCode: 'INTERNAL_ERROR', errorKind: 'internal',
  });
});

test('AbortError 作为明确中止而不是内部错误', () => {
  const abort = new Error('This operation was aborted');
  abort.name = 'AbortError';
  const result = frameworkHttpErrorFromUnknown(abort, 'http.stream');

  assert.equal(result.statusCode, 409);
  assert.deepEqual(result.body, {
    error: '请求已中止', errorCode: 'REQUEST_ABORTED', errorKind: 'cancelled',
  });
});

test('SSE 使用相同规范化规则且未知异常安全降级', () => {
  assert.deepEqual(
    frameworkSseErrorFromUnknown(new Error('C:\\private\\secret.txt'), 'sse.room'),
    {
      type: 'error', message: '服务器内部错误', code: 'INTERNAL_ERROR', kind: 'internal',
    },
  );
});
