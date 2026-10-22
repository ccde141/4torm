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

test('clean deletion clears selection once without creating a replacement draft', () => {
  const tracker = new WorkflowRevisionTracker();
  const store = storage();
  tracker.load('W1', 'r1');
  rememberPersistedWorkflow(store, 'W1');
  let clears = 0;
  const clearSelection = () => { clears += 1; tracker.load('untitled', null); };
  handleRemoteWorkflowDelete(tracker, 'W1', store, clearSelection);
  handleRemoteWorkflowDelete(tracker, 'W1', store, clearSelection);
  assert.equal(clears, 1);
  assert.equal(readPersistedWorkflow(store), null);
  assert.equal(tracker.state.workflowId, 'untitled');
  assert.equal(tracker.state.revision, null);
  assert.equal(tracker.state.dirty, false);
});

test('a late deletion notification for A cannot clear the newly selected B or its recovery ID', () => {
  const tracker = new WorkflowRevisionTracker();
  const store = storage();
  tracker.load('A', 'a1');
  tracker.load('B', 'b1');
  rememberPersistedWorkflow(store, 'B');
  handleRemoteWorkflowDelete(tracker, 'A', store, () => { throw new Error('B must remain selected'); });
  assert.equal(tracker.state.workflowId, 'B');
  assert.equal(tracker.state.revision, 'b1');
  assert.equal(readPersistedWorkflow(store), 'B');
});

test('remote deletion of a dirty workflow preserves its draft and prevents a same-ID save', async () => {
  const tracker = new WorkflowRevisionTracker();
  const store = storage();
  tracker.load('W1', 'r1');
  tracker.edit();
  rememberPersistedWorkflow(store, 'W1');
  handleRemoteWorkflowDelete(tracker, 'W1', store, () => { throw new Error('must keep draft'); });
  handleRemoteWorkflowDelete(tracker, 'W1', store, () => { throw new Error('duplicate deletion must keep draft'); });
  assert.equal(tracker.state.workflowId, 'W1');
  assert.equal(tracker.state.dirty, true);
  assert.equal(tracker.state.conflict, true);
  assert.equal(tracker.canAutoSave(), false);
  assert.equal(readPersistedWorkflow(store), null);
  let writes = 0;
  await assert.rejects(tracker.save(() => ({ workflowId: 'W1' }), async () => {
    writes += 1;
    return { revision: 'r2' };
  }), /changed remotely/i);
  assert.equal(writes, 0);
});
