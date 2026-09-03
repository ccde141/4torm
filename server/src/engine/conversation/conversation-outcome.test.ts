import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConversationTermination } from './conversation-outcome.js';

test('季风只把 succeeded 终态投影为正常完成', () => {
  assert.equal(resolveConversationTermination({ status: 'succeeded' }), 'succeeded');
  assert.equal(resolveConversationTermination({ status: 'aborted' }), 'aborted');
});

test('季风不会把模型失败或无挂起信息的 waiting 当成回答', () => {
  assert.throws(() => resolveConversationTermination({
    status: 'failed',
    error: {
      code: 'MODEL_REQUEST_FAILED', kind: 'provider', message: '模型请求失败',
      source: 'react.model', retryable: false,
    },
  }), (error: any) => error.data?.code === 'MODEL_REQUEST_FAILED');
  assert.throws(
    () => resolveConversationTermination({ status: 'waiting' }),
    (error: any) => error.data?.code === 'CONVERSATION_WAITING_STATE_MISSING',
  );
});
