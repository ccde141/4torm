import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomData } from './types.js';
import { recordRoomLatestUsage, recordRoomTokenUsage, resetRoomTokenUsage,
  trackRoomModelUsage } from './room-token-usage.js';

function room(): RoomData {
  return {
    id: 'room-a', title: '测试', topic: '', participantSeatIds: [], publicMessages: [],
    createdAt: '', updatedAt: '',
  };
}

test('群聊记录同轮参与模型中的最大 prompt 用量', () => {
  const target = room();
  recordRoomTokenUsage(target, { promptTokens: 8_000, completionTokens: 100, totalTokens: 8_100 });
  recordRoomTokenUsage(target, { promptTokens: 5_000, completionTokens: 900, totalTokens: 5_900 });
  assert.deepEqual(target.tokenUsage, {
    promptTokens: 8_000, completionTokens: 100, totalTokens: 8_100,
  });
  assert.equal(target.publicLatestTokenUsage?.promptTokens, 5_000);
});

test('新一轮可在清空旧用量后重新记录', () => {
  const target = room();
  target.tokenUsage = { promptTokens: 9_000, completionTokens: 1, totalTokens: 9_001 };
  resetRoomTokenUsage(target);
  recordRoomTokenUsage(target, { promptTokens: 2_000, completionTokens: 20, totalTokens: 2_020 });
  assert.equal(target.tokenUsage?.promptTokens, 2_000);
});

test('同轮任一模型未报告用量后不展示不完整的最大值', () => {
  const target = room();
  recordRoomTokenUsage(target, { promptTokens: 8_000, completionTokens: 100, totalTokens: 8_100 });
  recordRoomTokenUsage(target, null);
  assert.equal(target.tokenUsage, undefined);
  assert.equal(target.publicLatestTokenUsage, undefined);
  assert.equal(target.publicUsageIncomplete, true);
  recordRoomTokenUsage(target, { promptTokens: 9_000, completionTokens: 100, totalTokens: 9_100 });
  assert.equal(target.tokenUsage, undefined);
  assert.equal(target.publicLatestTokenUsage?.promptTokens, 9_000);
  resetRoomTokenUsage(target);
  recordRoomTokenUsage(target, { promptTokens: 2_000, completionTokens: 20, totalTokens: 2_020 });
  assert.equal(target.tokenUsage?.promptTokens, 2_000);
});

test('入会介绍只更新最近请求，不改变群聊轮次的压缩阈值', () => {
  const target = room();
  recordRoomTokenUsage(target, { promptTokens: 8_000, completionTokens: 80, totalTokens: 8_080 });
  recordRoomLatestUsage(target, { promptTokens: 600, completionTokens: 10, totalTokens: 610 });
  assert.equal(target.publicLatestTokenUsage?.promptTokens, 600);
  assert.equal(target.tokenUsage?.promptTokens, 8_000);
  recordRoomLatestUsage(target, null);
  assert.equal(target.publicLatestTokenUsage, undefined);
  assert.equal(target.tokenUsage?.promptTokens, 8_000);
});

test('公聊每次模型调用后先落盘再继续循环', async () => {
  const target = room();
  const saved: Array<number | null> = [];
  const llm = { call: async () => ({ content: 'ok', finishReason: 'stop' as const,
    usage: { promptTokens: 1_500, completionTokens: 20, totalTokens: 1_520 } }) };
  const tracked = trackRoomModelUsage(llm, target,
    async () => { saved.push(target.tokenUsage?.promptTokens ?? null); });
  await tracked.call([]);
  assert.deepEqual(saved, [1_500]);
});

test('公聊模型请求失败时最新计量变未知并保留错误', async () => {
  const target = room();
  recordRoomTokenUsage(target, { promptTokens: 900, completionTokens: 9, totalTokens: 909 });
  const failure = new Error('provider failed');
  const tracked = trackRoomModelUsage({ call: async () => { throw failure; } }, target,
    async () => { assert.equal(target.publicLatestTokenUsage, undefined); });
  await assert.rejects(tracked.call([]), error => error === failure);
  assert.equal(target.publicUsageIncomplete, true);
});
