import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { COLLABORATION_PERMISSIONS, type CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { loadRoom, saveRoom } from '../../../engine/cyclone/room-store.js';
import type { RoomMessage } from '../../../engine/cyclone/types.js';
import { createCycloneFeature } from './factory.js';

const human: CollaborationContext = {
  actor: { type: 'human', id: 'local-human', actingAs: 'human' },
  audience: 'human', enabledFeatures: new Set(['cyclone']),
  permissions: new Set(COLLABORATION_PERMISSIONS), requestId: 'room-message-cas',
};

async function fixture(t: TestContext, messages: RoomMessage[]) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-room-message-cas-'));
  const feature = createCycloneFeature({ dataDir });
  t.after(async () => { feature.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const router = new CollaborationRouter([feature.module]);
  const workshop = await feature.workshops.create({});
  const room = await feature.rooms.create({ workshopId: workshop.id });
  room.publicMessages = messages;
  await saveRoom(dataDir, workshop.id, room);
  const base = { workshopId: workshop.id, roomId: room.id };
  const invoke = (method: 'editRoomMessage' | 'deleteRoomMessage', input: Record<string, unknown>) => (
    router.invoke({ feature: 'cyclone', method, input: { ...base, ...input } }, human)
  );
  const read = async () => (await loadRoom(dataDir, workshop.id, room.id))!.publicMessages;
  return { invoke, read };
}

function message(content: string, timestamp: number, id?: string): RoomMessage {
  return { ...(id ? { id } : {}), speaker: '人类', content, timestamp };
}

function hasCode(code: string, kind: string) {
  return (error: unknown) => {
    assert.deepEqual((error as { data?: { code: string; kind: string } }).data?.code, code);
    assert.equal((error as { data?: { kind: string } }).data?.kind, kind);
    return true;
  };
}

test('消息 index 因前一条被删而漂移时，带 id 的删除与无 id 的编辑都拒绝', async t => {
  const withIds = await fixture(t, [message('甲', 1, 'msg-a'), message('乙', 2, 'msg-b'), message('丙', 3, 'msg-c')]);
  await withIds.invoke('deleteRoomMessage', { index: 0 });
  await assert.rejects(withIds.invoke('deleteRoomMessage', {
    index: 1, expectedMessage: message('乙', 2, 'msg-b'),
  }), hasCode('CYCLONE_ROOM_MESSAGE_CONFLICT', 'conflict'));
  assert.deepEqual((await withIds.read()).map(item => item.content), ['乙', '丙']);

  const legacy = await fixture(t, [message('甲', 1), message('乙', 2), message('丙', 3)]);
  await legacy.invoke('deleteRoomMessage', { index: 0 });
  await assert.rejects(legacy.invoke('editRoomMessage', {
    index: 1, content: '误改', expectedMessage: message('乙', 2),
  }), hasCode('CYCLONE_ROOM_MESSAGE_CONFLICT', 'conflict'));
  assert.deepEqual((await legacy.read()).map(item => item.content), ['乙', '丙']);
});

test('同一消息已被另一窗口编辑后，旧正文不能再次覆盖或删除', async t => {
  const old = message('原文', 1, 'msg-a');
  const { invoke, read } = await fixture(t, [old]);
  await invoke('editRoomMessage', { index: 0, content: '先改', expectedMessage: old });
  for (const method of ['editRoomMessage', 'deleteRoomMessage'] as const) {
    await assert.rejects(invoke(method, {
      index: 0, ...(method === 'editRoomMessage' ? { content: '后改' } : {}), expectedMessage: old,
    }), hasCode('CYCLONE_ROOM_MESSAGE_CONFLICT', 'conflict'));
  }
  assert.equal((await read())[0]?.content, '先改');
});

test('有 id 时仍校验时间与发言者；无 id 的重复身份拒绝歧义操作', async t => {
  const stable = message('原文', 1, 'msg-a');
  const byId = await fixture(t, [stable]);
  for (const expectedMessage of [
    { ...stable, timestamp: 2 }, { ...stable, speaker: '另一位' },
  ]) {
    await assert.rejects(byId.invoke('deleteRoomMessage', {
      index: 0, expectedMessage,
    }), hasCode('CYCLONE_ROOM_MESSAGE_CONFLICT', 'conflict'));
  }
  assert.equal((await byId.read()).length, 1);

  const duplicate = message('同文', 1);
  const legacy = await fixture(t, [duplicate, duplicate]);
  await assert.rejects(legacy.invoke('deleteRoomMessage', {
    index: 0, expectedMessage: duplicate,
  }), hasCode('CYCLONE_ROOM_MESSAGE_CONFLICT', 'conflict'));
  assert.equal((await legacy.read()).length, 2);
});

test('身份字段必须完整有效；新版校验成功后，旧版 index 请求仍可调用', async t => {
  const original = message('原文', 1);
  const { invoke, read } = await fixture(t, [original, message('另一条', 2, 'msg-b')]);
  await assert.rejects(invoke('editRoomMessage', {
    index: 0, content: '新文', expectedMessage: { speaker: '人类', content: '原文' },
  }), hasCode('CYCLONE_ROOM_INPUT_INVALID', 'validation'));
  await assert.rejects(invoke('deleteRoomMessage', {
    index: 0, expectedMessage: { ...original, extra: true },
  }), hasCode('CYCLONE_ROOM_INPUT_INVALID', 'validation'));
  await assert.rejects(invoke('deleteRoomMessage', {
    index: 5, expectedMessage: original,
  }), hasCode('CYCLONE_ROOM_MESSAGE_CONFLICT', 'conflict'));
  await invoke('editRoomMessage', { index: 0, content: '新文', expectedMessage: original });
  await invoke('deleteRoomMessage', { index: 1, expectedMessage: message('另一条', 2, 'msg-b') });
  await invoke('deleteRoomMessage', { index: 0 });
  assert.deepEqual(await read(), []);
});
