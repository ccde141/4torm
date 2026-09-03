import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConvectionContent } from './convection-outcome.js';

test('对流只公开 succeeded 的非空正文', () => {
  assert.equal(resolveConvectionContent(' 结论 ', { status: 'succeeded' }), '结论');
  assert.equal(resolveConvectionContent('部分流式正文', { status: 'aborted' }), undefined);
});

test('对流模型失败保持稳定错误身份', () => {
  assert.throws(() => resolveConvectionContent('[错误] 模型请求失败', {
    status: 'failed',
    error: {
      code: 'MODEL_REQUEST_FAILED', kind: 'provider', message: '模型请求失败',
      source: 'react.model', retryable: false,
    },
  }), (error: any) => error.data?.code === 'MODEL_REQUEST_FAILED');
  assert.throws(
    () => resolveConvectionContent('', { status: 'succeeded' }),
    (error: any) => error.data?.code === 'MODEL_EMPTY_RESPONSE',
  );
});
