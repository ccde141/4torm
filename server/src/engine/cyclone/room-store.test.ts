import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch, listWorkshopDispatches, updateDispatch } from './dispatch-store.js';
import { addSeat, loadSeat } from './seat-store.js';
import {
  createRoom, deleteRoom, joinRoom, leaveRoom, loadRoom, RoomSettingsConflictError,
  setRoomParticipants, setRoomTopic,
} from './room-store.js';
import { createWorkshop, loadWorkshop } from './workshop-store.js';

async function createRoomDispatch(dataDir: string, workshopId: string, roomId: string) {
  return createDispatch(dataDir, {
    workshopId, sourceRoomId: roomId, sourceSeatId: 'source-seat',
    sourceSeatTitle: '来源工位', sourceTurnId: 'turn-1', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'target-seat', targetSeatTitle: '目标工位', task: '测试任务',
  });
}

test('删除群聊同步移除历史、工作室索引与终态派发', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-delete-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const deletedRoom = await createRoom(dataDir, workshop.id, { title: '待删除' });
  const keptRoom = await createRoom(dataDir, workshop.id, { title: '保留' });
  const deletedDispatch = await createRoomDispatch(dataDir, workshop.id, deletedRoom.id);
  const keptDispatch = await createRoomDispatch(dataDir, workshop.id, keptRoom.id);
  await updateDispatch(dataDir, workshop.id, deletedDispatch.id, { status: 'completed' });
  await updateDispatch(dataDir, workshop.id, keptDispatch.id, { status: 'completed' });

  assert.equal(await deleteRoom(dataDir, workshop.id, deletedRoom.id), true);
  assert.equal(await loadRoom(dataDir, workshop.id, deletedRoom.id), null);
  assert.deepEqual((await loadWorkshop(dataDir, workshop.id))?.roomIds, [keptRoom.id]);
  assert.deepEqual((await listWorkshopDispatches(dataDir, workshop.id)).map(item => item.id), [keptDispatch.id]);
});

test('群聊仍有活动派发时拒绝删除并保留全部数据', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-delete-active-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const room = await createRoom(dataDir, workshop.id, { title: '运行中' });
  await createRoomDispatch(dataDir, workshop.id, room.id);

  await assert.rejects(() => deleteRoom(dataDir, workshop.id, room.id), /异步派发仍在处理中/);
  assert.equal((await loadRoom(dataDir, workshop.id, room.id))?.title, '运行中');
  assert.deepEqual((await loadWorkshop(dataDir, workshop.id))?.roomIds, [room.id]);
});

test('重复删除不存在的群聊返回未删除而不是伪装成功', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-delete-missing-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });

  assert.equal(await deleteRoom(dataDir, workshop.id, 'missing-room'), false);
});

test('工位入会与离会写入可追溯记录且保持幂等', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-membership-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '研究员' });
  const room = await createRoom(dataDir, workshop.id, { title: '长期会议' });

  await joinRoom(dataDir, workshop.id, room.id, seat.id);
  await joinRoom(dataDir, workshop.id, room.id, seat.id);
  let saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.deepEqual(saved?.participantSeatIds, [seat.id]);
  assert.deepEqual(saved?.publicMessages, [{
    speaker: '系统', content: '研究员加入会议', kind: 'membership',
    seatId: seat.id, membershipAction: 'joined', timestamp: saved?.publicMessages[0].timestamp,
  }]);

  await leaveRoom(dataDir, workshop.id, room.id, seat.id);
  await leaveRoom(dataDir, workshop.id, room.id, seat.id);
  saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.deepEqual(saved?.participantSeatIds, []);
  assert.equal(saved?.publicMessages.at(-1)?.content, '研究员离开会议');
  assert.equal(saved?.publicMessages.at(-1)?.membershipAction, 'left');
  assert.equal((await loadSeat(dataDir, workshop.id, seat.id))?.title, '研究员');
});

test('活跃异步派发期间拒绝修改群聊设置', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-settings-active-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '研究员' });
  const room = await createRoom(dataDir, workshop.id, { title: '运行中' });
  await createRoomDispatch(dataDir, workshop.id, room.id);

  await assert.rejects(
    () => joinRoom(dataDir, workshop.id, room.id, seat.id),
    (error: unknown) => error instanceof RoomSettingsConflictError,
  );
  assert.deepEqual((await loadRoom(dataDir, workshop.id, room.id))?.participantSeatIds, []);
});

test('完整成员列表入口不会绕过入离会记录', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-participants-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const first = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '研究员' });
  const second = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '记录员' });
  const room = await createRoom(dataDir, workshop.id, { title: '长期会议' });

  await setRoomParticipants(dataDir, workshop.id, room.id, [first.id, second.id]);
  await setRoomParticipants(dataDir, workshop.id, room.id, [second.id]);

  const saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.deepEqual(saved?.publicMessages.map(message => ({
    seatId: message.seatId,
    action: message.membershipAction,
  })), [
    { seatId: first.id, action: 'joined' },
    { seatId: second.id, action: 'joined' },
    { seatId: first.id, action: 'left' },
  ]);
});

test('群聊话题通过设置锁持久化', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-topic-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const room = await createRoom(dataDir, workshop.id, { title: '长期会议', topic: '旧话题' });

  await setRoomTopic(dataDir, workshop.id, room.id, '  新话题  ');

  assert.equal((await loadRoom(dataDir, workshop.id, room.id))?.topic, '新话题');
});

test('建群时的初始工位同样写入成员时间线', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-founders-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const first = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '研究员' });
  const second = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '记录员' });

  const room = await createRoom(dataDir, workshop.id, {
    title: '新会议', participantSeatIds: [first.id, second.id],
  });

  assert.deepEqual(room.publicMessages.map(message => ({
    seatId: message.seatId,
    action: message.membershipAction,
  })), [
    { seatId: first.id, action: 'joined' },
    { seatId: second.id, action: 'joined' },
  ]);
});
