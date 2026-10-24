import assert from 'node:assert/strict';
import test from 'node:test';
import { withCycloneSummaryUsage } from './summary-model-usage.js';
import { createModelRequestUsage, type ModelUsageProgress } from '../../../engine/shared/model-request-usage.js';

test('manual summary failure persists known request usage without replacing conversation contents', async () => {
  const messages = [{ role: 'user', content: 'original history' }];
  const owner = { messages, modelUsage: undefined as ModelUsageProgress | undefined };
  const writes: ModelUsageProgress[] = [];
  await assert.rejects(withCycloneSummaryUsage({ get: () => owner.modelUsage,
    set: value => { owner.modelUsage = value; }, persist: async () => { writes.push(structuredClone(owner.modelUsage!)); },
  }, async () => {
    const meter = createModelRequestUsage({ messages }, 'compaction');
    meter.update({ state: 'sent', wasSent: true });
    meter.report({ promptTokens: 80, completionTokens: 5, totalTokens: 85 });
    meter.finish('failed');
    throw new Error('summary interrupted');
  }), /summary interrupted/);
  assert.equal(writes.at(-1)?.total.totalTokens, 85);
  assert.equal(writes.at(-1)?.complete, false);
  assert.equal(owner.modelUsage?.latest, undefined, 'summary input is not the conversation input');
  assert.deepEqual(owner.messages, [{ role: 'user', content: 'original history' }]);
});

test('manual summary persistence failure remains a real failure', async () => {
  let progress: ModelUsageProgress | undefined;
  await assert.rejects(withCycloneSummaryUsage({ get: () => progress, set: value => { progress = value; },
    persist: async () => { throw new Error('fixture disk unavailable'); },
  }, async () => {
    createModelRequestUsage({ messages: [] }, 'compaction').finish('completed', {
      promptTokens: 8, completionTokens: 2, totalTokens: 10,
    });
    return 'summary';
  }), /fixture disk unavailable/);
});
