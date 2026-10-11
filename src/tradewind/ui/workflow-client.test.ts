import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteWorkflow, listWorkflows, loadWorkflow, openWorkflowWorkspace, saveWorkflow,
} from './workflow-client';
import type { WorkflowGraph } from '../types';

const graph: WorkflowGraph = {
  nodes: [{ id: 'entry-1', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

test('saving keeps workflow ID stable and persists the display name', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  let requested = '';
  globalThis.fetch = async (input, init) => {
    requested = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ saved: true, workflowId: 'wf-stable', name: '资料整理', revision: 'r1' }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.equal((await saveWorkflow({ workflowId: 'wf-stable', name: '资料整理', graph, expectedRevision: null })).revision, 'r1');

  assert.equal(requested, '/api/collaboration/invoke');
  assert.deepEqual(requestBody, {
    feature: 'tradewind', method: 'saveWorkflow',
    input: { workflowId: 'wf-stable', name: '资料整理', graph, expectedRevision: null },
  });
});

test('saving reports the server error instead of showing success', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: '磁盘写入失败' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    saveWorkflow({ workflowId: 'wf-stable', name: '资料整理', graph, expectedRevision: 'r0' }),
    /磁盘写入失败/,
  );
});

test('deleting reports failure instead of letting the list refresh as success', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: '工作流正在使用' }),
    { status: 409, headers: { 'Content-Type': 'application/json' } },
  );
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(deleteWorkflow('wf-stable', 'r0'), /工作流正在使用/);
});

test('opening a workflow workspace uses the stable workflow ID', async (t) => {
  const originalFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async (input, init) => {
    requested = String(input);
    assert.equal(init?.method, 'POST');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await openWorkflowWorkspace('wf name/01');

  assert.equal(requested, '/api/collaboration/invoke');
});

test('workflow requests use the caller locale fallback without hiding server status', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(deleteWorkflow('wf-stable', 'r0', 'Failed to delete workflow'), /Failed to delete workflow \(HTTP 503\)/);
});

test('workflow reads use the collaboration center instead of feature routes', async (t) => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const result = body.method === 'loadWorkflow'
      ? { schemaVersion: 1, workflowId: 'wf-1', name: '发布', updatedAt: 'now', revision: 'r1', graph }
      : [{ workflowId: 'wf-1', name: '发布', nodeCount: 1, updatedAt: 'now', revision: 'r1' }];
    return new Response(JSON.stringify(result), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const loaded = await loadWorkflow('wf-1');
  assert.equal(loaded.name, '发布');
  assert.equal(loaded.revision, 'r1');
  assert.equal((await listWorkflows())[0]?.workflowId, 'wf-1');
  assert.deepEqual(bodies, [
    { feature: 'tradewind', method: 'loadWorkflow', input: { workflowId: 'wf-1' } },
    { feature: 'tradewind', method: 'listWorkflowSummaries', input: {} },
  ]);
});
