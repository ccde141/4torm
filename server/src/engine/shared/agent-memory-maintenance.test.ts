import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execMemoryTool, readMemory, listMemory, recallMemory } from './agent-memory.js';
import { createRecallCatalog } from './memory-recall/catalog.js';
import { searchRecall } from './memory-recall/retrieval.js';

test('agents update the original memory, reject stale writes, preserve archive access and delete only the bound owner', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-maintenance-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await execMemoryTool(dataDir, 'a', 'chat', 'memory_write', { summary: '项目甲约定', detail: '旧规则', category: 'feedback' });
  const [row] = await listMemory(dataDir, 'a');
  const first = (await readMemory(dataDir, 'a', row.slug))!;
  const read = await execMemoryTool(dataDir, 'a', 'chat', 'memory_read', { slug: row.slug });
  assert.match(read, /不是人类本次要求/); assert.ok(read.includes(`updated: ${first.updated}`));
  await execMemoryTool(dataDir, 'a', 'chat', 'memory_update', { slug: row.slug, expectedUpdated: first.updated,
    summary: '项目甲约定', detail: '保留条件后的新规则', tier: 'archived' });
  assert.equal((await listMemory(dataDir, 'a')).length, 1);
  assert.equal((await readMemory(dataDir, 'a', row.slug))?.detail, '保留条件后的新规则');
  await assert.rejects(execMemoryTool(dataDir, 'a', 'chat', 'memory_update', { slug: row.slug, expectedUpdated: first.updated, detail: '陈旧覆盖' }), /重新读取/);
  const archived = await execMemoryTool(dataDir, 'a', 'chat', 'memory_list', { status: 'archived', query: '项目甲' });
  assert.ok(archived.includes(row.slug));
  assert.match(await execMemoryTool(dataDir, 'a', 'chat', 'memory_list', { status: 'active' }), /共 0 条/);
  await assert.rejects(execMemoryTool(dataDir, 'a', 'chat', 'memory_list', { status: 'invalid' }), /MEMORY_STATUS_INVALID/);
  assert.equal(await recallMemory(dataDir, 'a', '项目甲'), '');
  const catalog = createRecallCatalog(dataDir);
  assert.equal((await searchRecall(dataDir, 'a', catalog, { query: '项目甲' })).records.length, 0);
  assert.equal((await searchRecall(dataDir, 'a', catalog, { query: '项目甲' }, { includeArchived: true })).records.length, 1);
  assert.equal(await readMemory(dataDir, 'b', row.slug), null);
  const current = (await readMemory(dataDir, 'a', row.slug))!;
  const restored = await execMemoryTool(dataDir, 'a', 'chat', 'memory_update', {
    slug: row.slug, expectedUpdated: current.updated, tier: 'normal',
  });
  assert.match(restored, /已恢复长期记忆/);
  assert.match(await execMemoryTool(dataDir, 'a', 'chat', 'memory_list', { status: 'archived' }), /共 0 条/);
  assert.ok((await execMemoryTool(dataDir, 'a', 'chat', 'memory_list', { status: 'active' })).includes(row.slug));
  assert.equal((await searchRecall(dataDir, 'a', catalog, { query: '项目甲' })).records.length, 1);
  await assert.rejects(execMemoryTool(dataDir, 'a', 'chat', 'memory_delete', { slug: row.slug, expectedUpdated: current.updated }), /重新读取/);
  const latest = (await readMemory(dataDir, 'a', row.slug))!;
  await execMemoryTool(dataDir, 'a', 'chat', 'memory_delete', { slug: row.slug, expectedUpdated: latest.updated });
  assert.deepEqual(await listMemory(dataDir, 'a'), []);
});
