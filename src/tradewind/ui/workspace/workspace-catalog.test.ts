import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeWorkspaceCatalog, selectWorkspaceWorkflow } from './workspace-catalog';

const items = [
  { workflowId: 'strict-a', name: 'A', nodeCount: 3, revision: 'r1', updatedAt: '2026-10-15T01:00:00Z' },
  { workflowId: 'handoff-b', name: 'B', nodeCount: 4, revision: 'r2', updatedAt: '2026-10-15T02:00:00Z', orchestration: 'handoff' as const },
];
test('legacy workflows stay strict; a missing remembered workflow cannot open the other mode', () => {
  assert.equal(selectWorkspaceWorkflow(items, 'strict', 'gone'), 'strict-a');
  assert.equal(selectWorkspaceWorkflow(items, 'handoff', 'strict-a'), 'handoff-b');
  assert.equal(selectWorkspaceWorkflow(items.slice(0, 1), 'handoff'), null);
});

test('idle probe does not create a card state without a label', () => {
  const draft = { workflowId: 'strict-a', name: 'A', nodeCount: 3, revision: 'r1', orchestration: 'strict' as const };
  const result = mergeWorkspaceCatalog(items, draft, [{ operationId: 'strict-a', title: 'A', status: 'idle' }]);
  assert.equal(result[0].status, undefined);
});

test('cleared selection never becomes a draft card; an explicitly created empty draft remains visible', () => {
  const blank = { workflowId: 'untitled', name: 'Untitled', nodeCount: 0,
    revision: null, orchestration: 'strict' as const };
  assert.equal(mergeWorkspaceCatalog(items, blank, []).length, items.length);
  const draft = mergeWorkspaceCatalog(items, { ...blank, workflowId: 'wf-new' }, [])
    .find(item => item.workflowId === 'wf-new');
  assert.equal(draft?.isDraft, true);
  assert.equal(draft?.nodeCount, 0);
});
test('only matching root facts decorate cards; current draft preserves its actual type', () => {
  const draft = { workflowId: 'draft-c', name: 'Draft', nodeCount: 0, revision: null, orchestration: 'handoff' as const };
  const result = mergeWorkspaceCatalog(items, draft, [
    { operationId: 'strict-a', title: 'A', status: 'waiting', runId: 'run-a', waitingReason: 'waiting for review' },
    { operationId: 'node:strict-a:x', parentOperationId: 'strict-a', title: 'Node', status: 'running' },
  ]);
  assert.equal(result.find(item => item.workflowId === 'strict-a')?.status, 'waiting');
  assert.equal(result.find(item => item.workflowId === 'strict-a')?.runId, 'run-a');
  assert.equal(result.find(item => item.workflowId === 'strict-a')?.needsAttention, false);
  assert.equal(result.find(item => item.workflowId === 'handoff-b')?.status, undefined);
  assert.equal(result.find(item => item.workflowId === 'draft-c')?.workflowType, 'handoff');
  assert.equal(result.length, 3);
});

test('card attention follows explicit human input facts and stays scoped to that workflow', () => {
  const draft = { workflowId: 'strict-a', name: 'A', nodeCount: 3, revision: 'r1', orchestration: 'strict' as const };
  const result = mergeWorkspaceCatalog(items, draft, [
    { operationId: 'strict-a', title: 'A', status: 'running', runId: 'run-a' },
    { operationId: 'node:strict-a:meeting', parentOperationId: 'strict-a', title: 'Meeting',
      status: 'waiting', phase: 'meeting-discussing', waitingReason: '等待人类继续会议' },
    { operationId: 'handoff-b', title: 'B', status: 'waiting', runId: 'run-b', phase: 'waiting-upstream' },
  ]);
  assert.equal(result[0].status, 'running');
  assert.equal(result[0].needsAttention, true);
  assert.equal(result[0].activity, '等待人类继续会议');
  assert.equal(result[1].needsAttention, false);
});
