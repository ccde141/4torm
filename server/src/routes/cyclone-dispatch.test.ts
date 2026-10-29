import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createDispatch, loadDispatch, updateDispatch } from '../engine/cyclone/dispatch-store.js';
import { createRoom, loadRoom, resetRoomContext } from '../engine/cyclone/room-store.js';
import { createWorkshop } from '../engine/cyclone/workshop-store.js';
import { cycloneDispatchRoutes } from './cyclone-dispatch.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { collaborationRoutes } from './collaboration.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('气旋派发接口列出、标记已读并带入房间', async (t) => {
  const { app, dataDir } = await createTestApp(t);
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const room = await createRoom(dataDir, workshop.id);
  const created = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: room.id, sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '写报告',
  });
  await updateDispatch(dataDir, workshop.id, created.id, { status: 'completed', response: '完成' });
  const base = `/api/cyclone/workshop/${workshop.id}/room/${room.id}/dispatches`;

  const listed = await app.inject({ method: 'GET', url: base });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().length, 1);
  const workshopList = await app.inject({
    method: 'GET', url: `/api/cyclone/workshop/${workshop.id}/dispatches`,
  });
  assert.equal(workshopList.statusCode, 200);
  assert.equal(workshopList.json()[0].sourceRoomId, room.id);

  assert.equal((await app.inject({ method: 'POST', url: `${base}/${created.id}/read` })).statusCode, 404);
  const read = await app.inject(dispatchAction(workshop.id, room.id, created.id, 'read'));
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().readState, 'read');

  const included = await app.inject(dispatchAction(workshop.id, room.id, created.id, 'include'));
  assert.equal(included.statusCode, 200);
  assert.equal(included.json().decisionState, 'included');
});

test('工位来源派发只进入工作室总览，不进入任意房间列表', async (t) => {
  const { app, dataDir } = await createTestApp(t);
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const room = await createRoom(dataDir, workshop.id);
  const created = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-a', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '写报告',
    receiptState: 'pending',
  });

  const workshopList = await app.inject({
    method: 'GET', url: `/api/cyclone/workshop/${workshop.id}/dispatches`,
  });
  const roomList = await app.inject({
    method: 'GET', url: `/api/cyclone/workshop/${workshop.id}/room/${room.id}/dispatches`,
  });
  assert.deepEqual(workshopList.json().map((item: { id: string }) => item.id), [created.id]);
  assert.deepEqual(roomList.json(), []);
});

test('没有来源群聊的派发应说明不能带入，真实缺失仍返回不存在', async (t) => {
  const { app, dataDir, router } = await createTestApp(t);
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const room = await createRoom(dataDir, workshop.id);
  const seat = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'seat-turn', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '写报告',
  });
  const noRoom = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: '', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'room-turn', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '写报告',
  });
  await Promise.all([seat, noRoom].map(item => updateDispatch(
    dataDir, workshop.id, item.id, { status: 'completed', response: '完成' },
  )));

  const seatResult = await app.inject(dispatchAction(workshop.id, room.id, seat.id, 'include'));
  assert.equal(seatResult.statusCode, 409);
  assert.equal(seatResult.json().errorCode, 'CYCLONE_DISPATCH_CONFLICT');
  assert.match(seatResult.json().error, /工位.*不能带入群聊/);
  await assert.rejects(router.invoke({
    feature: 'cyclone', method: 'includeCollaborationDispatch',
    input: { workshopId: workshop.id, roomId: room.id, dispatchId: seat.id },
  }, {
    actor: { type: 'agent', id: 'seat-a', actingAs: 'human' }, audience: 'agent',
    enabledFeatures: new Set<'cyclone'>(['cyclone']),
    permissions: new Set<'design'>(['design']), requestId: 'include-seat',
  }), (error: unknown) => (
    (error as { data?: { code?: string; message?: string } }).data?.code === 'CYCLONE_DISPATCH_CONFLICT'
    && /工位.*不能带入群聊/.test((error as Error).message)
  ));

  const noRoomResult = await app.inject(dispatchAction(workshop.id, room.id, noRoom.id, 'include'));
  assert.equal(noRoomResult.statusCode, 409);
  assert.match(noRoomResult.json().error, /没有来源群聊/);

  const missing = await app.inject(dispatchAction(workshop.id, room.id, 'dispatch-missing', 'include'));
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().errorCode, 'CYCLONE_DISPATCH_NOT_FOUND');
  assert.deepEqual((await loadRoom(dataDir, workshop.id, room.id))?.publicMessages, []);
});

test('打开目标工位的已读接口返回并保存已确认结果', async (t) => {
  const { app, dataDir } = await createTestApp(t);
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const created = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-a', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '写报告',
  });
  await updateDispatch(dataDir, workshop.id, created.id, { status: 'completed', response: '完成' });

  const response = await app.inject({
    method: 'POST',
    url: '/api/collaboration/invoke',
    payload: { feature: 'cyclone', method: 'markSeatDispatchesRead',
      input: { workshopId: workshop.id, seatId: 'seat-b' } },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().map((item: { id: string }) => item.id), [created.id]);
  assert.equal((await loadDispatch(dataDir, workshop.id, created.id))?.readState, 'read');
});

async function createTestApp(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-reset-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  await app.register(cycloneDispatchRoutes, { prefix: '/api/cyclone', feature, router });
  await app.register(collaborationRoutes, { prefix: '/api/collaboration', router });
  t.after(() => app.close());
  return { app, dataDir, router };
}

function dispatchAction(
  workshopId: string, roomId: string, dispatchId: string, action: string,
) {
  return { method: 'POST' as const, url: '/api/collaboration/invoke', payload: {
    feature: 'cyclone', method: 'actOnDispatch',
    input: { workshopId, roomId, dispatchId, action },
  } };
}

for (const resetCase of [
  { name: '/reset', publicSummary: undefined },
]) {
  test(`${resetCase.name} 后旧派发退出新上下文但继续保留记录`, async (t) => {
    const { app, dataDir } = await createTestApp(t);
    const workshop = await createWorkshop(dataDir, { title: '测试' });
    const room = await createRoom(dataDir, workshop.id);
    const included = await createDispatch(dataDir, {
      workshopId: workshop.id, sourceRoomId: room.id, sourceSeatId: 'seat-a',
      sourceSeatTitle: '调度', sourceTurnId: 'turn-old', sourceRoundSeq: 1,
      dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '已带入任务',
    });
    await updateDispatch(dataDir, workshop.id, included.id, { status: 'completed', response: '旧结果' });
    const includeResponse = await app.inject(dispatchAction(
      workshop.id, room.id, included.id, 'include',
    ));
    assert.equal(includeResponse.statusCode, 200);
    const running = await createDispatch(dataDir, {
      workshopId: workshop.id, sourceRoomId: room.id, sourceSeatId: 'seat-a',
      sourceSeatTitle: '调度', sourceTurnId: 'turn-old', sourceRoundSeq: 1,
      dispatchOrder: 1, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '运行中任务',
    });
    await updateDispatch(dataDir, workshop.id, running.id, { status: 'running' });

    const reset = await resetRoomContext(dataDir, workshop.id, room.id, {
      scope: 'public', publicSummary: resetCase.publicSummary, publicRetainedMessages: [],
    });
    const roomUrl = `/api/cyclone/workshop/${workshop.id}/room/${room.id}/dispatches`;
    const workshopUrl = `/api/cyclone/workshop/${workshop.id}/dispatches`;
    assert.deepEqual((await app.inject({ method: 'GET', url: roomUrl })).json(), []);
    assert.deepEqual((await app.inject({ method: 'GET', url: workshopUrl })).json(), []);

    await updateDispatch(dataDir, workshop.id, running.id, { status: 'completed', response: '稍后完成' });
    assert.deepEqual((await app.inject({ method: 'GET', url: roomUrl })).json(), []);
    assert.ok(await loadDispatch(dataDir, workshop.id, included.id));
    assert.ok(await loadDispatch(dataDir, workshop.id, running.id));
    const staleAction = await app.inject(dispatchAction(
      workshop.id, room.id, running.id, 'dismiss',
    ));
    assert.equal(staleAction.statusCode, 404);

    const current = await createDispatch(dataDir, {
      workshopId: workshop.id, sourceRoomId: room.id, sourceSeatId: 'seat-a',
      sourceSeatTitle: '调度', sourceTurnId: 'turn-new', sourceRoundSeq: 2,
      dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '新任务',
      contextVersion: reset.room?.dispatchContextVersion,
    });
    assert.deepEqual((await app.inject({ method: 'GET', url: roomUrl })).json().map(
      (item: { id: string }) => item.id,
    ), [current.id]);
  });
}

test('/compact 保留派发所属上下文，晚到结果仍能查询和带入', async t => {
  const { app, dataDir } = await createTestApp(t);
  const workshop = await createWorkshop(dataDir, { title: '压缩后的协作' });
  const room = await createRoom(dataDir, workshop.id);
  const dispatch = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: room.id, sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-old', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '等待交付',
  });
  await updateDispatch(dataDir, workshop.id, dispatch.id, { status: 'running' });
  await resetRoomContext(dataDir, workshop.id, room.id, {
    scope: 'public', publicSummary: '等待派发结果，保留运行编号。', publicRetainedMessages: [],
  });
  await updateDispatch(dataDir, workshop.id, dispatch.id, { status: 'completed', response: '交付已完成' });
  const response = await app.inject({ method: 'GET',
    url: `/api/cyclone/workshop/${workshop.id}/room/${room.id}/dispatches` });
  assert.deepEqual(response.json().map((item: { id: string }) => item.id), [dispatch.id]);
  assert.equal((await app.inject(dispatchAction(workshop.id, room.id, dispatch.id, 'include'))).statusCode, 200);
  const saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.equal(saved?.dispatchContextVersion || 0, 0);
  assert.match(saved?.publicMessages.at(-1)?.content || '', /交付已完成/);
});
