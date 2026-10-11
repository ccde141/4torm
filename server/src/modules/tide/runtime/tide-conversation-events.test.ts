import assert from 'node:assert/strict';
import test from 'node:test';
import { createTideEventState } from './tide-conversation-events.js';

test('潮汐每次 ReAct 模型返回即串行发布并累计，未知调用清除最新值', async () => {
  const written: Array<number | null> = [];
  const state = createTideEventState(async usage => {
    await Promise.resolve();
    written.push(usage?.totalTokens ?? null);
  });
  state.onEvent({ type: 'usage', usage: {
    promptTokens: 20, completionTokens: 2, totalTokens: 22 } });
  state.onEvent({ type: 'usage', usage: null });
  state.onEvent({ type: 'usage', usage: {
    promptTokens: 30, completionTokens: 3, totalTokens: 33 } });
  await state.flush();
  assert.deepEqual(written, [22, null, 33]);
  assert.deepEqual(state.snapshot().usage, { calls: 3, reportedCalls: 2,
    latest: { promptTokens: 30, completionTokens: 3, totalTokens: 33 },
    total: { promptTokens: 50, completionTokens: 5, totalTokens: 55 } });
});
