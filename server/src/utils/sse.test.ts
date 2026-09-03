import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError } from '../engine/shared/framework-error.js';
import { pushSSE, pushSSEError } from './sse.js';

test('pushSSE 按调用顺序写入完整 JSON data 帧', () => {
  const chunks: string[] = [];
  const reply = { raw: { write: (chunk: string) => { chunks.push(chunk); } } } as never;

  pushSSE(reply, { type: 'token', content: 'a' });
  pushSSE(reply, { type: 'tool-call', tool: 'read_file', args: { filePath: 'a.txt' } });
  pushSSE(reply, { type: 'done' });

  assert.deepEqual(chunks.map(chunk => JSON.parse(chunk.slice(6, -2))), [
    { type: 'token', content: 'a' },
    { type: 'tool-call', tool: 'read_file', args: { filePath: 'a.txt' } },
    { type: 'done' },
  ]);
});

test('pushSSEError 保留兼容事件并附加稳定错误字段', () => {
  const chunks: string[] = [];
  const reply = { raw: { write: (chunk: string) => { chunks.push(chunk); } } } as never;
  const error = new FrameworkError({
    code: 'MODEL_HTTP_ERROR', kind: 'provider', message: '模型服务不可用',
    source: 'conversation.model', retryable: true,
  });

  pushSSEError(reply, error, 'sse.conversation');

  assert.deepEqual(JSON.parse(chunks[0].slice(6, -2)), {
    type: 'error', message: '模型服务不可用', code: 'MODEL_HTTP_ERROR', kind: 'provider',
  });
});

test('pushSSEError 不发送未知异常中的内部路径', () => {
  const chunks: string[] = [];
  const reply = { raw: { write: (chunk: string) => { chunks.push(chunk); } } } as never;

  pushSSEError(reply, new Error('C:\\private\\secret.txt'), 'sse.room');

  assert.deepEqual(JSON.parse(chunks[0].slice(6, -2)), {
    type: 'error', message: '服务器内部错误', code: 'INTERNAL_ERROR', kind: 'internal',
  });
});
