import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  applyBulletinOps,
  buildBulletinSection,
  execBulletin,
  readBulletin,
  readBulletinHistory,
  readBulletinSync,
  subscribeBulletinChanges,
} from './bulletin.js';
import { workshopBulletinFile, workshopBulletinHistoryFile } from './paths.js';

async function temporaryData(t: TestContext): Promise<{ dataDir: string; workshopId: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-bulletin-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return { dataDir, workshopId: 'workshop-a' };
}

test('公告仅在真实提交后通知，旧工位 add 与人类写入走同一个提交点', async t => {
  const { dataDir, workshopId } = await temporaryData(t);
  const seen: string[] = [];
  subscribeBulletinChanges(dataDir, () => { throw new Error('SSE 已断开'); });
  const stop = subscribeBulletinChanges(dataDir, id => seen.push(id));
  t.after(stop);
  await execBulletin(dataDir, workshopId, { action: 'get' }, '工位');
  await execBulletin(dataDir, workshopId, { action: 'add', text: '旧工位公告' }, '工位');
  await applyBulletinOps(dataDir, workshopId, [{ op: 'add', text: '人类公告' }], '人类');
  await applyBulletinOps(dataDir, workshopId, [{ op: 'remove', id: 'missing' }], '人类');
  assert.deepEqual(seen, [workshopId, workshopId]);
  stop();
  await applyBulletinOps(dataDir, workshopId, [{ op: 'add', text: '第三条' }], '人类');
  assert.equal(seen.length, 2);
});

test('公告文件缺失仍返回空板，旧 content 格式仍可读写', async t => {
  const { dataDir, workshopId } = await temporaryData(t);
  assert.deepEqual(await readBulletin(dataDir, workshopId), { entries: [], updatedAt: 0 });
  assert.deepEqual(readBulletinSync(dataDir, workshopId), { entries: [], updatedAt: 0 });
  assert.deepEqual(await readBulletinHistory(dataDir, workshopId), []);
  const file = workshopBulletinFile(dataDir, workshopId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ content: '旧公告', updatedAt: 7 }));
  assert.equal((await readBulletin(dataDir, workshopId)).entries[0]?.text, '旧公告');
  assert.equal((await applyBulletinOps(dataDir, workshopId,
    [{ op: 'add', text: '新公告' }], '测试者')).entries.length, 2);
});

test('损坏公告及非 ENOENT 读错误真实抛出，不会覆盖原文件', async t => {
  const { dataDir, workshopId } = await temporaryData(t);
  const file = workshopBulletinFile(dataDir, workshopId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{broken');
  await assert.rejects(readBulletin(dataDir, workshopId));
  assert.throws(() => readBulletinSync(dataDir, workshopId));
  await assert.rejects(applyBulletinOps(dataDir, workshopId,
    [{ op: 'add', text: '不能覆盖' }], '测试者'));
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.rm(file);
  await fs.mkdir(file);
  await assert.rejects(readBulletin(dataDir, workshopId));
});

test('损坏历史会阻止公告变更，历史原文保持不变', async t => {
  const { dataDir, workshopId } = await temporaryData(t);
  const history = workshopBulletinHistoryFile(dataDir, workshopId);
  await fs.mkdir(path.dirname(history), { recursive: true });
  await fs.writeFile(history, '{broken');
  await assert.rejects(readBulletinHistory(dataDir, workshopId));
  await assert.rejects(applyBulletinOps(dataDir, workshopId,
    [{ op: 'add', text: '不能部分生效' }], '测试者'));
  assert.deepEqual(await readBulletin(dataDir, workshopId), { entries: [], updatedAt: 0 });
  assert.equal(await fs.readFile(history, 'utf8'), '{broken');
});

test('并发新增公告不丢条目或历史序号', async t => {
  const { dataDir, workshopId } = await temporaryData(t);
  const count = 12;
  await Promise.all(Array.from({ length: count }, (_, index) => applyBulletinOps(
    dataDir, workshopId, [{ op: 'add', text: `公告-${index}` }], '测试者',
  )));
  const board = await readBulletin(dataDir, workshopId);
  const history = await readBulletinHistory(dataDir, workshopId);
  assert.deepEqual(new Set(board.entries.map(entry => entry.text)),
    new Set(Array.from({ length: count }, (_, index) => `公告-${index}`)));
  assert.deepEqual(history.map(change => change.seq),
    Array.from({ length: count }, (_, index) => index + 1));
});

test('工位虚拟公告工具只允许读取和新增，旧 update/remove 调用被拒且人类操作仍可用', async t => {
  const { dataDir, workshopId } = await temporaryData(t);
  const added = await execBulletin(dataDir, workshopId, { action: 'add', text: '原公告' }, '工位');
  assert.equal(added.ok, true);
  const before = await readBulletin(dataDir, workshopId);
  const entryId = before.entries[0]?.id;
  assert.ok(entryId);
  assert.match((await execBulletin(dataDir, workshopId, { action: 'get' }, '工位')).result, /原公告/);

  for (const args of [
    { action: 'update', id: entryId, text: '篡改' },
    { action: 'remove', id: entryId },
  ]) {
    const denied = await execBulletin(dataDir, workshopId, args, '工位');
    assert.equal(denied.ok, false);
    assert.match(denied.result, /仅人类/);
    assert.deepEqual(await readBulletin(dataDir, workshopId), before);
    assert.equal((await readBulletinHistory(dataDir, workshopId)).length, 1);
  }

  const updated = await applyBulletinOps(dataDir, workshopId,
    [{ op: 'update', id: entryId, text: '人类修改' }], '人类');
  assert.equal(updated.entries[0]?.text, '人类修改');
  const removed = await applyBulletinOps(dataDir, workshopId,
    [{ op: 'remove', id: entryId }], '人类');
  assert.equal(removed.entries.length, 0);
  assert.deepEqual((await readBulletinHistory(dataDir, workshopId)).map(change => change.kind),
    ['add', 'update', 'remove']);
});

test('工位公告提示只教授 get/add 并说明改写和删除由人类执行', () => {
  const section = buildBulletinSection({ entries: [], updatedAt: 0 });
  assert.match(section, /get/);
  assert.match(section, /add/);
  assert.match(section, /改写和删除仅人类/);
  assert.doesNotMatch(section, /update\(id/);
  assert.doesNotMatch(section, /remove\(id/);
});

async function pendingFixture(t: TestContext) {
  const { dataDir, workshopId } = await temporaryData(t);
  const original = await applyBulletinOps(dataDir, workshopId,
    [{ op: 'add', text: '旧公告' }], '测试者');
  const oldHistory = await readBulletinHistory(dataDir, workshopId);
  const timestamp = Date.now() + 1;
  const board = { entries: [...original.entries, {
    id: 'b-recovery', text: '待恢复公告', author: '测试者', updatedAt: timestamp,
  }], updatedAt: timestamp };
  const changes = [...oldHistory, {
    seq: 2, ts: timestamp, actor: '测试者', kind: 'add' as const,
    entryId: 'b-recovery', before: null,
    after: { text: '待恢复公告', author: '测试者' },
  }];
  const pending = path.join(path.dirname(workshopBulletinFile(dataDir, workshopId)),
    'bulletin-pending.json');
  return { dataDir, workshopId, original, oldHistory, board, changes, pending };
}

async function writePending(fixture: Awaited<ReturnType<typeof pendingFixture>>): Promise<void> {
  await fs.writeFile(fixture.pending, JSON.stringify({
    version: 1,
    first: JSON.stringify(fixture.board, null, 2),
    second: JSON.stringify({ changes: fixture.changes }, null, 2),
  }));
}

test('pending 落盘前中断保持原公告和历史', async t => {
  const fixture = await pendingFixture(t);
  assert.deepEqual(await readBulletin(fixture.dataDir, fixture.workshopId), fixture.original);
  assert.deepEqual(await readBulletinHistory(fixture.dataDir, fixture.workshopId), fixture.oldHistory);
  await assert.rejects(fs.access(fixture.pending));
});

test('pending 已落但 board 未写时恢复两个正式文件', async t => {
  const fixture = await pendingFixture(t);
  await writePending(fixture);
  assert.deepEqual(readBulletinSync(fixture.dataDir, fixture.workshopId), fixture.board);
  assert.deepEqual(await readBulletin(fixture.dataDir, fixture.workshopId), fixture.board);
  assert.deepEqual(await readBulletinHistory(fixture.dataDir, fixture.workshopId), fixture.changes);
  await assert.rejects(fs.access(fixture.pending));
});

test('board 已写但 history 未写时恢复历史，且不重复公告', async t => {
  const fixture = await pendingFixture(t);
  await writePending(fixture);
  await fs.writeFile(workshopBulletinFile(fixture.dataDir, fixture.workshopId),
    JSON.stringify(fixture.board));
  assert.deepEqual(await readBulletinHistory(fixture.dataDir, fixture.workshopId), fixture.changes);
  assert.deepEqual(await readBulletin(fixture.dataDir, fixture.workshopId), fixture.board);
  await assert.rejects(fs.access(fixture.pending));
});

test('history 也已写时只需完成 pending 清理', async t => {
  const fixture = await pendingFixture(t);
  await writePending(fixture);
  await fs.writeFile(workshopBulletinFile(fixture.dataDir, fixture.workshopId),
    JSON.stringify(fixture.board));
  await fs.writeFile(workshopBulletinHistoryFile(fixture.dataDir, fixture.workshopId),
    JSON.stringify({ changes: fixture.changes }));
  assert.deepEqual(await readBulletin(fixture.dataDir, fixture.workshopId), fixture.board);
  assert.deepEqual(await readBulletinHistory(fixture.dataDir, fixture.workshopId), fixture.changes);
  await assert.rejects(fs.access(fixture.pending));
});

test('损坏 pending 必须报错并保留现有文件', async t => {
  const fixture = await pendingFixture(t);
  await fs.writeFile(fixture.pending, '{broken');
  await assert.rejects(readBulletin(fixture.dataDir, fixture.workshopId));
  assert.deepEqual(JSON.parse(await fs.readFile(
    workshopBulletinFile(fixture.dataDir, fixture.workshopId), 'utf8')),
  fixture.original);
  assert.equal(await fs.readFile(fixture.pending, 'utf8'), '{broken');
});
