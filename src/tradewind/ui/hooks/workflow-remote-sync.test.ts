import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowDefinition } from '../workflow-client';
import { WorkflowLoadGate } from './workflow-load-gate';
import { reconcileWorkflowRemote } from './workflow-remote-sync';
import { WorkflowRevisionTracker } from './workflow-revision';
import { ClientFrameworkError } from '../../../api/error-contract';

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

test('a failed old A reconciliation cannot report an error or delete the explicitly selected B', async () => {
  for (const failure of [new Error('old A unavailable'), new ClientFrameworkError({
    code: 'TRADEWIND_WORKFLOW_NOT_FOUND', kind: 'not_found', message: 'old A missing',
  })]) {
    const tracker = new WorkflowRevisionTracker();
    const gate = new WorkflowLoadGate();
    tracker.load('A', 'r1');
    let failA!: (error: Error) => void;
    let markReading!: () => void;
    const reading = new Promise<void>(resolve => { markReading = resolve; });
    const remote = reconcileWorkflowRemote(tracker, gate, undefined,
      () => { markReading(); return new Promise<WorkflowDefinition>((_resolve, reject) => { failA = reject; }); },
      () => { throw new Error('stale A cannot replace B'); },
      () => { throw new Error('stale A cannot open a blank workflow'); }, storage);
    await reading;
    assert.equal(await gate.run(async () => definition('B', 'b1'),
      value => tracker.load(value.workflowId, value.revision)), true);
    failA(failure);
    await remote;
    assert.equal(tracker.state.workflowId, 'B');
    assert.equal(tracker.state.revision, 'b1');
  }
});

test('a current reconciliation read failure is reported unchanged instead of silently succeeding', async () => {
  const tracker = new WorkflowRevisionTracker();
  const gate = new WorkflowLoadGate();
  tracker.load('A', 'r1');
  const failure = new Error('current A read failed');
  await assert.rejects(reconcileWorkflowRemote(tracker, gate, undefined,
    async () => { throw failure; }, () => { throw new Error('failed read cannot apply'); },
    () => { throw new Error('an IO failure cannot delete the workflow'); }, storage), error => error === failure);
  assert.equal(tracker.state.workflowId, 'A');
  assert.equal(tracker.state.revision, 'r1');
});
