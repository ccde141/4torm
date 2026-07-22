import assert from 'node:assert/strict';
import test from 'node:test';
import { isChatNearBottom } from './useSmartChatScroll.js';

test('智能滚动只在距离底部阈值内保持自动跟随', () => {
  assert.equal(isChatNearBottom({ scrollHeight: 1000, scrollTop: 770, clientHeight: 120 }), true);
  assert.equal(isChatNearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 120 }), false);
});
