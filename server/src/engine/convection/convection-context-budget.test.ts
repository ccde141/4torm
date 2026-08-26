import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConvectionPromptThreshold } from './convection-context-budget.js';

test('convection uses the smallest discovered participant prompt budget', async () => {
  const budgets = new Map<string, number | undefined>([
    ['cloud:model', undefined],
    ['local:a', 13_516],
    ['local:b', 5_734],
  ]);
  const threshold = await resolveConvectionPromptThreshold(
    [...budgets.keys()],
    async model => budgets.get(model),
  );
  assert.equal(threshold, 5_734);
});

test('convection keeps its legacy threshold when no runtime budget is discoverable', async () => {
  assert.equal(await resolveConvectionPromptThreshold(['cloud:model'], async () => undefined), undefined);
});

test('convection resolves each shared model only once', async () => {
  let calls = 0;
  await resolveConvectionPromptThreshold(['local:a', 'local:a'], async () => { calls++; return 5_734; });
  assert.equal(calls, 1);
});
