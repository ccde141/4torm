import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTideRunAfterSuccess } from './schedule.js';

test('最后一次成功执行后不再保留过期的下次触发时间', () => {
  assert.equal(nextTideRunAfterSuccess(0, 'every 10s', 1000), undefined);
  assert.equal(nextTideRunAfterSuccess(2, 'every 10s', 1000), '1970-01-01T00:00:11.000Z');
  assert.equal(nextTideRunAfterSuccess(-1, 'every 10s', 1000), '1970-01-01T00:00:11.000Z');
});
