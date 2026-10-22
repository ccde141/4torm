import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowRevisionTracker } from './workflow-revision';

const draft = (workflowId = 'wf-1') => ({ workflowId, name: 'Draft', graph: { nodes: [{}], edges: [] } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('new workflow saves with create-only revision, then becomes clean', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', null);
  tracker.edit();
  const sent: unknown[] = [];
  await tracker.save(() => draft(), async input => {
    sent.push(input);
    return { revision: 'r1' };
  });
  assert.deepEqual(sent, [{ ...draft(), expectedRevision: null }]);
  assert.deepEqual(tracker.state, { workflowId: 'wf-1', revision: 'r1', dirty: false, saving: false, conflict: false });
  assert.equal(tracker.canAutoSave(), false);
});

test('an explicit save checks the remote revision even when the canvas is clean', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  let writes = 0;
  await assert.rejects(tracker.save(() => draft(), async input => {
    writes += 1;
    assert.equal(input.expectedRevision, 'r1');
    throw Object.assign(new Error('changed'), { code: 'TRADEWIND_WORKFLOW_CHANGED' });
  }), /changed/);
  assert.equal(writes, 1);
  assert.equal(tracker.state.conflict, true);
});

test('remote update keeps a dirty editor intact and stops automatic saves', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  assert.equal(tracker.observe('wf-1', 'r2'), 'reload');
  tracker.edit();
  assert.equal(tracker.observe('wf-1', 'r2'), 'conflict');
  assert.equal(tracker.canAutoSave(), false);
  await assert.rejects(tracker.save(() => draft(), async () => {
    throw new Error('writer must not run');
  }), /changed remotely/i);
  assert.equal(tracker.state.dirty, true);
});

test('edits made during an in-flight save remain dirty and use the acknowledged revision', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  tracker.edit();
  let finish!: (value: { revision: string }) => void;
  const first = tracker.save(() => draft(), async () => new Promise(resolve => { finish = resolve; }));
  tracker.edit();
  finish({ revision: 'r2' });
  await first;
  assert.equal(tracker.state.revision, 'r2');
  assert.equal(tracker.state.dirty, true);
  const sent: unknown[] = [];
  await tracker.save(() => draft(), async input => {
    sent.push(input);
    return { revision: 'r3' };
  });
  assert.equal((sent[0] as { expectedRevision: string }).expectedRevision, 'r2');
  assert.equal(tracker.state.dirty, false);
});

test('a self-change event arriving before the save response does not create a conflict', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  tracker.edit();
  let finish!: (value: { revision: string }) => void;
  const saving = tracker.save(() => draft(), async () => new Promise(resolve => { finish = resolve; }));
  const observing = tracker.observeAfterSave('wf-1', 'r2');
  tracker.edit();
  assert.equal(tracker.state.conflict, false);
  finish({ revision: 'r2' });
  await saving;
  assert.equal(await observing, 'unchanged');
  assert.equal(tracker.state.dirty, true);
  assert.equal(tracker.state.conflict, false);
});

test('an external revision arriving during a save is not mistaken for its own event', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  tracker.edit();
  let finish!: (value: { revision: string }) => void;
  const saving = tracker.save(() => draft(), async () => new Promise(resolve => { finish = resolve; }));
  const observing = tracker.observeAfterSave('wf-1', 'r3');
  tracker.edit();
  finish({ revision: 'r2' });
  await saving;
  assert.equal(await observing, 'conflict');
  assert.equal(tracker.state.revision, 'r2');
  assert.equal(tracker.state.conflict, true);
});

test('a conflicting save leaves the draft dirty and does not retry', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  tracker.edit();
  let writes = 0;
  await assert.rejects(tracker.save(() => draft(), async () => {
    writes += 1;
    throw Object.assign(new Error('changed'), { code: 'TRADEWIND_WORKFLOW_CHANGED' });
  }), /changed/);
  assert.equal(writes, 1);
  assert.equal(tracker.state.dirty, true);
  assert.equal(tracker.state.conflict, true);
});

test('an old save acknowledgement cannot change a newly loaded workflow', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  tracker.edit();
  let finish!: (value: { revision: string }) => void;
  const pending = tracker.save(() => draft(), async () => new Promise(resolve => { finish = resolve; }));
  tracker.load('wf-2', 'other');
  finish({ revision: 'r2' });
  await pending;
  assert.equal(tracker.state.workflowId, 'wf-2');
  assert.equal(tracker.state.revision, 'other');
});

test('failed save as copy preserves the original dirty draft', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  tracker.edit();
  let adopted = false;
  await assert.rejects(tracker.saveCopy(
    draft('wf-copy'),
    async input => {
      assert.equal(input.expectedRevision, null);
      throw new Error('disk unavailable');
    },
    () => { adopted = true; },
  ), /disk unavailable/);
  assert.equal(adopted, false);
  assert.deepEqual(tracker.state, {
    workflowId: 'wf-1', revision: 'r1', dirty: true, saving: false, conflict: false,
  });
});

test('copy acknowledgement does not replace edits made while it was saving', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  tracker.edit();
  let finish!: (value: { revision: string }) => void;
  let adopted = false;
  const copy = tracker.saveCopy(draft('wf-copy'),
    async () => new Promise(resolve => { finish = resolve; }),
    () => { adopted = true; });
  await Promise.resolve();
  tracker.edit();
  finish({ revision: 'r-copy' });
  assert.equal((await copy).adopted, false);
  assert.equal(adopted, false);
  assert.equal(tracker.state.workflowId, 'wf-1');
  assert.equal(tracker.state.dirty, true);
});

test('copy waiting for an earlier save cannot adopt a graph captured before newer edits', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r1');
  tracker.edit();
  let finish!: (value: { revision: string }) => void;
  const saving = tracker.save(() => draft(), async () => new Promise(resolve => { finish = resolve; }));
  let adopted = false;
  const copy = tracker.saveCopy(draft('wf-copy'), async () => ({ revision: 'r-copy' }),
    () => { adopted = true; });
  tracker.edit();
  finish({ revision: 'r2' });
  await saving;
  assert.equal((await copy).adopted, false);
  assert.equal(adopted, false);
  assert.equal(tracker.state.workflowId, 'wf-1');
  assert.equal(tracker.state.dirty, true);
});

test('three overlapping saves use successive revisions and waiting includes the whole queue', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r0');
  tracker.edit();
  const writes = [deferred<{ revision: string }>(), deferred<{ revision: string }>(), deferred<{ revision: string }>()];
  const revisions: Array<string | null> = [];
  const write = (input: { expectedRevision: string | null }) => {
    revisions.push(input.expectedRevision);
    return writes[revisions.length - 1].promise;
  };
  const first = tracker.save(() => draft(), write);
  let finished = false;
  const waiting = tracker.waitForSave().then(() => { finished = true; });
  const second = tracker.save(() => draft(), write);
  const third = tracker.save(() => draft(), write);
  assert.deepEqual(revisions, ['r0']);
  writes[0].resolve({ revision: 'r1' });
  await first;
  assert.deepEqual(revisions, ['r0', 'r1']);
  assert.equal(finished, false);
  writes[1].resolve({ revision: 'r2' });
  await second;
  assert.deepEqual(revisions, ['r0', 'r1', 'r2']);
  assert.equal(finished, false);
  writes[2].resolve({ revision: 'r3' });
  await third;
  await waiting;
  assert.equal(finished, true);
  assert.equal(tracker.state.revision, 'r3');
  assert.equal(tracker.state.conflict, false);
});

test('copy shares the save queue and cannot replay an older save after adopting another workflow', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r0');
  tracker.edit();
  const firstWrite = deferred<{ revision: string }>();
  const copyWrite = deferred<{ revision: string }>();
  const first = tracker.save(() => draft(), () => firstWrite.promise);
  let copying = false;
  const copy = tracker.saveCopy(draft('wf-copy'), input => {
    assert.equal(input.expectedRevision, null);
    copying = true;
    return copyWrite.promise;
  }, revision => tracker.load('wf-copy', revision));
  let staleDraftReads = 0;
  const stale = tracker.save(() => { staleDraftReads += 1; return draft('wf-copy'); }, async () => {
    throw new Error('old workflow save must not run');
  });
  let finished = false;
  const waiting = tracker.waitForSave().then(() => { finished = true; });
  firstWrite.resolve({ revision: 'r1' });
  await first;
  assert.equal(copying, true);
  assert.equal(finished, false);
  copyWrite.resolve({ revision: 'r-copy' });
  assert.deepEqual(await copy, { saved: true, adopted: true });
  assert.equal(await stale, false);
  await waiting;
  assert.equal(staleDraftReads, 0);
  assert.equal(tracker.state.workflowId, 'wf-copy');
  assert.equal(tracker.state.revision, 'r-copy');
});

test('a failed save rejects queued writes without replay and permits a later explicit save', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r0');
  tracker.edit();
  const firstWrite = deferred<{ revision: string }>();
  const first = tracker.save(() => draft(), () => firstWrite.promise);
  let queuedWrites = 0;
  const second = tracker.save(() => draft(), async () => { queuedWrites += 1; return { revision: 'r1' }; });
  const copy = tracker.saveCopy(draft('wf-copy'), async () => {
    queuedWrites += 1;
    return { revision: 'r-copy' };
  }, () => { throw new Error('failed queue must not adopt'); });
  const settled = Promise.allSettled([first, second, copy, tracker.waitForSave()]);
  firstWrite.reject(new Error('write unavailable'));
  assert.deepEqual((await settled).map(result => result.status), ['rejected', 'rejected', 'rejected', 'rejected']);
  assert.equal(queuedWrites, 0);
  assert.equal(tracker.state.dirty, true);
  assert.equal(await tracker.save(() => draft(), async input => {
    assert.equal(input.expectedRevision, 'r0');
    return { revision: 'r1' };
  }), true);
});

test('an earlier confirmed self-event stays unchanged after queued saves while a new external revision conflicts', async () => {
  const tracker = new WorkflowRevisionTracker();
  tracker.load('wf-1', 'r0');
  tracker.edit();
  const firstWrite = deferred<{ revision: string }>();
  const secondWrite = deferred<{ revision: string }>();
  const first = tracker.save(() => draft(), () => firstWrite.promise);
  const second = tracker.save(() => draft(), () => secondWrite.promise);
  const observing = tracker.observeAfterSave('wf-1', 'r1');
  firstWrite.resolve({ revision: 'r1' });
  await first;
  tracker.edit();
  secondWrite.resolve({ revision: 'r2' });
  await second;
  assert.equal(await observing, 'unchanged');
  assert.equal(tracker.state.dirty, true);
  assert.equal(tracker.state.conflict, false);
  assert.equal(await tracker.observeAfterSave('wf-1', 'external-r3'), 'conflict');
  tracker.load('wf-1', 'r2');
  tracker.edit();
  assert.equal(await tracker.observeAfterSave('wf-1', 'r1'), 'conflict');
});
