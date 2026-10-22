import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgeWorkflowRun, readAcknowledgedWorkflowRuns, workflowCardState } from './workflow-card-state';
import type { WorkflowSidebarItem } from './workspace-types';

const item: WorkflowSidebarItem = { workflowId: 'workflow-a', name: 'A', nodeCount: 3,
  revision: 'r1', updatedAt: '2026-10-20T00:00:00Z', status: 'completed', runId: 'run-a' };

test('completion is confirmed only by selecting that completed run and never leaks into a new run', () => {
  const acknowledged = acknowledgeWorkflowRun({}, item);
  assert.equal(workflowCardState(item, {}), 'completed');
  assert.equal(workflowCardState(item, acknowledged), undefined);
  assert.equal(workflowCardState({ ...item, runId: 'run-b', status: 'running' }, acknowledged), 'running');
  assert.equal(workflowCardState({ ...item, runId: 'run-b' }, acknowledged), 'completed');
  assert.equal(workflowCardState({ ...item, workflowId: 'workflow-b' }, acknowledged), 'completed');
  assert.deepEqual(acknowledgeWorkflowRun({}, { ...item, status: 'running' }), {});
  assert.deepEqual(acknowledgeWorkflowRun({}, { ...item, runId: undefined }), {});
});

test('human intervention is distinct from ordinary waiting and failure is never completion', () => {
  assert.equal(workflowCardState({ ...item, status: 'waiting' }, {}), 'running');
  assert.equal(workflowCardState({ ...item, status: 'running', needsAttention: true }, {}), 'attention');
  assert.equal(workflowCardState({ ...item, status: 'paused' }, {}), 'attention');
  assert.equal(workflowCardState({ ...item, status: 'failed', needsAttention: true }, {}), 'error');
  assert.equal(workflowCardState({ ...item, status: 'crashed' }, {}), 'error');
  assert.equal(workflowCardState({ ...item, status: 'aborted' }, {}), undefined);
  assert.equal(workflowCardState({ ...item, status: undefined }, {}), undefined);
});

test('saved confirmations tolerate damaged or unavailable browser storage', () => {
  assert.deepEqual(readAcknowledgedWorkflowRuns(), {});
  assert.deepEqual(readAcknowledgedWorkflowRuns({ getItem() { throw new Error('blocked'); } }), {});
  assert.deepEqual(readAcknowledgedWorkflowRuns({ getItem: () => 'broken' }), {});
  assert.deepEqual(readAcknowledgedWorkflowRuns({ getItem: () => '[]' }), {});
  const restored = readAcknowledgedWorkflowRuns({ getItem: () => '{"workflow-a":"run-a","invalid":12}' });
  assert.deepEqual(restored, { 'workflow-a': 'run-a' });
  assert.equal(workflowCardState(item, restored), undefined);
});
