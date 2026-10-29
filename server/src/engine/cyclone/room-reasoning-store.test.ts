import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { roomFile, roomReasoningDir, roomReasoningFile } from './paths.js';
import { createRoom, deleteRoom, loadRoom, saveRoom } from './room-store.js';
import { createWorkshop } from './workshop-store.js';

test('compaction display history retains external reasoning through cleanup and reload without reentering model history', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-display-reasoning-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const room = await createRoom(dataDir, workshop.id, { title: '连续讨论' });
  room.publicDisplayHistory = { messages: [{ id: 'old', speaker: '研究员', content: 'old evidence',
    timestamp: 1, reasoning: '完整旧思考' }], contextOffset: 1 };
  room.publicMessages = [{ speaker: '系统', content: 'summary', timestamp: 2 }];
  await saveRoom(dataDir, workshop.id, room);
  const loaded = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(loaded?.publicDisplayHistory?.messages[0].reasoning, '完整旧思考');
  assert.deepEqual(loaded?.publicMessages.map(message => message.content), ['summary']);
  await saveRoom(dataDir, workshop.id, loaded!);
  assert.equal((await loadRoom(dataDir, workshop.id, room.id))?.publicDisplayHistory?.messages[0].reasoning, '完整旧思考');
});

test('新群聊思考外置存储，加载时透明恢复', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-reasoning-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const room = await createRoom(dataDir, workshop.id, { title: '长期会议' });
  room.publicMessages.push({
    id: 'msg-a', speaker: '研究员', content: '结论', timestamp: Date.now(),
    reasoning: '很长的私有思考',
  });

  await saveRoom(dataDir, workshop.id, room);

  const raw = JSON.parse(await fs.readFile(roomFile(dataDir, workshop.id, room.id), 'utf8'));
  assert.equal(raw.publicMessages[0].reasoning, undefined);
  assert.match(raw.publicMessages[0].reasoningRef, /^msg-a\.[a-f0-9]{64}$/);
  assert.equal(
    await fs.readFile(roomReasoningFile(dataDir, workshop.id, room.id, raw.publicMessages[0].reasoningRef), 'utf8'),
    '很长的私有思考',
  );
  const loaded = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(loaded?.publicMessages[0].reasoning, '很长的私有思考');
  const reasoningFile = roomReasoningFile(dataDir, workshop.id, room.id, raw.publicMessages[0].reasoningRef);
  const fixedTime = new Date('2020-01-01T00:00:00.000Z');
  await fs.utimes(reasoningFile, fixedTime, fixedTime);
  await saveRoom(dataDir, workshop.id, loaded!);
  assert.equal((await fs.stat(reasoningFile)).mtime.toISOString(), fixedTime.toISOString());

  room.publicMessages = [];
  await saveRoom(dataDir, workshop.id, room);
  await assert.rejects(
    () => fs.access(reasoningFile),
    { code: 'ENOENT' },
  );

  await deleteRoom(dataDir, workshop.id, room.id);
  await assert.rejects(() => fs.access(roomReasoningDir(dataDir, workshop.id, room.id)), { code: 'ENOENT' });
});

test('旧版内联思考可读，并在下次保存时迁移到外置文件', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-reasoning-legacy-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const room = await createRoom(dataDir, workshop.id, { title: '旧会议' });
  room.publicMessages.push({
    speaker: '研究员', content: '旧结论', timestamp: Date.now(), reasoning: '旧版内联思考',
  });
  await fs.writeFile(roomFile(dataDir, workshop.id, room.id), JSON.stringify(room), 'utf8');

  const legacy = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(legacy?.publicMessages[0].reasoning, '旧版内联思考');
  await saveRoom(dataDir, workshop.id, legacy!);

  const raw = JSON.parse(await fs.readFile(roomFile(dataDir, workshop.id, room.id), 'utf8'));
  assert.equal(raw.publicMessages[0].reasoning, undefined);
  assert.match(raw.publicMessages[0].reasoningRef, /^msg-/);
  assert.equal((await loadRoom(dataDir, workshop.id, room.id))?.publicMessages[0].reasoning, '旧版内联思考');
});

test('思考外置文件缺失时仍能加载群聊主体', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-reasoning-missing-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const room = await createRoom(dataDir, workshop.id, { title: '长期会议' });
  room.publicMessages.push({
    id: 'msg-a', speaker: '研究员', content: '仍可见的结论', timestamp: Date.now(), reasoning: '会丢失的思考',
  });
  await saveRoom(dataDir, workshop.id, room);
  const raw = JSON.parse(await fs.readFile(roomFile(dataDir, workshop.id, room.id), 'utf8'));
  await fs.rm(roomReasoningFile(dataDir, workshop.id, room.id, raw.publicMessages[0].reasoningRef));

  const loaded = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(loaded?.publicMessages[0].content, '仍可见的结论');
  assert.equal(loaded?.publicMessages[0].reasoning, undefined);
});

test('思考外置文件内容损坏时不把脏数据展示为真实思考', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-reasoning-corrupt-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const room = await createRoom(dataDir, workshop.id, { title: '长期会议' });
  room.publicMessages.push({
    id: 'msg-a', speaker: '研究员', content: '可信正文', timestamp: Date.now(), reasoning: '真实思考',
  });
  await saveRoom(dataDir, workshop.id, room);
  const raw = JSON.parse(await fs.readFile(roomFile(dataDir, workshop.id, room.id), 'utf8'));
  await fs.writeFile(
    roomReasoningFile(dataDir, workshop.id, room.id, raw.publicMessages[0].reasoningRef),
    '已经损坏的内容',
    'utf8',
  );

  const loaded = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(loaded?.publicMessages[0].content, '可信正文');
  assert.equal(loaded?.publicMessages[0].reasoning, undefined);
});

test('same-room saves serialize sidecar replacement, primary commit and cleanup without blocking another room', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-save-serial-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '保存隔离' });
  const room = await createRoom(dataDir, workshop.id);
  const other = await createRoom(dataDir, workshop.id);
  room.publicMessages = [{ id: 'first', speaker: '成员', content: '第一份保存', timestamp: 1, reasoning: '完整思考' }];
  const second = { ...room, publicMessages: [] };
  other.publicMessages = [{ id: 'independent', speaker: '成员', content: '独立房间', timestamp: 1, reasoning: '独立思考' }];
  const reasoningDir = roomReasoningDir(dataDir, workshop.id, room.id);
  const primary = roomFile(dataDir, workshop.id, room.id);
  let release!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const rename = fs.rename;
  let sameRoomPrimaryEntered = false;
  t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => {
    if (path.dirname(String(target)) === reasoningDir) { entered(); await gate; }
    if (String(target) === primary) sameRoomPrimaryEntered = true;
    return rename(source, target);
  });
  const firstSave = saveRoom(dataDir, workshop.id, room);
  await paused;
  let secondSettled = false;
  const secondSave = saveRoom(dataDir, workshop.id, second).finally(() => { secondSettled = true; });
  const completed = Promise.allSettled([firstSave, secondSave]);
  try {
    await saveRoom(dataDir, workshop.id, other);
    assert.equal(secondSettled, false, 'the second room save must wait through sidecar replacement');
    assert.equal(sameRoomPrimaryEntered, false, 'a concurrent primary write cannot bypass the room transaction');
    assert.equal((await loadRoom(dataDir, workshop.id, other.id))?.publicMessages[0].reasoning, '独立思考');
  } finally {
    release();
    await completed;
  }
  assert.deepEqual((await completed).map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.deepEqual((await loadRoom(dataDir, workshop.id, room.id))?.publicMessages, []);
  assert.deepEqual(await fs.readdir(roomReasoningDir(dataDir, workshop.id, room.id)), []);
});

test('a failed room commit rejects its caller while the next queued save can commit and clean obsolete sidecars', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-save-recovery-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '失败接续' });
  const room = await createRoom(dataDir, workshop.id);
  const first = { ...room, publicMessages: [{ id: 'failed', speaker: '成员', content: '未提交正文', timestamp: 1, reasoning: '未提交思考' }] };
  const second = { ...room, publicMessages: [{ id: 'saved', speaker: '成员', content: '最终正文', timestamp: 2, reasoning: '最终思考' }] };
  const primary = roomFile(dataDir, workshop.id, room.id);
  const rename = fs.rename;
  let failed = false;
  t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => {
    if (String(target) === primary && !failed) {
      failed = true;
      throw Object.assign(new Error('injected primary failure'), { code: 'EIO' });
    }
    return rename(source, target);
  });
  const [before, after] = await Promise.allSettled([
    saveRoom(dataDir, workshop.id, first), saveRoom(dataDir, workshop.id, second),
  ]);
  assert.equal(before.status, 'rejected');
  if (before.status === 'rejected') assert.equal(before.reason.code, 'EIO');
  assert.equal(after.status, 'fulfilled');
  const loaded = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(loaded?.publicMessages[0].content, '最终正文');
  assert.equal(loaded?.publicMessages[0].reasoning, '最终思考');
  assert.deepEqual(await fs.readdir(roomReasoningDir(dataDir, workshop.id, room.id)),
    [path.basename(roomReasoningFile(dataDir, workshop.id, room.id, loaded!.publicMessages[0].reasoningRef!))]);
});

test('same-ID reasoning changes cannot damage a legacy committed reference when the new primary fails', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-versioned-reasoning-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '恢复原文' });
  const room = await createRoom(dataDir, workshop.id);
  const primary = roomFile(dataDir, workshop.id, room.id);
  const legacyFile = roomReasoningFile(dataDir, workshop.id, room.id, 'same-turn');
  room.publicMessages = [{ id: 'same-turn', speaker: '成员', content: '旧正文', timestamp: 1,
    reasoningRef: 'same-turn', reasoningHash: createHash('sha256').update('旧思考').digest('hex') }];
  await fs.mkdir(roomReasoningDir(dataDir, workshop.id, room.id), { recursive: true });
  await fs.writeFile(legacyFile, '旧思考');
  await fs.writeFile(primary, JSON.stringify(room));
  const loaded = (await loadRoom(dataDir, workshop.id, room.id))!;
  await saveRoom(dataDir, workshop.id, loaded);
  assert.equal((await loadRoom(dataDir, workshop.id, room.id))?.publicMessages[0].reasoningRef, 'same-turn');
  loaded.publicMessages[0].content = '新正文';
  loaded.publicMessages[0].reasoning = '旧思考与后续新增的思考';
  const rename = fs.rename;
  let failed = false;
  t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => {
    if (String(target) === primary && !failed) {
      failed = true;
      throw Object.assign(new Error('injected primary failure'), { code: 'EIO' });
    }
    return rename(source, target);
  });
  await assert.rejects(saveRoom(dataDir, workshop.id, loaded), { code: 'EIO' });
  const preserved = (await loadRoom(dataDir, workshop.id, room.id))!;
  assert.equal(preserved.publicMessages[0].content, '旧正文');
  assert.equal(preserved.publicMessages[0].reasoning, '旧思考');
  assert.equal(await fs.readFile(legacyFile, 'utf8'), '旧思考');
  await saveRoom(dataDir, workshop.id, loaded);
  const committed = (await loadRoom(dataDir, workshop.id, room.id))!;
  assert.equal(committed.publicMessages[0].content, '新正文');
  assert.equal(committed.publicMessages[0].reasoning, '旧思考与后续新增的思考');
  assert.notEqual(committed.publicMessages[0].reasoningRef, 'same-turn');
  await assert.rejects(fs.access(legacyFile), { code: 'ENOENT' });
});

test('room reads finish hydrating their committed reasoning before a queued save cleans its old reference', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-read-serial-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '读取隔离' });
  const room = await createRoom(dataDir, workshop.id);
  const other = await createRoom(dataDir, workshop.id);
  room.publicMessages = [{ id: 'same-turn', speaker: '成员', content: '已提交正文', timestamp: 1, reasoning: '已提交思考' }];
  await saveRoom(dataDir, workshop.id, room);
  const next = structuredClone(room);
  next.publicMessages[0].content = '下一版正文'; next.publicMessages[0].reasoning = '下一版思考';
  const primary = roomFile(dataDir, workshop.id, room.id);
  const readFile = fs.readFile, rename = fs.rename;
  let release!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let readStarted = false, writeEntered = false;
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    const contents = await readFile(...args);
    if (String(args[0]) === primary && !readStarted) { readStarted = true; entered(); await gate; }
    return contents;
  });
  t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => {
    if (String(target) === primary) writeEntered = true;
    return rename(source, target);
  });
  const pendingRead = loadRoom(dataDir, workshop.id, room.id);
  await paused;
  const pendingWrite = saveRoom(dataDir, workshop.id, next);
  const finished = Promise.allSettled([pendingRead, pendingWrite]);
  try {
    await saveRoom(dataDir, workshop.id, other);
    assert.equal(writeEntered, false, 'same-room cleanup cannot pass a reader holding the old primary');
  } finally { release(); await finished; }
  const old = await pendingRead;
  assert.equal(old?.publicMessages[0].content, '已提交正文');
  assert.equal(old?.publicMessages[0].reasoning, '已提交思考');
  const current = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(current?.publicMessages[0].content, '下一版正文');
  assert.equal(current?.publicMessages[0].reasoning, '下一版思考');
});
