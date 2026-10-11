import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { addSeat } from '../engine/cyclone/seat-store.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { cycloneRoutes } from './cyclone.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('气旋五种流式动作均先经过中心准入门控', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-gate-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.prepareTransport = async (island, port) => {
    calls.push(`${island}.${port}`);
    throw frameworkError({ code: 'TEST_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  await app.register(cycloneRoutes, { feature, router });
  t.after(() => app.close());
  const workshop = await feature.workshops.create({ chairAgentId: 'chair-a' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '工位' });
  const room = await feature.rooms.create({ workshopId: workshop.id, title: '讨论' });
  const cases = [
    [`/workshop/${workshop.id}/seat/${seat.id}/compact`, {}, 'seatCompaction'],
    [`/workshop/${workshop.id}/seat/${seat.id}/chat`, { message: '你好' }, 'seatChat'],
    [`/workshop/${workshop.id}/room/${room.id}/intro`, { intros: [] }, 'roomIntroduction'],
    [`/workshop/${workshop.id}/room/${room.id}/speak`, { message: '开始' }, 'roomRound'],
    [`/workshop/${workshop.id}/room/${room.id}/chair/chat`, { message: '建议' }, 'chairChat'],
  ] as const;
  for (const [url, payload, port] of cases) {
    const response = await app.inject({ method: 'POST', url, payload });
    assert.equal(response.statusCode, 403, url);
    assert.equal(response.json().errorCode, 'TEST_GATE', url);
    assert.equal(calls.at(-1), `cyclone.${port}`);
  }
  assert.equal(calls.length, cases.length);
});
