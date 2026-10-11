import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCycloneSeat,
  createCycloneRoom,
  createCycloneWorkshop,
  deleteCycloneRoom,
  deleteCyclonePrivateMessage,
  deleteCycloneRoomMessage,
  deleteCycloneSeat,
  deleteCycloneWorkshop,
  generateCycloneSeatDuty,
  editCyclonePrivateMessage,
  editCycloneRoomMessage,
  joinCycloneRoom,
  leaveCycloneRoom,
  mutateCycloneBulletin,
  openCycloneWorkspace,
  renameCycloneRoom,
  renameCycloneWorkshop,
  reorderCycloneRoom,
  resetCyclonePrivateContext,
  resetCycloneRoomContext,
  compactCyclonePrivateContext,
  compactCycloneRoomContext,
  revertCycloneBulletin,
  setCycloneChair,
  setCycloneRoomMode,
  setCycloneRoomTopic,
  updateCycloneSeat,
} from './cyclone-control-client.js';

test('manual compact uses full-summary central ports for seats, chairs and public rooms', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/collaboration/invoke');
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ ok: true });
  };
  try {
    await compactCyclonePrivateContext('w', { kind: 'seat', seatId: 's' });
    await compactCyclonePrivateContext('w', { kind: 'chair', roomId: 'r' });
    await compactCycloneRoomContext('w', 'r');
    assert.deepEqual(calls.map(call => [call.method, call.input]), [
      ['compactSeatContext', { workshopId: 'w', seatId: 's' }],
      ['compactChairContext', { workshopId: 'w', roomId: 'r' }],
      ['compactRoomContext', { workshopId: 'w', roomId: 'r', scope: 'public' }],
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test('气旋主页生命周期动作只通过中心协作入口', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/collaboration/invoke');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.method === 'createWorkshop') return Response.json({ id: 'workshop-1', title: '组' });
    if (body.method === 'addWorkshopSeat') return Response.json({ id: 'seat-1', title: '工位' });
    if (body.method === 'updateSeatRole') return Response.json({ id: 'seat-1', title: '新工位' });
    if (body.method === 'createRoom') return Response.json({ id: 'room-1', title: '群聊' });
    if (body.method === 'openWorkshopWorkspace') return Response.json({ ok: true, path: 'workspace' });
    if (body.method === 'generateSeatDuty') return Response.json({ duty: '复核边界' });
    return Response.json({ ok: true });
  };
  try {
    await createCycloneWorkshop({ title: '组' });
    await setCycloneChair('workshop-1', 'agent-a');
    await addCycloneSeat('workshop-1', { agentId: 'agent-a', title: '工位' });
    await updateCycloneSeat('workshop-1', 'seat-1', { title: '新工位' });
    const roomDraft = {
      title: '群聊', topic: '主题', mode: 'build', participantSeatIds: ['seat-1'],
      intros: [{ seatId: 'seat-1', content: '前端专用开场白' }],
    } as const;
    await createCycloneRoom('workshop-1', roomDraft);
    await openCycloneWorkspace('workshop-1');
    await deleteCycloneRoom('workshop-1', 'room-1');
    await deleteCycloneSeat('workshop-1', 'seat-1');
    await deleteCycloneWorkshop('workshop-1');
    await renameCycloneWorkshop('workshop-1', '新名称');
    await generateCycloneSeatDuty('agent-a', '工位', '检查');
    await mutateCycloneBulletin('workshop-1', [{ op: 'add', text: '进展' }]);
    await revertCycloneBulletin('workshop-1', 1);
    await joinCycloneRoom('workshop-1', 'room-1', 'seat-1');
    await leaveCycloneRoom('workshop-1', 'room-1', 'seat-1');
    await reorderCycloneRoom('workshop-1', 'room-1', ['seat-1']);
    await renameCycloneRoom('workshop-1', 'room-1', '新群聊');
    await setCycloneRoomTopic('workshop-1', 'room-1', '新主题');
    await setCycloneRoomMode('workshop-1', 'room-1', 'plan');
    await editCyclonePrivateMessage(
      'workshop-1', { kind: 'seat', seatId: 'seat-1' }, 2, '新消息',
    );
    await deleteCyclonePrivateMessage(
      'workshop-1', { kind: 'chair', roomId: 'room-1' }, 3,
    );
    await resetCyclonePrivateContext(
      'workshop-1', { kind: 'seat', seatId: 'seat-1' }, 'summary', true,
    );
    await editCycloneRoomMessage('workshop-1', 'room-1', 4, '群聊消息');
    await deleteCycloneRoomMessage('workshop-1', 'room-1', 5);
    await resetCycloneRoomContext('workshop-1', 'room-1', 'clear', 'both');
    assert.deepEqual(calls.map(call => call.method), [
      'createWorkshop', 'setWorkshopChair', 'addWorkshopSeat', 'updateSeatRole',
      'createRoom', 'openWorkshopWorkspace', 'deleteRoom', 'deleteSeat', 'deleteWorkshop',
      'renameWorkshop', 'generateSeatDuty', 'mutateWorkshopBulletin',
      'revertWorkshopBulletin', 'joinRoom', 'leaveRoom', 'setRoomParticipants',
      'renameRoom', 'setRoomTopic', 'setRoomMode',
      'editSeatMessage', 'deleteChairMessage', 'resetSeatContext',
      'editRoomMessage', 'deleteRoomMessage', 'resetRoomContext',
    ]);
    assert.ok(calls.every(call => call.feature === 'cyclone'));
    assert.deepEqual(calls[4]?.input, {
      workshopId: 'workshop-1',
      title: '群聊',
      topic: '主题',
      mode: 'build',
      participantSeatIds: ['seat-1'],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('群聊消息修改把原消息身份交给统一入口做并发校验', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  const expected = { id: 'msg-1', timestamp: 12, speaker: '人类', content: '原文' };
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ ok: true });
  };
  try {
    await editCycloneRoomMessage('workshop-1', 'room-1', 0, '新文', expected);
    await deleteCycloneRoomMessage('workshop-1', 'room-1', 0, expected);
    assert.deepEqual((calls[0]?.input as Record<string, unknown>).expectedMessage, expected);
    assert.deepEqual((calls[1]?.input as Record<string, unknown>).expectedMessage, expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
