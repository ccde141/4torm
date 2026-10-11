import assert from 'node:assert/strict';
import test from 'node:test';
import type { LLMCaller } from '../shared/react/native-loop.js';
import type { SeatData } from './types.js';
import { trackSeatModelUsage } from './seat-token-usage.js';

function seat(): SeatData {
  return {
    id: 'seat-a', title: '工位', rolePrompt: '', agentId: 'agent-a',
    messages: [], createdAt: '', updatedAt: '',
  };
}

test('每次模型请求完成都先保存实际计量及请求历史', async () => {
  const target = seat();
  const messages = [{ role: 'system' as const, content: 'system' },
    { role: 'user' as const, content: 'question' }];
  const saved: Array<{ prompt?: number; messageCount: number }> = [];
  let next = 0;
  const llm: LLMCaller = { call: async () => ({
    content: 'ok', finishReason: 'stop', usage: ++next === 1
      ? { promptTokens: 100, completionTokens: 5, totalTokens: 105 }
      : undefined,
  }) };
  const tracked = trackSeatModelUsage(llm, target, messages, async () => {
    saved.push({ prompt: target.tokenUsage?.promptTokens, messageCount: target.messages.length });
  });
  await tracked.call(messages);
  messages.push({ role: 'user', content: 'follow up' });
  await tracked.call(messages);
  assert.deepEqual(saved, [{ prompt: 100, messageCount: 1 },
    { prompt: undefined, messageCount: 2 }]);
});

test('模型请求失败也清除旧计量并保留错误', async () => {
  const target = seat();
  target.tokenUsage = { promptTokens: 900, completionTokens: 9, totalTokens: 909 };
  const failure = new Error('provider failed');
  const messages = [{ role: 'system' as const, content: 'system' },
    { role: 'user' as const, content: 'question' }];
  const tracked = trackSeatModelUsage({ call: async () => { throw failure; } }, target,
    messages, async () => { assert.equal(target.tokenUsage, undefined); });
  await assert.rejects(tracked.call(messages), error => error === failure);
  assert.equal(target.messages.length, 1);
});
