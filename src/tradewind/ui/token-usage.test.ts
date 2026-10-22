import assert from 'node:assert/strict';
import test from 'node:test';
import { latestProviderUsage, updateProviderUsage } from './token-usage';

const reported = { promptTokens: 123, completionTokens: 7, totalTokens: 130 };

test('snapshot has no value before a model call', () => {
  assert.equal(latestProviderUsage(undefined), undefined);
  assert.equal(latestProviderUsage({ calls: 0, latest: null }), undefined);
});

test('snapshot keeps provider value and distinguishes an unreported later call', () => {
  assert.deepEqual(latestProviderUsage({ calls: 1, latest: reported }), reported);
  assert.equal(latestProviderUsage({ calls: 2, latest: null }), null);
});

test('node and meeting operations retain known usage until a new measured value arrives', () => {
  const scope = JSON.stringify(['workflow', 'execution', 'node']);
  let display = updateProviderUsage(undefined, scope, { type: 'usage', usage: reported });
  display = updateProviderUsage(display, scope, { type: 'start', operation: 'node' });
  for (const usage of [null, undefined]) display = updateProviderUsage(display, scope, { type: 'usage', usage });
  assert.deepEqual(display.usage, reported);
  const compacted = { promptTokens: 23, completionTokens: 4, totalTokens: 27 };
  display = updateProviderUsage(display, scope, { type: 'usage', usage: compacted });
  assert.deepEqual(display.usage, reported);
  display = updateProviderUsage(display, scope, { type: 'done', operation: 'node' });
  assert.deepEqual(display.usage, compacted);
  display = updateProviderUsage(display, scope, { type: 'usage', usage: null });
  assert.deepEqual(display.usage, compacted);
  display = updateProviderUsage(display, scope, { type: 'start', operation: 'node' });
  display = updateProviderUsage(display, scope, { type: 'usage', usage: undefined });
  display = updateProviderUsage(display, scope, { type: 'done', operation: 'node' });
  assert.deepEqual(display.usage, compacted);
});

test('a different node or workflow execution never inherits a previous known value', () => {
  const display = updateProviderUsage(undefined, JSON.stringify(['workflow', 'old', 'node']), { type: 'usage', usage: reported });
  for (const scope of [JSON.stringify(['workflow', 'next', 'node']), JSON.stringify(['workflow', 'old', 'other'])]) {
    assert.equal(updateProviderUsage(display, scope, { type: 'usage', usage: null }).usage, null);
    assert.equal(updateProviderUsage(display, scope, { type: 'usage', usage: undefined }).usage, undefined);
  }
});

test('parallel public and chair work refresh once both operations have finished', () => {
  let display = updateProviderUsage(undefined, 'meeting', { type: 'usage', usage: reported });
  display = updateProviderUsage(display, 'meeting', { type: 'start', operation: 'public' });
  display = updateProviderUsage(display, 'meeting', { type: 'start', operation: 'chair' });
  const next = { promptTokens: 456, completionTokens: 8, totalTokens: 464 };
  display = updateProviderUsage(display, 'meeting', { type: 'usage', usage: next });
  display = updateProviderUsage(display, 'meeting', { type: 'done', operation: 'chair' });
  assert.deepEqual(display.usage, reported);
  display = updateProviderUsage(display, 'meeting', { type: 'done', operation: 'public' });
  assert.deepEqual(display.usage, next);
});
