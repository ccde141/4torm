import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowRevisionTracker } from './workflow-revision';

const draft = (workflowId = 'wf-1') => ({ workflowId, name: 'Draft', graph: { nodes: [{}], edges: [] } });

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
