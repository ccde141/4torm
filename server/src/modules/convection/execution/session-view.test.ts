import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConvectionSessionData } from '../infrastructure/session-store.js';
import { recordChairUsage, recordPublicUsage, resetPublicUsage } from './session-view.js';

function session(): ConvectionSessionData {
  return {
    id: 'session-a', title: '会议', topic: '主题', chairAgentId: 'chair',
    participantAgentIds: ['a', 'b'], publicMessages: [], chairMessages: [],
    createdAt: '', updatedAt: '',
  };
}

test('公聊只取本轮参与模型最大的已知 prompt，会长独立计量', () => {
  const target = session();
  recordPublicUsage(target, { promptTokens: 8_000, completionTokens: 100, totalTokens: 8_100 });
  recordPublicUsage(target, { promptTokens: 5_000, completionTokens: 900, totalTokens: 5_900 });
  recordChairUsage(target, { promptTokens: 2_000, completionTokens: 20, totalTokens: 2_020 });
  assert.deepEqual(target.tokenUsage, { promptTokens: 8_000, completionTokens: 100, totalTokens: 8_100 });
  assert.equal(target.publicLatestTokenUsage?.promptTokens, 5_000);
  assert.deepEqual(target.chairTokenUsage, { promptTokens: 2_000, completionTokens: 20, totalTokens: 2_020 });
});

test('新一轮和未知提供商用量不复用旧实测', () => {
  const target = session();
  target.tokenUsage = { promptTokens: 9_000, completionTokens: 1, totalTokens: 9_001 };
  resetPublicUsage(target);
  assert.equal(target.tokenUsage, undefined);
  assert.equal(target.publicLatestTokenUsage, undefined);
  recordPublicUsage(target, { promptTokens: 2_000, completionTokens: 20, totalTokens: 2_020 });
  recordPublicUsage(target, null);
  assert.equal(target.tokenUsage, undefined);
  assert.equal(target.publicLatestTokenUsage, undefined);
  assert.equal(target.publicUsageIncomplete, true);
  recordPublicUsage(target, { promptTokens: 3_000, completionTokens: 30, totalTokens: 3_030 });
  assert.equal(target.tokenUsage, undefined);
  assert.equal(target.publicLatestTokenUsage?.promptTokens, 3_000);
  resetPublicUsage(target);
  recordPublicUsage(target, { promptTokens: 3_000, completionTokens: 30, totalTokens: 3_030 });
  assert.equal(target.tokenUsage?.promptTokens, 3_000);
});

test('会长未知用量清空会长值但保留公聊值', () => {
  const target = session();
  recordPublicUsage(target, { promptTokens: 3_000, completionTokens: 30, totalTokens: 3_030 });
  recordChairUsage(target, { promptTokens: 800, completionTokens: 20, totalTokens: 820 });
  recordChairUsage(target, null);
  assert.equal(target.chairTokenUsage, undefined);
  assert.equal(target.tokenUsage?.promptTokens, 3_000);
});
