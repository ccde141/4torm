import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { roomFile, roomReasoningDir, roomReasoningFile } from './paths.js';
import { createRoom, deleteRoom, loadRoom, saveRoom } from './room-store.js';
import { createWorkshop } from './workshop-store.js';

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
  assert.equal(raw.publicMessages[0].reasoningRef, 'msg-a');
  assert.equal(
    await fs.readFile(roomReasoningFile(dataDir, workshop.id, room.id, 'msg-a'), 'utf8'),
    '很长的私有思考',
  );
  const loaded = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(loaded?.publicMessages[0].reasoning, '很长的私有思考');
  const reasoningFile = roomReasoningFile(dataDir, workshop.id, room.id, 'msg-a');
  const fixedTime = new Date('2020-01-01T00:00:00.000Z');
  await fs.utimes(reasoningFile, fixedTime, fixedTime);
  await saveRoom(dataDir, workshop.id, loaded!);
  assert.equal((await fs.stat(reasoningFile)).mtime.toISOString(), fixedTime.toISOString());

  room.publicMessages = [];
  await saveRoom(dataDir, workshop.id, room);
  await assert.rejects(
    () => fs.access(roomReasoningFile(dataDir, workshop.id, room.id, 'msg-a')),
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
  await fs.rm(roomReasoningFile(dataDir, workshop.id, room.id, 'msg-a'));

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
  await fs.writeFile(
    roomReasoningFile(dataDir, workshop.id, room.id, 'msg-a'),
    '已经损坏的内容',
    'utf8',
  );

  const loaded = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(loaded?.publicMessages[0].content, '可信正文');
  assert.equal(loaded?.publicMessages[0].reasoning, undefined);
});
