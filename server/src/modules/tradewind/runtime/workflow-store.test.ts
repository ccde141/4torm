import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { createTradewindWorkflowStore } from './workflow-store.js';

const graph = {
  nodes: [{ id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

test('旧 schemaVersion 1 定义可读且 revision 不写入文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-revision-'));
  try {
    const file = path.join(root, 'tradewind', 'workflows', 'wf-1', 'definition.json');
    const legacy = { schemaVersion: 1, workflowId: 'wf-1', name: '旧流程',
      updatedAt: '2025-01-01T00:00:00.000Z', graph };
    const raw = JSON.stringify(legacy);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, raw);
    const store = createTradewindWorkflowStore(root);
    const read = await store.read('wf-1');
    assert.deepEqual(read, { ...legacy, revision: createHash('sha256').update(raw).digest('hex') });
    assert.equal((await store.list())[0]?.revision, read.revision);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), legacy);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('同一 revision 的人类与 Agent 并发写入只有一方成功，冲突不覆盖赢家', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-cas-'));
  try {
    const store = createTradewindWorkflowStore(root);
    const created = await store.save({ workflowId: 'wf-1', name: '原版', graph, expectedRevision: null });
    const results = await Promise.allSettled([
      store.save({ workflowId: 'wf-1', name: '人类版', graph, expectedRevision: created.revision }),
      store.save({ workflowId: 'wf-1', name: 'Agent 版', graph, expectedRevision: created.revision }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.ok(rejected.reason instanceof FrameworkError);
    assert.equal(rejected.reason.data.code, 'TRADEWIND_WORKFLOW_CHANGED');
    const winner = results.find(result => result.status === 'fulfilled');
    assert.ok(winner?.status === 'fulfilled');
    assert.equal((await store.read('wf-1')).name, winner.value.name);
    const file = path.join(root, 'tradewind', 'workflows', 'wf-1', 'definition.json');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).revision, undefined);
    await assert.rejects(store.save({ workflowId: 'wf-1', name: '重复新建', graph,
      expectedRevision: null }), errorCode('TRADEWIND_WORKFLOW_CHANGED'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('删除后旧 revision 无法复活工作流', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-delete-cas-'));
  try {
    const store = createTradewindWorkflowStore(root);
    const created = await store.save({ workflowId: 'wf-1', name: '原版', graph, expectedRevision: null });
    assert.equal(await store.remove('wf-1', created.revision), true);
    await assert.rejects(store.save({ workflowId: 'wf-1', name: '旧草稿', graph,
      expectedRevision: created.revision }), errorCode('TRADEWIND_WORKFLOW_CHANGED'));
    await assert.rejects(store.read('wf-1'), errorCode('TRADEWIND_WORKFLOW_NOT_FOUND'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function errorCode(code: string): (error: unknown) => boolean {
  return error => error instanceof FrameworkError && error.data.code === code;
}
