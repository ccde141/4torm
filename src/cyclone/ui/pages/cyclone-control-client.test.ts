import assert from 'node:assert/strict';
import test from 'node:test';
import { configureSupervisor, loadSupervisorTaskboard, reconcileSupervisorTaskboard, saveSupervisorTaskboard } from './supervisor-client.js';
import { TaskboardConflictError, type TaskBoard } from '../../../utils/taskboard.js';
import { applySeatEvent, emptyLive } from './seat-stream-events.js';
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

test('主管配置与人类消息管理使用工作室主管端点，不伪装成工位', async t => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) });
    return Response.json({ configured: true });
  });
  await configureSupervisor('workshop-a', 'agent-a', '统筹项目');
  await editCyclonePrivateMessage('workshop-a', { kind: 'supervisor' }, 2, '补充范围');
  await deleteCyclonePrivateMessage('workshop-a', { kind: 'supervisor' }, 3);
  await resetCyclonePrivateContext('workshop-a', { kind: 'supervisor' }, 'clear');
  assert.deepEqual(calls, [
    { url: '/api/cyclone/workshop/workshop-a/supervisor/config', method: 'PUT', body: { agentId: 'agent-a', rolePrompt: '统筹项目' } },
    { url: '/api/cyclone/workshop/workshop-a/supervisor/message', method: 'PATCH', body: { index: 2, content: '补充范围' } },
    { url: '/api/cyclone/workshop/workshop-a/supervisor/message', method: 'PATCH', body: { index: 3 } },
    { url: '/api/cyclone/workshop/workshop-a/supervisor/reset', method: 'POST', body: { mode: 'clear' } },
  ]);
});

test('主管压缩消费 SSE 终态，不能把 error 当成功', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    assert.equal(String(input), '/api/cyclone/workshop/w/supervisor/compact');
    assert.equal(init?.signal, controller.signal);
    return new Response('data: {"type":"execution-start","operationId":"supervisor:w:supervisor","runId":"run-a"}\n\ndata: {"type":"error","message":"压缩模型离线"}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(compactCyclonePrivateContext('w', { kind: 'supervisor' }, controller.signal), /压缩模型离线/);
});

test('主管任务板保留空板与版本冲突的真实结果', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return Response.json(null);
    if (calls === 2) return Response.json({ result: 'cleared', meta: { taskboard: null } });
    return Response.json({ error: '版本已变化', meta: { taskboard: null } }, { status: 409 });
  });
  assert.equal(await loadSupervisorTaskboard('w'), null);
  assert.equal(await saveSupervisorTaskboard('w', null, 0), null);
  await assert.rejects(saveSupervisorTaskboard('w', null, 0), error => error instanceof TaskboardConflictError);
});

test('主管任务板收尾读取同一工作室真实终态，迟到工具快照不退回2/6且清屏可生效', async t => {
  const stale: TaskBoard = { goal: '核验六项', updatedAt: 20, revision: 2,
    tasks: Array.from({ length: 6 }, (_, index) => ({ id: `t${index}`, title: `检查${index}`,
      status: index < 2 ? 'done' : 'todo' })) };
  const completed: TaskBoard = { ...stale, updatedAt: 50, revision: 5,
    tasks: stale.tasks.map(task => ({ ...task, status: 'done' })) };
  const urls: string[] = [];
  let latest: TaskBoard | null = completed;
  t.mock.method(globalThis, 'fetch', async input => {
    urls.push(String(input)); return Response.json(latest);
  });
  const live = emptyLive();
  applySeatEvent({ type: 'tool-result', tool: 'task_board', ok: true,
    result: '已更新', meta: { taskboard: stale } }, live);
  let board = reconcileSupervisorTaskboard(live.taskboard ?? null, await loadSupervisorTaskboard('current-workshop'));
  assert.equal(board?.tasks.filter(task => task.status === 'done').length, 6);
  board = reconcileSupervisorTaskboard(board, live.taskboard!);
  assert.equal(board?.revision, 5);
  latest = null;
  board = reconcileSupervisorTaskboard(board, await loadSupervisorTaskboard('current-workshop'));
  assert.equal(board, null);
  const restarted = { ...stale, revision: 1, updatedAt: 70 };
  assert.equal(reconcileSupervisorTaskboard(completed, restarted)?.revision, 1);
  assert.deepEqual(urls, ['/api/cyclone/workshop/current-workshop/supervisor/taskboard',
    '/api/cyclone/workshop/current-workshop/supervisor/taskboard']);
});

test('manual compact uses full-summary central ports for seats, chairs and public rooms', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  const controller = new AbortController();
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/collaboration/invoke');
    assert.equal(init?.signal, controller.signal);
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ ok: true });
  };
  try {
    await compactCyclonePrivateContext('w', { kind: 'seat', seatId: 's' }, controller.signal);
    await compactCyclonePrivateContext('w', { kind: 'chair', roomId: 'r' }, controller.signal);
    await compactCycloneRoomContext('w', 'r', 'public', controller.signal);
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
