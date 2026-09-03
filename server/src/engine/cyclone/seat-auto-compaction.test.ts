import assert from 'node:assert/strict';
import test from 'node:test';
import type { SeatData, SeatContextMessage } from './types.js';
import { compactSeatBeforeTurn } from './seat-auto-compaction.js';

function messages(): SeatContextMessage[] {
  return [1, 2, 3, 4].flatMap(turn => ([
    { role: 'user' as const, content: `问题${turn}` },
    { role: 'assistant' as const, content: `回答${turn}` },
  ]));
}

function seat(): SeatData {
  return {
    id: 'seat-a', title: '工位', rolePrompt: '', agentId: 'agent-a', messages: messages(),
    tokenUsage: { promptTokens: 100, completionTokens: 1, totalTokens: 101 },
    createdAt: '', updatedAt: '',
  };
}

test('工位自动压缩严格按归档、摘要、提交顺序执行', async () => {
  const target = seat();
  const calls: string[] = [];
  const result = await compactSeatBeforeTurn({
    dataDir: 'data', workshopId: 'work-a', seat: target, modelKey: 'local:model',
  }, {
    resolveBudget: async () => 100,
    archive: async () => { calls.push('archive'); },
    summarize: async () => { calls.push('summarize'); return '历史摘要'; },
    commit: async (_params, plan, summary) => {
      calls.push('commit');
      target.messages = [{ role: 'system', content: summary }, ...plan.keptMessages];
    },
  });
  assert.equal(result.compacted, true);
  assert.deepEqual(calls, ['archive', 'summarize', 'commit']);
});

test('工位模型容量不可探测时保持手动 compact 而不猜默认值', async () => {
  let sideEffects = 0;
  const result = await compactSeatBeforeTurn({
    dataDir: 'data', workshopId: 'work-a', seat: seat(), modelKey: 'cloud:model',
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

test('工位摘要失败保留原消息且不提交替换', async () => {
  const target = seat();
  const original = structuredClone(target.messages);
  let committed = false;
  await assert.rejects(() => compactSeatBeforeTurn({
    dataDir: 'data', workshopId: 'work-a', seat: target, modelKey: 'local:model',
  }, {
    resolveBudget: async () => 100,
    archive: async () => undefined,
    summarize: async () => { throw new Error('summary failed'); },
    commit: async () => { committed = true; },
  }), /summary failed/);
  assert.equal(committed, false);
  assert.deepEqual(target.messages, original);
});
