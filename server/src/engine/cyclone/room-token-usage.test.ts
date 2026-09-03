import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomData } from './types.js';
import { recordRoomTokenUsage, resetRoomTokenUsage } from './room-token-usage.js';

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
});

test('新一轮可在清空旧用量后重新记录', () => {
  const target = room();
  target.tokenUsage = { promptTokens: 9_000, completionTokens: 1, totalTokens: 9_001 };
  resetRoomTokenUsage(target);
  recordRoomTokenUsage(target, { promptTokens: 2_000, completionTokens: 20, totalTokens: 2_020 });
  assert.equal(target.tokenUsage?.promptTokens, 2_000);
});
