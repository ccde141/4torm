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

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-room-http-'));
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
    workshopId: workshop.id, agentId: 'agent-a', title: '研究员',
  });
  const room = await feature.rooms.create({
    workshopId: workshop.id, title: '讨论', participantSeatIds: [seat.id],
  });
  return { app, dataDir, feature, workshopId: workshop.id, roomId: room.id };
}

test('群聊 HTTP 配置与消息写入口全部退出', async t => {
  const { app, dataDir, feature, workshopId, roomId } = await fixture(t);
  for (const action of ['rename', 'set-topic', 'set-mode', 'join', 'leave', 'reorder', 'delete']) {
    assert.equal((await app.inject({ method: 'POST',
      url: `/workshop/${workshopId}/room/${roomId}/${action}`,
    })).statusCode, 400, action);
  }

  const room = await loadRoom(dataDir, workshopId, roomId);
  assert.ok(room);
  room.publicMessages.push({ speaker: '人类', content: '旧内容', timestamp: Date.now() });
  await saveRoom(dataDir, workshopId, room);
  const edit = await app.inject({ method: 'POST',
    url: `/workshop/${workshopId}/room/${roomId}/edit-message`,
    payload: { index: room.publicMessages.length - 1, content: '新内容' } });
  assert.equal(edit.statusCode, 400);
  await feature.rooms.editMessage(
    workshopId, roomId, room.publicMessages.length - 1, '新内容',
  );
  assert.equal((await loadRoom(dataDir, workshopId, roomId))?.publicMessages.at(-1)?.content, '新内容');
});

test('群聊删除后读取返回稳定缺失身份', async t => {
  const { app, feature, workshopId, roomId } = await fixture(t);
  await feature.rooms.remove(workshopId, roomId);
  const missing = await app.inject(`/workshop/${workshopId}/room/${roomId}/status`);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().errorCode, 'CYCLONE_ROOM_NOT_FOUND');
});
