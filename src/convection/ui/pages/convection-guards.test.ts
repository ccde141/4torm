import assert from 'node:assert/strict';
import test from 'node:test';
import { getConvectionCreateError } from './convection-guards';

test('少于两个 Agent 时返回创建提示', () => {
  assert.match(getConvectionCreateError(0) || '', /至少需要 2 个 Agent/);
  assert.match(getConvectionCreateError(1) || '', /至少需要 2 个 Agent/);
});

test('两个及以上 Agent 可以创建', () => {
  assert.equal(getConvectionCreateError(2), null);
  assert.equal(getConvectionCreateError(3), null);
});
