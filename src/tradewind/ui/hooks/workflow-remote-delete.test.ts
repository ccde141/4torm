import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowRevisionTracker } from './workflow-revision';
import { handleRemoteWorkflowDelete } from './workflow-remote-delete';
import { rememberPersistedWorkflow, readPersistedWorkflow } from '../workflow-recovery';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('remote deletion of a clean workflow clears its recovery ID and opens a blank workflow', () => {
  const tracker = new WorkflowRevisionTracker();
  const store = storage();
  tracker.load('W1', 'r1');
  rememberPersistedWorkflow(store, 'W1');
  let blank = 0;
  handleRemoteWorkflowDelete(tracker, 'W1', store, () => {
    blank += 1;
    tracker.load('W-new', null);
  });
  assert.equal(blank, 1);
  assert.equal(readPersistedWorkflow(store), null);
  assert.equal(tracker.state.workflowId, 'W-new');
});

test('remote deletion of a dirty workflow preserves its draft and prevents a same-ID save', async () => {
  const tracker = new WorkflowRevisionTracker();
  const store = storage();
  tracker.load('W1', 'r1');
  tracker.edit();
  rememberPersistedWorkflow(store, 'W1');
  handleRemoteWorkflowDelete(tracker, 'W1', store, () => { throw new Error('must keep draft'); });
  assert.equal(tracker.state.workflowId, 'W1');
  assert.equal(tracker.state.dirty, true);
  assert.equal(tracker.canAutoSave(), false);
  assert.equal(readPersistedWorkflow(store), null);
  await assert.rejects(tracker.save(() => ({ workflowId: 'W1' }), async () => ({ revision: 'r2' })), /changed remotely/i);
});
