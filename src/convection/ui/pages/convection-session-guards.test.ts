import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldLoadConvectionSession } from './convection-session-guards';

test('当前会话或正在加载的会话不重复请求', () => {
  assert.equal(shouldLoadConvectionSession('conv-a', 'conv-a', null), false);
  assert.equal(shouldLoadConvectionSession('conv-a', null, 'conv-a'), false);
});

test('新会话允许加载', () => {
  assert.equal(shouldLoadConvectionSession('conv-a', null, null), true);
  assert.equal(shouldLoadConvectionSession('conv-b', 'conv-a', null), true);
});
