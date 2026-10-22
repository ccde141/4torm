import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleWorkflows, workflowTypeCounts, activeWorkflowRuns } from './sidebar-model';

const saved = { workflowId: 'wf-1', name: '发布检查', nodeCount: 4,
  updatedAt: '2026-10-15T08:00:00Z', revision: 'r1' };

test('legacy workflows remain strict and search does not remove a zero-node draft', () => {
  assert.equal(visibleWorkflows([saved], 'strict', '发布').length, 1);
  assert.equal(visibleWorkflows([saved], 'handoff', '').length, 0);
  const draft = { ...saved, workflowId: 'draft', name: '新工作流', nodeCount: 0, isDraft: true };
  assert.deepEqual(visibleWorkflows([saved], 'strict', '新', draft), [draft]);
});

test('the current local draft replaces its saved summary without duplicate entries', () => {
  const draft = { ...saved, name: '修改中的名称', nodeCount: 0, isDraft: true };
  assert.deepEqual(visibleWorkflows([saved], 'strict', '', draft), [draft]);
  assert.deepEqual(workflowTypeCounts([saved], draft), { strict: 1, handoff: 0 });
});

test('the run dock only includes real active states and preserves workflow identities', () => {
  const runs = ['completed', 'running', 'waiting', 'failed', 'paused', 'queued'].map((status, i) => ({
    workflowId: `wf-${i}`, name: `run ${i}`, status,
  }));
  assert.deepEqual(activeWorkflowRuns(runs).map(run => run.workflowId), ['wf-1', 'wf-2', 'wf-4', 'wf-5']);
});
