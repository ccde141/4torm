import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientFrameworkError,
  errorFromPayload,
  errorFromResponse,
  errorMessage,
  readErrorPayload,
} from './error-contract.js';

test('HTTP 与 SSE 两种错误字段归一为同一前端契约', () => {
  assert.deepEqual(readErrorPayload({
    error: '请求冲突', errorCode: 'SESSION_BUSY', errorKind: 'conflict',
  }, 'fallback'), {
    message: '请求冲突', code: 'SESSION_BUSY', kind: 'conflict',
  });
  assert.deepEqual(readErrorPayload({
    type: 'error', message: '模型超时', code: 'MODEL_TIMEOUT', kind: 'timeout',
  }, 'fallback'), {
    message: '模型超时', code: 'MODEL_TIMEOUT', kind: 'timeout',
  });
});

test('HTTP 响应兼容结构化 JSON 与旧纯文本正文', async () => {
  const structured = await errorFromResponse(new Response(JSON.stringify({
    error: '上游不可用', errorCode: 'MODEL_HTTP_ERROR', errorKind: 'provider',
  }), { status: 502 }));
  assert.equal(structured.message, '上游不可用');
  assert.equal(structured.code, 'MODEL_HTTP_ERROR');
  assert.equal(structured.kind, 'provider');

  const legacy = await errorFromResponse(new Response('旧服务错误', { status: 500 }));
  assert.equal(legacy.message, '旧服务错误');
  assert.equal(legacy.code, undefined);
});

test('旧服务端只有 error/message 时仍可读取', () => {
  assert.equal(errorMessage({ error: '旧 HTTP 错误' }, 'fallback'), '旧 HTTP 错误');
  assert.equal(errorMessage({ message: '旧 SSE 错误' }, 'fallback'), '旧 SSE 错误');
  assert.equal(errorMessage('纯文本错误', 'fallback'), '纯文本错误');
});

test('无效结构使用回退文案且不接受未知错误分类', () => {
  assert.deepEqual(readErrorPayload({
    error: '', errorCode: 12, errorKind: 'mystery',
  }, '请求失败'), { message: '请求失败' });
});

test('构造的错误保留 code/kind 供功能区判断但不改写展示文案', () => {
  const error = errorFromPayload({
    message: '没有权限', code: 'TOOL_PERMISSION_DENIED', kind: 'permission',
  }, 'fallback');
  assert.ok(error instanceof ClientFrameworkError);
  assert.equal(error.message, '没有权限');
  assert.equal(error.code, 'TOOL_PERMISSION_DENIED');
  assert.equal(error.kind, 'permission');
});
