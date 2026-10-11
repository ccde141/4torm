import assert from 'node:assert/strict';
import test from 'node:test';
import { latestProviderUsage } from './token-usage';

const reported = { promptTokens: 123, completionTokens: 7, totalTokens: 130 };

test('snapshot has no value before a model call', () => {
  assert.equal(latestProviderUsage(undefined), undefined);
  assert.equal(latestProviderUsage({ calls: 0, latest: null }), undefined);
});

test('snapshot keeps provider value and distinguishes an unreported later call', () => {
  assert.deepEqual(latestProviderUsage({ calls: 1, latest: reported }), reported);
  assert.equal(latestProviderUsage({ calls: 2, latest: null }), null);
});
