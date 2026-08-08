import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { addSeat, saveSeat, tryAcquireSeatLock } from '../engine/cyclone/seat-store.js';
import { createWorkshop } from '../engine/cyclone/workshop-store.js';
import { cycloneRoutes } from './cyclone.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-compact-route-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(cycloneRoutes, { prefix: '/api/cyclone' });
  t.after(() => app.close());
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '开发' });
  return { app, dataDir, workshop, seat };
}

test('工位滚动压缩不足四个完整回合时返回明确原因', async (t) => {
  const { app, dataDir, workshop, seat } = await fixture(t);
  seat.messages = [
    { role: 'user', content: '一' }, { role: 'assistant', content: '答一' },
    { role: 'user', content: '二' }, { role: 'assistant', content: '答二' },
    { role: 'user', content: '三' },
  ];
  seat.tokenUsage = { promptTokens: 9_000, completionTokens: 1, totalTokens: 9_001 };
  await saveSeat(dataDir, workshop.id, seat);
  const response = await app.inject({
    method: 'POST', url: `/api/cyclone/workshop/${workshop.id}/seat/${seat.id}/compact`,
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /不足四个完整回合/);
});

test('工位被占用时滚动压缩不读取旧快照覆盖当前轮次', async (t) => {
  const { app, workshop, seat } = await fixture(t);
  const release = tryAcquireSeatLock(workshop.id, seat.id);
  assert.ok(release);
  t.after(() => release?.());
  const response = await app.inject({
    method: 'POST', url: `/api/cyclone/workshop/${workshop.id}/seat/${seat.id}/compact`,
  });
  assert.equal(response.statusCode, 409);
  assert.match(response.json().error, /正在处理消息/);
});
