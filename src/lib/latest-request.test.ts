import assert from 'node:assert/strict';
import test from 'node:test';
import { createLatestRequestGuard } from './latest-request';

test('只有最后一次异步选择可以提交结果', () => {
  const guard = createLatestRequestGuard();
  const first = guard.begin();
  const second = guard.begin();
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
});

test('取消后当前请求也不能提交结果', () => {
  const guard = createLatestRequestGuard();
  const request = guard.begin();
  guard.cancel();
  assert.equal(request.isCurrent(), false);
});
