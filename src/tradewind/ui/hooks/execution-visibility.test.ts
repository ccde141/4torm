import assert from 'node:assert/strict';
import test from 'node:test';
import { belongsToExecution, visibleNodeStatuses } from './execution-visibility.js';

test('W2 的节点状态不能落到 W1 编辑画布，旧执行和无身份事件也不能落到新执行', () => {
  const current = { workflowId: 'wf-2', executionId: 'exec-2' };
  const snapshot = { running: true, workflowId: 'wf-2', executionId: 'exec-2',
    nodes: { writer: { busy: true } } };
  assert.deepEqual(visibleNodeStatuses(snapshot, 'wf-1', current), {});
  assert.deepEqual(visibleNodeStatuses(snapshot, 'wf-2', current), snapshot.nodes);
  assert.deepEqual(visibleNodeStatuses({ ...snapshot, executionId: 'exec-1' }, 'wf-2', current), {});
  assert.equal(belongsToExecution({ workflowId: 'wf-2', executionId: 'exec-1' }, current), false);
  assert.equal(belongsToExecution({ workflowId: 'wf-2' }, current), false);
  assert.equal(belongsToExecution({ workflowId: 'wf-2', executionId: 'exec-2' }, current), true);
});
