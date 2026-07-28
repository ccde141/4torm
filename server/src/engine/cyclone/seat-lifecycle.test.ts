import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch } from './dispatch-store.js';
import { createRoom, loadRoom, saveRoom } from './room-store.js';
import { deleteSeatFromWorkshop } from './seat-lifecycle.js';
import { addSeat, deleteSeat, loadSeat } from './seat-store.js';
import { createWorkshop } from './workshop-store.js';

test('删除工位会退出全部会议并保留既有会话记录', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-delete-rooms-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '研究员' });
  const first = await createRoom(dataDir, workshop.id, {
    title: '第一会议', participantSeatIds: [seat.id],
  });
  const second = await createRoom(dataDir, workshop.id, {
    title: '第二会议', participantSeatIds: [seat.id],
  });
  const untouched = await createRoom(dataDir, workshop.id, { title: '无关会议' });
  first.publicMessages.push({
    speaker: seat.title, seatId: seat.id, content: '保留这条历史结论', timestamp: 1,
  });
  second.publicMessages.push({
    speaker: seat.title, seatId: seat.id, content: '保留另一条历史结论', timestamp: 2,
  });
  await saveRoom(dataDir, workshop.id, first);
  await saveRoom(dataDir, workshop.id, second);
  const firstHistory = structuredClone(first.publicMessages);
  const secondHistory = structuredClone(second.publicMessages);

  await deleteSeatFromWorkshop(dataDir, workshop.id, seat.id);

  const savedFirst = await loadRoom(dataDir, workshop.id, first.id);
  const savedSecond = await loadRoom(dataDir, workshop.id, second.id);
  assert.deepEqual(savedFirst?.participantSeatIds, []);
  assert.deepEqual(savedSecond?.participantSeatIds, []);
  assert.deepEqual(savedFirst?.publicMessages.slice(0, -1), firstHistory);
  assert.deepEqual(savedSecond?.publicMessages.slice(0, -1), secondHistory);
  assert.deepEqual(savedFirst?.publicMessages.at(-1), {
    speaker: '系统', content: '研究员离开会议', kind: 'membership', seatId: seat.id,
    membershipAction: 'left', timestamp: savedFirst?.publicMessages.at(-1)?.timestamp,
  });
  assert.equal(savedSecond?.publicMessages.at(-1)?.content, '研究员离开会议');
  assert.deepEqual(await loadRoom(dataDir, workshop.id, untouched.id), untouched);
  assert.equal(await loadSeat(dataDir, workshop.id, seat.id), null);
});

test('相关会议仍有活跃派发时整笔拒绝删除工位', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-delete-active-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '研究员' });
  const first = await createRoom(dataDir, workshop.id, {
    title: '第一会议', participantSeatIds: [seat.id],
  });
  const second = await createRoom(dataDir, workshop.id, {
    title: '第二会议', participantSeatIds: [seat.id],
  });
  await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: second.id, sourceSeatId: seat.id,
    sourceSeatTitle: seat.title, sourceTurnId: 'turn-1', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: seat.id, targetSeatTitle: seat.title, task: '仍在处理',
  });

  await assert.rejects(
    () => deleteSeatFromWorkshop(dataDir, workshop.id, seat.id),
    /异步派发仍在处理中/,
  );

  assert.equal((await loadSeat(dataDir, workshop.id, seat.id))?.title, seat.title);
  assert.deepEqual(await loadRoom(dataDir, workshop.id, first.id), first);
  assert.deepEqual(await loadRoom(dataDir, workshop.id, second.id), second);
});

test('旧数据中的悬空成员可按历史名称幂等清理', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-delete-stale-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '研究员' });
  const room = await createRoom(dataDir, workshop.id, {
    title: '旧会议', participantSeatIds: [seat.id],
  });
  await deleteSeat(dataDir, workshop.id, seat.id);
  const history = structuredClone(room.publicMessages);

  await deleteSeatFromWorkshop(dataDir, workshop.id, seat.id);
  await deleteSeatFromWorkshop(dataDir, workshop.id, seat.id);

  const saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.deepEqual(saved?.participantSeatIds, []);
  assert.deepEqual(saved?.publicMessages.slice(0, -1), history);
  assert.equal(saved?.publicMessages.at(-1)?.content, '研究员离开会议');
  assert.equal(saved?.publicMessages.filter(message => (
    message.seatId === seat.id && message.membershipAction === 'left'
  )).length, 1);
});

test('工位私聊派发仍活跃时拒绝删除来源或目标工位', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-delete-dispatch-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const source = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '研究员' });
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '执行员' });
  await createDispatch(dataDir, {
    workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '',
    sourceSeatId: source.id, sourceSeatTitle: source.title, sourceTurnId: 'turn-1',
    sourceRoundSeq: 0, dispatchOrder: 0, targetSeatId: target.id,
    targetSeatTitle: target.title, task: '仍在处理', receiptState: 'pending',
  });

  await assert.rejects(
    () => deleteSeatFromWorkshop(dataDir, workshop.id, target.id),
    /异步派发仍在处理中/,
  );
  await assert.rejects(
    () => deleteSeatFromWorkshop(dataDir, workshop.id, source.id),
    /异步派发仍在处理中/,
  );
  assert.equal((await loadSeat(dataDir, workshop.id, source.id))?.title, source.title);
  assert.equal((await loadSeat(dataDir, workshop.id, target.id))?.title, target.title);
});
