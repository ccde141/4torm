import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createDispatch, loadDispatch, updateDispatch } from '../engine/cyclone/dispatch-store.js';
import { createRoom, resetRoomContext } from '../engine/cyclone/room-store.js';
import { createWorkshop } from '../engine/cyclone/workshop-store.js';
import { cycloneDispatchRoutes } from './cyclone-dispatch.js';

test('气旋派发接口列出、标记已读并带入房间', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-route-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(cycloneDispatchRoutes, { prefix: '/api/cyclone' });
  t.after(() => app.close());
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

  const read = await app.inject({ method: 'POST', url: `${base}/${created.id}/read` });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().readState, 'read');

  const included = await app.inject({ method: 'POST', url: `${base}/${created.id}/include` });
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

async function createTestApp(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-reset-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(cycloneDispatchRoutes, { prefix: '/api/cyclone' });
  t.after(() => app.close());
  return { app, dataDir };
}

for (const resetCase of [
  { name: '/reset', publicSummary: undefined },
  { name: '/reset summary', publicSummary: '重置前讨论摘要' },
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
    const actionBase = `/api/cyclone/workshop/${workshop.id}/room/${room.id}/dispatches`;
    const includeResponse = await app.inject({
      method: 'POST', url: `${actionBase}/${included.id}/include`,
    });
    assert.equal(includeResponse.statusCode, 200);
    const running = await createDispatch(dataDir, {
      workshopId: workshop.id, sourceRoomId: room.id, sourceSeatId: 'seat-a',
      sourceSeatTitle: '调度', sourceTurnId: 'turn-old', sourceRoundSeq: 1,
      dispatchOrder: 1, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '运行中任务',
    });
    await updateDispatch(dataDir, workshop.id, running.id, { status: 'running' });

    const reset = await resetRoomContext(dataDir, workshop.id, room.id, {
      scope: 'public', publicSummary: resetCase.publicSummary,
    });
    const roomUrl = `/api/cyclone/workshop/${workshop.id}/room/${room.id}/dispatches`;
    const workshopUrl = `/api/cyclone/workshop/${workshop.id}/dispatches`;
    assert.deepEqual((await app.inject({ method: 'GET', url: roomUrl })).json(), []);
    assert.deepEqual((await app.inject({ method: 'GET', url: workshopUrl })).json(), []);

    await updateDispatch(dataDir, workshop.id, running.id, { status: 'completed', response: '稍后完成' });
    assert.deepEqual((await app.inject({ method: 'GET', url: roomUrl })).json(), []);
    assert.ok(await loadDispatch(dataDir, workshop.id, included.id));
    assert.ok(await loadDispatch(dataDir, workshop.id, running.id));
    const staleAction = await app.inject({
      method: 'POST', url: `${actionBase}/${running.id}/dismiss`,
    });
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
