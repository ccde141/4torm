import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { createTradewindWorkflowAdmin } from './workflow-admin.js';

const graph = {
  nodes: [{ id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

test('工作流管理拒绝目录穿越且不在数据根外写文件', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-admin-'));
  try {
    const admin = createTradewindWorkflowAdmin(dataDir, { open: async () => {} });
    await assert.rejects(admin.save({ workflowId: '../escape', name: '越界', graph, expectedRevision: null }),
      errorCode('TRADEWIND_WORKFLOW_ID_INVALID'));
    await assert.rejects(fs.access(path.join(dataDir, '..', 'escape')));
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('工作流保存和删除由同一管理端口完成', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-admin-'));
  try {
    const admin = createTradewindWorkflowAdmin(dataDir, { open: async () => {} });
    const saved = await admin.save({ workflowId: 'wf-1', name: '发布', graph, expectedRevision: null });
    assert.deepEqual(saved, { saved: true, workflowId: 'wf-1', name: '发布', revision: saved.revision });
    const base = path.join(dataDir, 'tradewind', 'workflows', 'wf-1');
    const definition = JSON.parse(await fs.readFile(path.join(base, 'definition.json'), 'utf8'));
    assert.deepEqual(definition.graph, graph);
    assert.equal(definition.name, '发布');
    assert.equal(definition.schemaVersion, 1);
    assert.deepEqual(await admin.load('wf-1'), { ...definition, revision: saved.revision });
    assert.deepEqual(await admin.list(), [{
      workflowId: 'wf-1', name: '发布', nodeCount: 1, updatedAt: definition.updatedAt,
      revision: saved.revision,
    }]);
    await assert.rejects(fs.access(path.join(base, 'graph.json')));
    await assert.rejects(fs.access(path.join(base, 'meta.json')));
    assert.deepEqual(await admin.delete('wf-1', saved.revision), { deleted: true, workflowId: 'wf-1' });
    await assert.rejects(fs.access(base));
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('工作流损坏时真实报错而不是伪装为空列表', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-admin-'));
  try {
    const base = path.join(dataDir, 'tradewind', 'workflows', 'broken');
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, 'definition.json'), '{broken');
    const admin = createTradewindWorkflowAdmin(dataDir, { open: async () => {} });
    await assert.rejects(admin.list(), errorCode('TRADEWIND_WORKFLOW_DATA_INVALID'));
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('循环档案损坏时不伪装成空列表', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-admin-'));
  try {
    const admin = createTradewindWorkflowAdmin(dataDir, { open: async () => {} });
    await admin.save({ workflowId: 'wf-1', name: '发布', graph, expectedRevision: null });
    await fs.writeFile(path.join(dataDir, 'tradewind', 'workflows', 'wf-1', 'profiles.json'), '{}');
    await assert.rejects(admin.loadProfiles('wf-1'), errorCode('TRADEWIND_PROFILES_READ_FAILED'));
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

function errorCode(code: string): (error: unknown) => boolean {
  return error => error instanceof FrameworkError && error.data.code === code;
}
