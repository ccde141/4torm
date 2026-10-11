import assert from 'node:assert/strict';
import test from 'node:test';
import { applySeatEvent, emptyLive } from './seat-stream-events';

test('工位流按每次模型调用更新计量，未知值清除上一请求', () => {
  const live = emptyLive();
  const usage = { promptTokens: 900, completionTokens: 10, totalTokens: 910 };
  applySeatEvent({ type: 'usage', usage }, live);
  assert.deepEqual(live.tokenUsage, usage);
  applySeatEvent({ type: 'usage', usage: null }, live);
  assert.equal(live.tokenUsage, null);
});
