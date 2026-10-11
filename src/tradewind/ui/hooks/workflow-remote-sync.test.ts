import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowDefinition } from '../workflow-client';
import { WorkflowLoadGate } from './workflow-load-gate';
import { reconcileWorkflowRemote } from './workflow-remote-sync';
import { WorkflowRevisionTracker } from './workflow-revision';

function definition(workflowId: string, revision: string): WorkflowDefinition {
  return { schemaVersion: 1, workflowId, name: workflowId, revision,
    updatedAt: '2025-01-01T00:00:00.000Z', graph: { nodes: [], edges: [] } };
}

const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

test('explicit selection B wins over a simultaneous remote update for A', async () => {
  const tracker = new WorkflowRevisionTracker();
  const gate = new WorkflowLoadGate();
  tracker.load('A', 'r1');
  let finishB!: (value: WorkflowDefinition) => void;
  const selected = gate.run(
    () => new Promise<WorkflowDefinition>(resolve => { finishB = resolve; }),
    value => tracker.load(value.workflowId, value.revision),
  );
  let remoteReads = 0;
  const remote = reconcileWorkflowRemote(tracker, gate,
    { scope: 'workflow', type: 'workflow-changed', workflowId: 'A', revision: 'r2', change: 'updated' },
    async () => { remoteReads += 1; return definition('A', 'r2'); },
    value => tracker.load(value.workflowId, value.revision),
    () => { throw new Error('unexpected blank workflow'); }, storage);

  finishB(definition('B', 'b1'));
  assert.equal(await selected, true);
  await remote;
  assert.equal(tracker.state.workflowId, 'B');
  assert.equal(remoteReads, 0);
});

test('a failed explicit selection still allows the pending remote update for A', async () => {
  const tracker = new WorkflowRevisionTracker();
  const gate = new WorkflowLoadGate();
  tracker.load('A', 'r1');
  let failB!: (error: Error) => void;
  const selected = gate.run(
    () => new Promise<WorkflowDefinition>((_resolve, reject) => { failB = reject; }),
    value => tracker.load(value.workflowId, value.revision),
  );
  const remote = reconcileWorkflowRemote(tracker, gate,
    { scope: 'workflow', type: 'workflow-changed', workflowId: 'A', revision: 'r2', change: 'updated' },
    async () => definition('A', 'r2'),
    value => tracker.load(value.workflowId, value.revision),
    () => { throw new Error('unexpected blank workflow'); }, storage);

  failB(new Error('B unavailable'));
  await assert.rejects(selected, /B unavailable/);
  await remote;
  assert.equal(tracker.state.workflowId, 'A');
  assert.equal(tracker.state.revision, 'r2');
});
