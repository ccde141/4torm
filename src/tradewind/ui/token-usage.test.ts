import assert from 'node:assert/strict';
import test from 'node:test';
import { latestProviderUsage, updateProviderUsage } from './token-usage';
import { formatModelUsage, type ModelRequestUsage } from '../../lib/model-usage';

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
  assert.deepEqual(display.usage, compacted);
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

test('parallel public and chair work publish measured calls before either operation finishes', () => {
  let display = updateProviderUsage(undefined, 'meeting', { type: 'usage', usage: reported });
  display = updateProviderUsage(display, 'meeting', { type: 'start', operation: 'public' });
  display = updateProviderUsage(display, 'meeting', { type: 'start', operation: 'chair' });
  const next = { promptTokens: 456, completionTokens: 8, totalTokens: 464 };
  display = updateProviderUsage(display, 'meeting', { type: 'usage', usage: next });
  display = updateProviderUsage(display, 'meeting', { type: 'done', operation: 'chair' });
  assert.deepEqual(display.usage, next);
  display = updateProviderUsage(display, 'meeting', { type: 'done', operation: 'public' });
  assert.deepEqual(display.usage, next);
});

test('request estimates and partial failure usage refresh live, survive snapshots and stay execution scoped', () => {
  const request: ModelRequestUsage = { id: 'r1', purpose: 'conversation', state: 'sent',
    startedAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.001Z',
    estimatedInputTokens: 2468, imageCount: 0, usageComplete: false };
  let display = updateProviderUsage(undefined, 'workflow:a:node', { type: 'model-request', request });
  assert.equal(formatModelUsage(display.modelUsage, 'zh-CN')?.label, '2.5K');
  const failed = { ...request, state: 'failed' as const, updatedAt: '2026-10-24T00:00:00.002Z', usage: reported };
  display = updateProviderUsage(display, 'workflow:a:node', { type: 'model-request', request: failed });
  display = updateProviderUsage(display, 'workflow:a:node', { type: 'model-request', request: { ...request,
    id: 'compact1', purpose: 'compaction', state: 'completed', usage: reported, usageComplete: true } });
  assert.equal(display.modelUsage?.latest?.id, 'r1');
  assert.equal(display.modelUsage?.total.totalTokens, reported.totalTokens * 2);
  assert.match(formatModelUsage(display.modelUsage, 'zh-CN')?.title ?? '', /计量未完整/);
  const restored = updateProviderUsage(display, 'workflow:a:node', { type: 'model-usage', progress: {
    ...display.modelUsage!, requests: { r1: request } } });
  assert.equal(restored.modelUsage?.requests.r1.state, 'failed');
  assert.equal(updateProviderUsage(display, 'workflow:b:node', { type: 'start', operation: 'node' }).modelUsage, undefined);
});
