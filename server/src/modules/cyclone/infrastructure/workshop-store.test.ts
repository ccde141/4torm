import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  createWorkshopDraft,
  createWorkshop,
  deleteWorkshop,
  listWorkshops,
  publishWorkshop,
  renameWorkshop,
  workshopIndexFile,
  workshopMetaFile,
  workshopWorkspace,
} from './workshop-store.js';
import {
  createWorkshop as createLegacyWorkshop,
  loadWorkshop as loadLegacyWorkshop,
  saveWorkshop as saveLegacyWorkshop,
} from '../../../engine/cyclone/workshop-store.js';

async function temporaryData(t: TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-store-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('气旋工作室并发创建不会丢失索引项', async t => {
  const dataDir = await temporaryData(t);
  const workshops = await Promise.all(Array.from({ length: 8 }, (_, index) => (
    createWorkshop(dataDir, { title: `workshop-${index}` })
  )));
  const listed = await listWorkshops(dataDir);
  assert.deepEqual(
    new Set(listed.map(item => item.id)),
    new Set(workshops.map(item => item.id)),
  );
});

test('旧工位和群聊 store 的过期快照写入不会覆盖彼此及新配置', async t => {
  const dataDir = await temporaryData(t);
  const workshop = await createWorkshop(dataDir, { title: '原名' });
  const seatWriter = await loadLegacyWorkshop(dataDir, workshop.id);
  const roomWriter = await loadLegacyWorkshop(dataDir, workshop.id);
  assert.ok(seatWriter && roomWriter);
  seatWriter.seatIds.push('seat-a');
  roomWriter.roomIds.push('room-a');

  await renameWorkshop(dataDir, workshop.id, '新名');
  await Promise.all([
    saveLegacyWorkshop(dataDir, seatWriter),
    saveLegacyWorkshop(dataDir, roomWriter),
  ]);

  const saved = await loadLegacyWorkshop(dataDir, workshop.id);
  assert.equal(saved?.title, '新名');
  assert.deepEqual(saved?.seatIds, ['seat-a']);
  assert.deepEqual(saved?.roomIds, ['room-a']);
});

test('新旧工作室创建入口共享索引队列', async t => {
  const dataDir = await temporaryData(t);
  const creations = Array.from({ length: 12 }, (_, index) => (
    index % 2 === 0
      ? createWorkshop(dataDir, { title: `new-${index}` })
      : createLegacyWorkshop(dataDir, { title: `old-${index}` })
  ));
  const created = await Promise.all(creations);
  const listed = await listWorkshops(dataDir);
  assert.deepEqual(new Set(listed.map(item => item.id)), new Set(created.map(item => item.id)));
});

test('已删除的工作室不会被过期的旧 store 快照重新写回', async t => {
  const dataDir = await temporaryData(t);
  const workshop = await createWorkshop(dataDir, { title: '待删除' });
  const stale = await loadLegacyWorkshop(dataDir, workshop.id);
  assert.ok(stale);
  await deleteWorkshop(dataDir, workshop.id);
  stale.seatIds.push('late-seat');
  await assert.rejects(saveLegacyWorkshop(dataDir, stale), hasCode('CYCLONE_WORKSHOP_NOT_FOUND'));
  await assert.rejects(fs.access(workshopMetaFile(dataDir, workshop.id)));
  assert.deepEqual(await listWorkshops(dataDir), []);
});

test('气旋索引损坏时保留原文件并持续真实失败', async t => {
  const dataDir = await temporaryData(t);
  const indexFile = workshopIndexFile(dataDir);
  await fs.mkdir(path.dirname(indexFile), { recursive: true });
  await fs.writeFile(indexFile, '{broken', 'utf8');
  await assert.rejects(listWorkshops(dataDir), hasCode('CYCLONE_STORE_CORRUPT'));
  await assert.rejects(listWorkshops(dataDir), hasCode('CYCLONE_STORE_CORRUPT'));
  assert.equal(await fs.readFile(indexFile, 'utf8'), '{broken');
  await fs.rename(indexFile, `${indexFile}.corrupt-legacy`);
  await assert.rejects(listWorkshops(dataDir), hasCode('CYCLONE_STORE_CORRUPT'));
});

test('删除工作室同时清理工作区和子数据', async t => {
  const dataDir = await temporaryData(t);
  const workshop = await createWorkshop(dataDir, { title: '待删除' });
  const workspace = workshopWorkspace(dataDir, workshop.id);
  await fs.writeFile(path.join(workspace, 'artifact.txt'), 'content');
  await deleteWorkshop(dataDir, workshop.id);
  await assert.rejects(fs.access(path.dirname(workspace)));
  assert.deepEqual(await listWorkshops(dataDir), []);
});

test('气旋删除遇损坏索引时保留旧工作室目录和 meta', async t => {
  const dataDir = await temporaryData(t);
  const workshop = await createWorkshop(dataDir, { title: '保留工作室' });
  const metaFile = workshopMetaFile(dataDir, workshop.id);
  const originalMeta = await fs.readFile(metaFile, 'utf8');
  const indexFile = workshopIndexFile(dataDir);
  await fs.writeFile(indexFile, '{broken', 'utf8');
  await assert.rejects(deleteWorkshop(dataDir, workshop.id), hasCode('CYCLONE_STORE_CORRUPT'));
  await fs.access(workshopWorkspace(dataDir, workshop.id));
  assert.equal(await fs.readFile(metaFile, 'utf8'), originalMeta);
  assert.equal(await fs.readFile(indexFile, 'utf8'), '{broken');
});

test('工作室草稿在发布前不可见，发布后一次进入公开索引', async t => {
  const dataDir = await temporaryData(t);
  const draft = await createWorkshopDraft(dataDir, { title: '待发布协作组' });
  assert.deepEqual(await listWorkshops(dataDir), []);
  await publishWorkshop(dataDir, draft.id);
  assert.deepEqual((await listWorkshops(dataDir)).map(item => item.id), [draft.id]);
  await publishWorkshop(dataDir, draft.id);
  assert.deepEqual((await listWorkshops(dataDir)).map(item => item.id), [draft.id]);
});

function hasCode(code: string): (error: unknown) => boolean {
  return error => typeof error === 'object' && error !== null
    && 'data' in error
    && (error as { data?: { code?: string } }).data?.code === code;
}
