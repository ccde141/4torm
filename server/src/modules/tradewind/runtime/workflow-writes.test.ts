import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { subscribeUnified } from '../../../engine/tradewind/streaming/unified-stream.js';
import { createTradewindDesignPort } from './design-adapter.js';
import { createTradewindWorkflowAdmin } from './workflow-admin.js';
import { createTradewindWorkflowStore } from './workflow-store.js';
import { createTradewindWorkflowWrites } from './workflow-writes.js';

const graph = {
  nodes: [{ id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

test('人类与 Agent 经同一保存服务写入，落盘后通知且冲突不通知', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-writes-'));
  const workflowId = `wf-test-${randomUUID()}`;
  const events: Array<Record<string, unknown>> = [];
  const store = createTradewindWorkflowStore(root);
  const unsubscribe = subscribeUnified(event => {
    if (event.workflowId === workflowId) events.push(event);
  });
  try {
    await fs.mkdir(path.join(root, 'agents'), { recursive: true });
    await fs.writeFile(path.join(root, 'agents', 'registry.json'), JSON.stringify({
      planner: { name: '规划者', role: '拆解任务' },
    }));
    const writes = createTradewindWorkflowWrites(store);
    const human = createTradewindWorkflowAdmin(root, { open: async () => {} }, store, writes);
    const agent = createTradewindDesignPort(root, store, writes);
    const created = await human.save({ workflowId, name: '人类草稿', graph, expectedRevision: null });
    assert.equal((await store.read(workflowId)).revision, created.revision);
    assert.deepEqual(events.map(event => event.change), ['created']);

    const spec = { name: 'Agent 设计', nodes: [
      { id: 'entry', type: 'entry' as const, label: '入口' },
      { id: 'planner', type: 'agent' as const, label: '规划者', agentId: 'planner' },
      { id: 'output', type: 'output' as const, label: '输出' },
    ], edges: [{ source: 'entry', target: 'planner' }, { source: 'planner', target: 'output' }] };
    await agent.updateWorkflow(workflowId, spec, created.revision);
    const updated = await store.read(workflowId);
    assert.equal(updated.name, 'Agent 设计');
    assert.equal(events.at(-1)?.revision, updated.revision);
    assert.deepEqual(events.map(event => event.change), ['created', 'updated']);
    await assert.rejects(human.save({ workflowId, name: '过期人类草稿', graph,
      expectedRevision: created.revision }), errorCode('TRADEWIND_WORKFLOW_CHANGED'));
    assert.equal(events.length, 2);
    await human.delete(workflowId, updated.revision);
    assert.deepEqual(events.map(event => event.change), ['created', 'updated', 'deleted']);
    assert.equal(events.at(-1)?.revision, null);
  } finally {
    unsubscribe();
    await fs.rm(root, { recursive: true, force: true });
  }
});

function errorCode(code: string): (error: unknown) => boolean {
  return error => error instanceof FrameworkError && error.data.code === code;
}
