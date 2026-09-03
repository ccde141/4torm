import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomData, RoomMessage } from './types.js';
import { compactRoomBeforeRound } from './room-auto-compaction.js';

function messages(): RoomMessage[] {
  return [1, 2, 3, 4].flatMap(round => ([
    { speaker: '人类', content: `问题${round}`, timestamp: round, roundSeq: round },
    { speaker: '工位', content: `回答${round}`, timestamp: round, roundSeq: round },
  ]));
}

function room(): RoomData {
  return {
    id: 'room-a', title: '测试', topic: '主题', participantSeatIds: ['seat-a'],
    publicMessages: messages(), tokenUsage: { promptTokens: 100, completionTokens: 1, totalTokens: 101 },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('自动压缩严格按归档、摘要、提交顺序执行', async () => {
  const target = room();
  const calls: string[] = [];
  const result = await compactRoomBeforeRound({
    dataDir: 'data', workshopId: 'work-a', room: target,
    modelKeys: ['small:model'], summaryModel: 'small:model',
  }, {
    resolveBudget: async () => 100,
    archive: async () => { calls.push('archive'); },
    summarize: async () => { calls.push('summarize'); return '历史摘要'; },
    commit: async (_params, plan, summary) => {
      calls.push('commit');
      target.publicMessages = [
        { speaker: '系统', content: summary, timestamp: 10 }, ...plan.keptMessages,
      ];
    },
  });

  assert.equal(result.compacted, true);
  assert.deepEqual(calls, ['archive', 'summarize', 'commit']);
  assert.equal(target.publicMessages[0]?.content, '历史摘要');
});

test('容量全部不可探测时不猜默认值也不自动压缩', async () => {
  const target = room();
  let sideEffects = 0;
  const result = await compactRoomBeforeRound({
    dataDir: 'data', workshopId: 'work-a', room: target,
    modelKeys: ['cloud:model'], summaryModel: 'cloud:model',
  }, {
    resolveBudget: async () => undefined,
    archive: async () => { sideEffects++; },
    summarize: async () => { sideEffects++; return '摘要'; },
    commit: async () => { sideEffects++; },
  });
  assert.equal(result.compacted, false);
  assert.equal(result.reason, 'budget-unavailable');
  assert.equal(sideEffects, 0);
});

test('归档失败时不调用摘要且不修改活动群聊', async () => {
  const target = room();
  const original = structuredClone(target.publicMessages);
  let summarized = false;
  await assert.rejects(() => compactRoomBeforeRound({
    dataDir: 'data', workshopId: 'work-a', room: target,
    modelKeys: ['small:model'], summaryModel: 'small:model',
  }, {
    resolveBudget: async () => 100,
    archive: async () => { throw new Error('disk full'); },
    summarize: async () => { summarized = true; return '摘要'; },
    commit: async () => undefined,
  }), /disk full/);
  assert.equal(summarized, false);
  assert.deepEqual(target.publicMessages, original);
});

test('摘要失败时保留原消息且不提交替换', async () => {
  const target = room();
  const original = structuredClone(target.publicMessages);
  let committed = false;
  await assert.rejects(() => compactRoomBeforeRound({
    dataDir: 'data', workshopId: 'work-a', room: target,
    modelKeys: ['small:model'], summaryModel: 'small:model',
  }, {
    resolveBudget: async () => 100,
    archive: async () => undefined,
    summarize: async () => { throw new Error('summary failed'); },
    commit: async () => { committed = true; },
  }), /summary failed/);
  assert.equal(committed, false);
  assert.deepEqual(target.publicMessages, original);
});
