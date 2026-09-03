import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError } from '../framework-error.js';
import { throwForReActFailure, type ReActTermination } from './outcome.js';

test('ReAct failed 终态在功能层重新成为 typed error', () => {
  const termination: ReActTermination = {
    status: 'failed',
    error: {
      code: 'MODEL_HTTP_ERROR', kind: 'provider', message: '模型服务不可用',
      source: 'react.model', retryable: true,
    },
  };

  assert.throws(
    () => throwForReActFailure(termination),
    (error: unknown) => error instanceof FrameworkError
      && error.data.code === 'MODEL_HTTP_ERROR',
  );
});

test('成功、中止和等待终态由功能层自行处理', () => {
  assert.doesNotThrow(() => throwForReActFailure({ status: 'succeeded' }));
  assert.doesNotThrow(() => throwForReActFailure({ status: 'aborted' }));
  assert.doesNotThrow(() => throwForReActFailure({ status: 'waiting' }));
});
