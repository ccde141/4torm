import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeExecutionStatus } from './execution-sync.js';

test('external execution start becomes the active Tradewind state', () => {
  const next = mergeExecutionStatus(
    { running: false, executionId: null, workflowId: null, phase: 'idle' },
    { running: true, executionId: 'exec-1', workflowId: 'wf-1' },
  );
  assert.deepEqual(next, { running: true, executionId: 'exec-1', workflowId: 'wf-1', phase: 'running' });
});

test('an older empty status response cannot erase an externally started execution', () => {
  const current = { running: true, executionId: 'exec-2', workflowId: 'wf-2', phase: 'running' as const };
  assert.deepEqual(mergeExecutionStatus(current, { running: false }), current);
});

test('a terminal snapshot only ends the matching execution', () => {
  const current = { running: true, executionId: 'exec-2', workflowId: 'wf-2', phase: 'running' as const };
  assert.equal(mergeExecutionStatus(current, { running: false, executionId: 'exec-2', outcome: 'done' }).phase, 'completed');
  assert.deepEqual(mergeExecutionStatus(current, { running: false, executionId: 'exec-1', outcome: 'done' }), current);
});
