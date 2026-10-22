import assert from 'node:assert/strict';
import test from 'node:test';
import { selectWorkflowExecution, projectExecutionReceipts } from './execution-selection';

test('changing workflow never reuses another workflow or node execution', () => {
  const facts = [
    { operationId: 'W1', title: 'One', status: 'running' as const, runId: 'R1' },
    { operationId: 'node:W2:A', parentOperationId: 'W2', title: 'Node', status: 'running' as const, runId: 'round' },
    { operationId: 'W2', title: 'Two', status: 'waiting' as const, runId: 'R2' },
  ];
  assert.equal(selectWorkflowExecution(facts, 'W2')?.runId, 'R2');
  assert.equal(selectWorkflowExecution(facts, 'missing'), undefined);
  assert.equal(selectWorkflowExecution(facts, 'W2', facts[0])?.runId, 'R2');
});
test('accepted start resists an older probe; matching terminal fact replaces its receipt', () => {
  const receipt = { operationId: 'W1', title: 'One', status: 'running' as const, runId: 'new' };
  const old = { ...receipt, runId: 'old', status: 'completed' as const };
  assert.equal(selectWorkflowExecution([old], 'W1', receipt)?.runId, 'new');
  assert.equal(selectWorkflowExecution([{ ...receipt, status: 'completed' }], 'W1', receipt)?.status, 'completed');
});

test('a new receipt cannot inherit a previous run\'s waiting children or affect another workflow', () => {
  const receipt = { operationId: 'W1', title: 'One', status: 'running' as const, runId: 'new' };
  const facts = [{ ...receipt, runId: 'old', status: 'completed' as const },
    { operationId: 'node:W1:A', parentOperationId: 'W1', title: 'Old gate', status: 'waiting' as const, phase: 'human-gate' },
    { operationId: 'W2', title: 'Other', status: 'running' as const, runId: 'other' }];
  assert.deepEqual(projectExecutionReceipts(facts, { W1: receipt }), [facts[2], receipt]);
  const current = [{ ...receipt, status: 'completed' as const }, facts[2]];
  assert.deepEqual(projectExecutionReceipts(current, { W1: receipt }), current);
});
