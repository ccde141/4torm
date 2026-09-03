import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTradewindTermination } from './tradewind-outcome.js';

test('信风拒绝把模型失败和普通异常终态当成节点回答', () => {
  assert.throws(
    () => resolveTradewindTermination({
      status: 'failed',
      error: {
        code: 'MODEL_REQUEST_FAILED', kind: 'provider', message: '模型请求失败',
        source: 'react', retryable: false,
      },
    }),
    (error: unknown) => error instanceof Error && error.message === '模型请求失败',
  );
  assert.throws(
    () => resolveTradewindTermination({
      status: 'anomaly',
      error: {
        code: 'REACT_MAX_TURNS', kind: 'protocol', message: '工具循环未收口',
        source: 'react', retryable: false,
      },
    }),
    (error: unknown) => error instanceof Error && error.message === '工具循环未收口',
  );
});

test('自动信封封口异常保留既有交接语义', () => {
  assert.equal(resolveTradewindTermination({
    status: 'anomaly',
    error: {
      code: 'REACT_COMPLETION_REQUIRED', kind: 'protocol', message: '未显式封口',
      source: 'react', retryable: false,
    },
  }, 'anomaly'), 'deliver-anomaly');
});

test('信风中止终态仍走原有停止分支', () => {
  assert.throws(
    () => resolveTradewindTermination({ status: 'aborted' }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});
