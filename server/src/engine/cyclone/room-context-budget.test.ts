import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRoomPromptBudget } from './room-context-budget.js';

test('气旋群聊采用所有可探测参与模型中的最小安全预算', async () => {
  const budgets = new Map<string, number | undefined>([
    ['local:small', 13_516],
    ['cloud:unknown', undefined],
    ['local:large', 180_000],
  ]);
  const result = await resolveRoomPromptBudget(
    [...budgets.keys()], async model => budgets.get(model),
  );
  assert.equal(result, 13_516);
});

test('同一模型只探测一次且全不可探测时不猜默认值', async () => {
  let calls = 0;
  const result = await resolveRoomPromptBudget(
    ['cloud:model', 'cloud:model'],
    async () => { calls++; return undefined; },
  );
  assert.equal(result, undefined);
  assert.equal(calls, 1);
});
