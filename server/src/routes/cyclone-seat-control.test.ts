import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { loadSeat, saveSeat } from '../engine/cyclone/seat-store.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { cycloneRoutes } from './cyclone.js';
import { installFrameworkErrorHandler } from './error-handler.js';

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-seat-http-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  await app.register(cycloneRoutes, {
    feature, router: new CollaborationRouter([feature.module]),
  });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const workshop = await feature.workshops.create({});
  const seat = await feature.workshops.addSeat({
    workshopId: workshop.id, agentId: 'agent-a', title: '旧名称',
  });
  return { app, dataDir, feature, workshopId: workshop.id, seatId: seat.id };
}

test('工位 HTTP 只保留读取和流式动作', async t => {
  const { app, dataDir, feature, workshopId, seatId } = await fixture(t);
  assert.equal((await feature.seats.updateRole(workshopId, seatId, {
    title: '验证工位',
  })).title, '验证工位');
  assert.equal((await app.inject({ method: 'POST',
    url: `/workshop/${workshopId}/seat/${seatId}/update-role`,
  })).statusCode, 400);

  const seat = await loadSeat(dataDir, workshopId, seatId);
  assert.ok(seat);
  seat.messages = [{ role: 'user', content: '旧内容' }];
  await saveSeat(dataDir, workshopId, seat);
  const edit = await app.inject({
    method: 'POST', url: `/workshop/${workshopId}/seat/${seatId}/edit-message`,
    payload: { index: 0, content: '新内容' },
  });
  assert.equal(edit.statusCode, 400);
  await feature.seats.editMessage(workshopId, seatId, 0, '新内容');
  assert.equal((await loadSeat(dataDir, workshopId, seatId))?.messages[0].content, '新内容');
});

test('工位缺失与占用冲突返回稳定错误身份', async t => {
  const { app, workshopId } = await fixture(t);
  const missing = await app.inject(`/workshop/${workshopId}/seat/missing/status`);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().errorCode, 'CYCLONE_SEAT_NOT_FOUND');
});

test('工位重置与删除旧 HTTP 入口均退出', async t => {
  const { app, dataDir, feature, workshopId, seatId } = await fixture(t);
  const seat = await loadSeat(dataDir, workshopId, seatId);
  assert.ok(seat);
  seat.messages = [{ role: 'user', content: '准备归档' }];
  await saveSeat(dataDir, workshopId, seat);
  const reset = await app.inject({
    method: 'POST', url: `/workshop/${workshopId}/seat/${seatId}/reset-context`,
    payload: { mode: 'clear' },
  });
  assert.equal(reset.statusCode, 400);
  const result = await feature.seats.reset(workshopId, seatId, { mode: 'clear' });
  assert.equal(result.archivedCount, 1);
  assert.deepEqual((await loadSeat(dataDir, workshopId, seatId))?.messages, []);

  const removed = await app.inject({
    method: 'POST', url: `/workshop/${workshopId}/seat/${seatId}/delete`,
  });
  assert.equal(removed.statusCode, 400);
  await feature.seats.remove(workshopId, seatId);
  const missing = await app.inject(`/workshop/${workshopId}/seat/${seatId}/status`);
  assert.equal(missing.statusCode, 404);
});
