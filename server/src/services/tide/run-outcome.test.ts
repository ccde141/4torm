import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTideRunNotTimedOut } from './run-outcome.js';

test('潮汐计时器触发的中止不能伪装成空成功', () => {
  assert.throws(
    () => assertTideRunNotTimedOut(true, 600_000),
    (error: unknown) => error instanceof Error
      && error.message === '潮汐任务执行超时（600s）',
  );
});

test('未超时的正常结果不受影响', () => {
  assert.doesNotThrow(() => assertTideRunNotTimedOut(false, 600_000));
});
