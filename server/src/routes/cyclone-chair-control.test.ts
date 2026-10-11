import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { loadRoom, saveRoom } from '../engine/cyclone/room-store.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { cycloneRoutes } from './cyclone.js';
import { installFrameworkErrorHandler } from './error-handler.js';

async function fixture(t: TestContext, chairAgentId?: string) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-chair-http-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  await app.register(cycloneRoutes, {
    feature, router: new CollaborationRouter([feature.module]),
  });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const workshop = await feature.workshops.create(chairAgentId ? { chairAgentId } : {});
  const room = await feature.rooms.create({ workshopId: workshop.id, title: '会长讨论' });
  return { app, dataDir, feature, workshopId: workshop.id, roomId: room.id };
}

test('会长 HTTP 只保留状态和流式动作', async t => {
  const { app, dataDir, feature, workshopId, roomId } = await fixture(t, 'chair-a');
  const room = await loadRoom(dataDir, workshopId, roomId);
  assert.ok(room);
  room.chairMessages = [{ role: 'user', content: '旧问题' }];
  await saveRoom(dataDir, workshopId, room);
  assert.equal((await app.inject({ method: 'POST',
    url: `/workshop/${workshopId}/room/${roomId}/chair/edit-message`,
    payload: { index: 0, content: '新问题' } })).statusCode, 400);
  await feature.chair.editMessage(workshopId, roomId, 0, '新问题');
  assert.equal((await loadRoom(dataDir, workshopId, roomId))?.chairMessages?.[0].content, '新问题');
  const reset = await app.inject({ method: 'POST',
    url: `/workshop/${workshopId}/room/${roomId}/chair/reset-context`,
    payload: { mode: 'clear' } });
  assert.equal(reset.statusCode, 400);
  const result = await feature.chair.reset(workshopId, roomId, 'clear');
  assert.equal(result.archivedChairCount, 1);
  assert.deepEqual((await loadRoom(dataDir, workshopId, roomId))?.chairMessages, []);
});

test('未配置会长时状态端点返回稳定错误身份', async t => {
  const { app, workshopId, roomId } = await fixture(t);
  const response = await app.inject(`/workshop/${workshopId}/room/${roomId}/chair/status`);
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().errorCode, 'CYCLONE_CHAIR_NOT_CONFIGURED');
});
