import assert from 'node:assert/strict';
import test from 'node:test';
import { executionUpdateFromProbe, mergeExecutionStatus } from './execution-sync.js';

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

test('an authoritative empty probe after a server restart interrupts a stale running execution', () => {
  const current = { running: true, executionId: 'exec-2', workflowId: 'wf-2', phase: 'running' as const };
  assert.deepEqual(mergeExecutionStatus(current, { running: false, authoritative: true }), {
    running: false, executionId: null, workflowId: 'wf-2', phase: 'interrupted',
  });
});

test('a terminal snapshot only ends the matching execution', () => {
  const current = { running: true, executionId: 'exec-2', workflowId: 'wf-2', phase: 'running' as const };
  assert.equal(mergeExecutionStatus(current, { running: false, executionId: 'exec-2', outcome: 'done' }).phase, 'completed');
  assert.deepEqual(mergeExecutionStatus(current, { running: false, executionId: 'exec-1', outcome: 'done' }), current);
});

test('中心探针是执行总体状态的唯一映射来源', () => {
  assert.deepEqual(executionUpdateFromProbe({
    operationId: 'wf-1', title: '发布', status: 'waiting', runId: 'exec-1',
  }), { running: true, executionId: 'exec-1', workflowId: 'wf-1' });
  assert.deepEqual(executionUpdateFromProbe({
    operationId: 'wf-1', title: '发布', status: 'completed', runId: 'exec-1',
  }), { running: false, executionId: 'exec-1', workflowId: 'wf-1', outcome: 'done' });
  assert.deepEqual(executionUpdateFromProbe({
    operationId: 'wf-1', title: '发布', status: 'crashed', runId: 'exec-1',
  }), { running: false, executionId: 'exec-1', workflowId: 'wf-1', terminalPhase: 'interrupted' });
});

test('旧轮次的中心终态不能覆盖当前轮次', () => {
  const current = { running: true, executionId: 'exec-2', workflowId: 'wf-1', phase: 'running' as const };
  const old = executionUpdateFromProbe({
    operationId: 'wf-1', title: '发布', status: 'failed', runId: 'exec-1',
  });
  assert.deepEqual(mergeExecutionStatus(current, old), current);
});
