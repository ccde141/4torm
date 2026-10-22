import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorkflowNodeFeedback, mergeWorkflowNodeStatuses, type WorkflowNodeStatus } from './workflow-node-feedback';

const identity = { workflowId: 'workflow-a', executionId: 'execution-a' };
const event = { ...identity, scope: 'agent', nodeId: 'writer' };
const active = { writer: { busy: true, envelopePending: true } };

test('explicit completion retains its timestamp across idle and terminal snapshots', () => {
  const done = applyWorkflowNodeFeedback(active, { ...event, type: 'done', outcome: 'completed' }, identity, 123);
  assert.equal(done.writer.terminalOutcome, 'completed');
  assert.equal(done.writer.completedAt, 123);
  const idle = mergeWorkflowNodeStatuses(done, { ...identity, running: true,
    nodes: { writer: { busy: false, envelopePending: false } } }, identity);
  const ended = mergeWorkflowNodeStatuses(idle, { ...identity, running: false, nodes: {} }, identity);
  assert.deepEqual(ended.writer, { busy: false, envelopePending: false, terminalOutcome: 'completed', completedAt: 123 });
  assert.strictEqual(applyWorkflowNodeFeedback(ended, { ...event, type: 'done', outcome: 'completed' }, identity, 999), ended);
});

test('busy ending, legacy done and a workflow ending do not invent successful nodes', () => {
  const idle = mergeWorkflowNodeStatuses(active, { ...identity, running: true,
    nodes: { writer: { busy: false, envelopePending: false } } }, identity);
  assert.equal(idle.writer.terminalOutcome, undefined);
  assert.strictEqual(applyWorkflowNodeFeedback(idle, { ...event, type: 'done' }, identity, 123), idle);
  const ended = mergeWorkflowNodeStatuses(active, { ...identity, running: false, nodes: {} }, identity);
  assert.deepEqual(ended.writer, { busy: false, envelopePending: false });
});

test('terminal snapshots stop activity and review indicators without erasing confirmed failures', () => {
  const nodes: Record<string, WorkflowNodeStatus> = {
    writer: { busy: false, envelopePending: true, terminalOutcome: 'error' },
    gate: { busy: false, envelopePending: true, humanGate: { waiting: true, envelopeContent: 'review', arrivedAt: 100 } },
    pending: { busy: true, envelopePending: true },
  };
  assert.deepEqual(mergeWorkflowNodeStatuses(nodes, { ...identity, running: false, nodes: {} }, identity), {
    writer: { busy: false, envelopePending: false, terminalOutcome: 'error' },
    gate: { busy: false, envelopePending: false }, pending: { busy: false, envelopePending: false },
  });
});

test('new busy activity or an explicit round-start clears the previous terminal result', () => {
  const done = { writer: { busy: false, envelopePending: false, terminalOutcome: 'completed' as const, completedAt: 123 } };
  assert.deepEqual(mergeWorkflowNodeStatuses(done, { ...identity, running: true, nodes: active }, identity), active);
  const started = applyWorkflowNodeFeedback(done, { ...event, type: 'round-start' }, identity, 200);
  assert.deepEqual(started.writer, { busy: true, envelopePending: false });
});

test('stopped and failed node events keep distinct terminal outcomes without completion timestamps', () => {
  const stopped = applyWorkflowNodeFeedback(active, { ...event, type: 'done', outcome: 'stopped' }, identity, 123);
  const failed = applyWorkflowNodeFeedback(active, { ...event, type: 'error' }, identity, 123);
  assert.deepEqual(stopped.writer, { busy: false, envelopePending: true, terminalOutcome: 'stopped' });
  assert.deepEqual(failed.writer, { busy: false, envelopePending: true, terminalOutcome: 'error' });
});

test('another workflow, an older execution and identity-free transport errors cannot change current nodes', () => {
  for (const change of [{ workflowId: 'workflow-b' }, { executionId: 'execution-old' }]) {
    assert.strictEqual(applyWorkflowNodeFeedback(active, { ...event, ...change, type: 'done', outcome: 'completed' }, identity, 123), active);
    assert.strictEqual(mergeWorkflowNodeStatuses(active, { ...identity, ...change, running: false, nodes: {} }, identity), active);
  }
  assert.strictEqual(applyWorkflowNodeFeedback(active, { type: 'error' }, identity, 123), active);
  assert.strictEqual(applyWorkflowNodeFeedback(active, { ...event, scope: 'execution', type: 'error' }, identity, 123), active);
});

test('a poll begun before a completion or reactivation cannot overwrite that newer event', () => {
  const done = applyWorkflowNodeFeedback(active, { ...event, type: 'done', outcome: 'completed' }, identity, 123);
  const staleBusy = mergeWorkflowNodeStatuses(done, { ...identity, running: true, nodes: active }, identity, new Set(['writer']));
  assert.deepEqual(staleBusy, done);
  const started = applyWorkflowNodeFeedback(done, { ...event, type: 'round-start' }, identity, 200);
  const staleEnd = mergeWorkflowNodeStatuses(started, { ...identity, running: false, nodes: {} }, identity, new Set(['writer']));
  assert.deepEqual(staleEnd, started);
});
