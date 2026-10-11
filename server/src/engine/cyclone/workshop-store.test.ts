import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { workshopIndexFile, workshopMetaFile, workshopWorkspace } from './paths.js';
import { createWorkshop, deleteWorkshop } from './workshop-store.js';

async function corruptExistingIndex(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-index-side-effect-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '原工作室' });
  const metaFile = workshopMetaFile(dataDir, workshop.id);
  const originalMeta = await fs.readFile(metaFile, 'utf8');
  const indexFile = workshopIndexFile(dataDir);
  await fs.writeFile(indexFile, '{broken', 'utf8');
  const root = path.dirname(indexFile);
  const originalEntries = (await fs.readdir(root)).sort();
  return { dataDir, workshop, metaFile, originalMeta, indexFile, root, originalEntries };
}

test('旧气旋创建遇损坏索引时不留下未入索引的新目录', async t => {
  const state = await corruptExistingIndex(t);
  await assert.rejects(createWorkshop(state.dataDir, { title: '新工作室' }), hasCorruptCode);
  assert.deepEqual((await fs.readdir(state.root)).sort(), state.originalEntries);
  assert.equal(await fs.readFile(state.metaFile, 'utf8'), state.originalMeta);
  assert.equal(await fs.readFile(state.indexFile, 'utf8'), '{broken');
});

test('旧气旋删除遇损坏索引时不删除工作室目录和 meta', async t => {
  const state = await corruptExistingIndex(t);
  await assert.rejects(deleteWorkshop(state.dataDir, state.workshop.id), hasCorruptCode);
  await fs.access(workshopWorkspace(state.dataDir, state.workshop.id));
  assert.deepEqual((await fs.readdir(state.root)).sort(), state.originalEntries);
  assert.equal(await fs.readFile(state.metaFile, 'utf8'), state.originalMeta);
  assert.equal(await fs.readFile(state.indexFile, 'utf8'), '{broken');
});

function hasCorruptCode(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'data' in error
    && (error as { data?: { code?: string } }).data?.code === 'CYCLONE_STORE_CORRUPT';
}
