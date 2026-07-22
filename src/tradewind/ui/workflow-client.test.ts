import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteWorkflow, openWorkflowWorkspace, saveWorkflow } from './workflow-client';
import type { WorkflowGraph } from '../types';

const graph: WorkflowGraph = {
  nodes: [{ id: 'entry-1', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

test('saving keeps workflow ID stable and persists the display name', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ saved: true }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await saveWorkflow({ workflowId: 'wf-stable', name: '资料整理', graph });

  assert.equal(requestBody?.workflowId, 'wf-stable');
  assert.equal(requestBody?.name, '资料整理');
});

test('saving reports the server error instead of showing success', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: '磁盘写入失败' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    saveWorkflow({ workflowId: 'wf-stable', name: '资料整理', graph }),
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

  await assert.rejects(deleteWorkflow('wf-stable'), /工作流正在使用/);
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

  assert.equal(requested, '/api/tradewind/workflow/wf%20name%2F01/open-workspace');
});
