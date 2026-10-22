import assert from 'node:assert/strict';
import test from 'node:test';
import { compactionActivity, compactionActivityVisible, reduceCompactionActivity } from './compaction-activity.js';

test('compaction status stays separate from notices and ignores old runs', () => {
  const start = { type: 'compact-start', id: 'new', startedAt: 200, updatedAt: 200 };
  const active = compactionActivity(start)!;
  assert.equal(reduceCompactionActivity(active, { type: 'compaction-notice', message: 'fallback' }), active);
  assert.equal(reduceCompactionActivity(active, { type: 'compact-done', id: 'old', updatedAt: 300 }), active);
  const done = reduceCompactionActivity(active, { ...start, type: 'compact-done', updatedAt: 400 })!;
  assert.equal(done.phase, 'completed');
  assert.equal(reduceCompactionActivity(done, start), done);
  assert.equal(compactionActivityVisible(done, 4399), true);
  assert.equal(compactionActivityVisible(done, 4400), false);
});

test('accepted input clears terminal feedback; cancellation releases progress without claiming a commit', () => {
  const active = compactionActivity({ type: 'compact-start', id: 'a' })!;
  assert.equal(reduceCompactionActivity(active, { type: 'input-accepted' }), active);
  const cancelled = reduceCompactionActivity(active, { type: 'compact-failed', id: 'a', aborted: true, updatedAt: Date.now() })!;
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(reduceCompactionActivity(cancelled, { type: 'input-accepted' }), undefined);
  const failed = reduceCompactionActivity(active, { type: 'error', message: 'disk failure' })!;
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.message, 'disk failure');
  assert.equal(compactionActivityVisible(failed, Date.now() + 60_000), true);
  assert.equal(reduceCompactionActivity(active, { type: 'aborted' })?.phase, 'failed');
});

test('backend facts replace local pending state across different machine clocks', () => {
  const pending = compactionActivity({ type: 'compact-start', id: 'pending-10000', updatedAt: 10000 })!;
  const start = reduceCompactionActivity(pending, { type: 'compact-start', id: 'server', updatedAt: 1000 })!;
  assert.equal(start.id, 'server');
  assert.equal(reduceCompactionActivity(start, { type: 'compact-done', id: 'server', updatedAt: 2000 })?.phase, 'completed');
  assert.equal(reduceCompactionActivity(pending, { type: 'compact-done', id: 'server', updatedAt: 2000 })?.phase, 'completed');
});
