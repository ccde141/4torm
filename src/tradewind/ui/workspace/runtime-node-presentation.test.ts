import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowNode } from '../../types';
import { completionFeedbackRemaining, runtimeNodeAction, runtimeNodeClasses } from './runtime-node-presentation';

const identity = { workflowId: 'workflow-a', executionId: 'run-a' };
const idle = { busy: false, envelopePending: false };
const node = (type: string): WorkflowNode => ({ id: 'shared-node', type, label: 'Worker', position: { x: 0, y: 0 }, config: {} });

test('conversation shortcuts retain the run identity and stay available after completion', () => {
  for (const live of [true, false]) {
    assert.deepEqual(runtimeNodeAction(node('agent'), identity, live), {
      eventName: 'tw-open-chat', detail: { ...identity, nodeId: 'shared-node', label: 'Worker' },
    });
    assert.equal(runtimeNodeAction(node('meeting'), identity, live)?.eventName, 'tw-open-meeting');
  }
  assert.equal(runtimeNodeAction(node('agent'), { ...identity, executionId: '' }, true), undefined);
  assert.equal(runtimeNodeAction(node('agent'), { ...identity, workflowId: '' }, true), undefined);
  assert.equal(runtimeNodeAction(node('agent'), { ...identity, executionId: 'run-b' }, true)?.detail.executionId, 'run-b');
});

test('review shortcuts require both an active run and the actual waiting envelope', () => {
  const waiting = { ...idle, humanGate: { waiting: true as const, envelopeContent: 'review this', arrivedAt: 1 } };
  assert.equal(runtimeNodeAction(node('human-gate'), identity, true, idle), undefined);
  assert.equal(runtimeNodeAction(node('human-gate'), identity, false, waiting), undefined);
  assert.deepEqual(runtimeNodeAction(node('human-gate'), identity, true, waiting), {
    eventName: 'tw-open-gate', detail: { ...identity, nodeId: 'shared-node', label: 'Worker', envelopeContent: 'review this' },
  });
  for (const type of ['entry', 'output', 'note']) assert.equal(runtimeNodeAction(node(type), identity, true, waiting), undefined);
});

test('idle or busy polling snapshots never manufacture successful completion', () => {
  assert.doesNotMatch(runtimeNodeClasses('agent', false, idle, true), /just-done/);
  assert.doesNotMatch(runtimeNodeClasses('agent', false, { ...idle, busy: true }, true), /just-done/);
  assert.doesNotMatch(runtimeNodeClasses('agent', false, { ...idle, busy: true, terminalOutcome: 'completed' }, true), /just-done/);
});

test('runtime presentation preserves envelope, working and explicit terminal colors', () => {
  const working = runtimeNodeClasses('agent', true, { busy: true, envelopePending: true }, false);
  assert.match(working, /tw-node--busy/);
  assert.match(working, /tw-node--envelope/);
  assert.match(working, /tw-node--selected/);
  assert.match(runtimeNodeClasses('agent', false, { ...idle, terminalOutcome: 'completed' }, true), /tw-node--just-done/);
  assert.doesNotMatch(runtimeNodeClasses('agent', false, { ...idle, terminalOutcome: 'completed' }, false), /tw-node--just-done/);
  assert.match(runtimeNodeClasses('agent', false, { ...idle, terminalOutcome: 'stopped' }, false), /tw-node--stopped/);
  assert.match(runtimeNodeClasses('agent', false, { ...idle, terminalOutcome: 'error' }, false), /tw-node--failed/);
});

test('completion feedback expires against its event timestamp instead of restarting on remount', () => {
  const completed = { ...idle, terminalOutcome: 'completed' as const, completedAt: 100_000 };
  assert.equal(completionFeedbackRemaining(completed, 100_000), 15_000);
  assert.equal(completionFeedbackRemaining(completed, 114_000), 1_000);
  assert.equal(completionFeedbackRemaining(completed, 115_000), 0);
  assert.equal(completionFeedbackRemaining({ ...completed, completedAt: undefined }, 100_000), 0);
  assert.equal(completionFeedbackRemaining({ ...completed, terminalOutcome: 'error' }, 100_000), 0);
});

test('review and output nodes reuse their specific waiting and terminal presentation', () => {
  assert.match(runtimeNodeClasses('human-gate', false, { ...idle,
    humanGate: { waiting: true, envelopeContent: '', arrivedAt: 1 } }, false), /tw-node--gate-waiting/);
  assert.match(runtimeNodeClasses('output', false, idle, false, 'completed'), /tw-node--output-complete/);
  for (const phase of ['stopped', 'failed', 'interrupted'] as const) {
    assert.match(runtimeNodeClasses('output', false, idle, false, phase), /tw-node--output-missed/);
  }
  assert.doesNotMatch(runtimeNodeClasses('output', false, idle, false, 'running'), /output-complete|output-missed/);
});
