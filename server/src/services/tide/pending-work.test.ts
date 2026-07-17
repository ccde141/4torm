import assert from 'node:assert/strict';
import test from 'node:test';
import { PendingWorkTracker } from './pending-work.js';

test('drain 等待已经登记的运行任务', async () => {
  const tracker = new PendingWorkTracker();
  let release!: () => void;
  const work = new Promise<void>(resolve => { release = resolve; });
  const tracked = tracker.track(work);
  let drained = false;
  const draining = tracker.drain().then(() => { drained = true; });

  await Promise.resolve();
  assert.equal(drained, false);
  release();
  await Promise.all([tracked, draining]);
  assert.equal(drained, true);
});
