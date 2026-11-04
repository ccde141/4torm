import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildMemoryToolDefs, execMemoryTool } from './agent-memory.js';
import { registerCompactWork } from './memory-recall/work-records.js';

test('three memory tools preserve browsing, revisions, archive recovery and owner boundaries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-tools-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(buildMemoryToolDefs().map(tool => tool.name), ['recall_search', 'recall_read', 'memory_manage']);
  const call = (tool: string, args: Record<string, string>) => execMemoryTool(root, 'a', 'test', tool, args);
  await call('memory_manage', { action: 'create', summary: '结构规范', detail: '遵循功能岛边界', category: 'fact' });
  await call('memory_manage', { action: 'create', summary: '偏好', detail: '简洁表达', category: 'feedback' });
  const page = JSON.parse(await call('recall_search', { kind: 'memory', limit: '1' }));
  assert.equal(page.total, 2);
  assert.equal(page.nextOffset, 1);
  const next = JSON.parse(await call('recall_search', { kind: 'memory', limit: '1', offset: '1' }));
  assert.notEqual(page.records[0].id, next.records[0].id);
  const found = JSON.parse(await call('recall_search', { category: 'fact' }));
  const id = found.records[0].id;
  const read = JSON.parse(await call('recall_read', { id }));
  assert.equal(read.content, '遵循功能岛边界');
  assert.ok(read.source.updated);
  const version = { id, expectedUpdated: read.source.updated };
  await call('memory_manage', { action: 'archive', ...version });
  assert.equal(JSON.parse(await call('recall_search', { status: 'active', category: 'fact' })).total, 0);
  assert.equal(JSON.parse(await call('recall_search', { status: 'archived' })).records[0].id, id);
  await assert.rejects(call('memory_manage', { action: 'restore', ...version }), /重新读取/);
  const archived = JSON.parse(await call('recall_read', { id }));
  assert.equal(archived.source.archived, true);
  await call('memory_manage', { action: 'restore', id, expectedUpdated: archived.source.updated });
  const restored = JSON.parse(await call('recall_read', { id }));
  await call('memory_manage', { action: 'update', id, expectedUpdated: restored.source.updated, detail: '保留模块职责边界' });
  const current = JSON.parse(await call('recall_read', { id }));
  await assert.rejects(execMemoryTool(root, 'b', 'test', 'memory_manage', {
    action: 'delete', id, expectedUpdated: current.source.updated,
  }), /重新读取/);
  const work = await registerCompactWork(root, 'a', { id: 'compact', sessionId: 's', sessionTitle: '工作',
    timestamp: '2026-11-03T00:00:00Z', summary: '已完成模块分析' });
  assert.equal(JSON.parse(await call('recall_read', { id: work.id })).content, '已完成模块分析');
  await assert.rejects(call('memory_manage', { action: 'delete', id: work.id, expectedUpdated: current.source.updated }), /MEMORY_ID_INVALID/);
  await assert.rejects(call('memory_manage', { action: 'delete', id, expectedUpdated: current.source.updated, agentId: 'b' }), /MEMORY_ARGUMENTS_INVALID/);
  await call('memory_manage', { action: 'delete', id, expectedUpdated: current.source.updated });
  await assert.rejects(call('recall_read', { id }), /RECALL_SOURCE_UNAVAILABLE/);
});
