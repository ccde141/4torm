import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { cycloneRoutes } from './cyclone.js';
import { cycloneOrganizationRoutes } from './cyclone-organization.js';
import { cycloneDispatchRoutes } from './cyclone-dispatch.js';
import { cycloneActivityRoutes } from './cyclone-activity.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('气旋页面查询须先经过中心方法路由', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-query-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.invoke = async call => {
    calls.push(call.method);
    throw frameworkError({ code: 'TEST_QUERY_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  await app.register(cycloneRoutes, { feature, router });
  await app.register(cycloneOrganizationRoutes, { feature, router });
  await app.register(cycloneDispatchRoutes, { feature, router });
  await app.register(cycloneActivityRoutes, { feature, router });
  t.after(() => app.close());
  const workshopId = 'cyc-test';
  const checks = [
    ['/list', 'listWorkshops'],
    [`/workshop/${workshopId}/status`, 'readWorkshop'],
    [`/workshop/${workshopId}/summary`, 'summarizeWorkshop'],
    [`/workshop/${workshopId}/bulletin`, 'readWorkshopBulletin'],
    [`/workshop/${workshopId}/bulletin-history`, 'readWorkshopBulletinHistory'],
    [`/workshop/${workshopId}/organization`, 'readWorkshopOrganization'],
    [`/workshop/${workshopId}/seat/seat-test/status`, 'readSeat'],
    [`/workshop/${workshopId}/seat/seat-test/revision`, 'readSeatRevision'],
    [`/workshop/${workshopId}/seat/seat-test/activity`, 'readSeatActivity'],
    [`/workshop/${workshopId}/activities`, 'readWorkshopActivities'],
    [`/workshop/${workshopId}/room/room-test/status`, 'readRoom'],
    [`/workshop/${workshopId}/room/room-test/chair/status`, 'readChair'],
    [`/workshop/${workshopId}/dispatches`, 'listWorkshopDispatches'],
    [`/workshop/${workshopId}/room/room-test/dispatches`, 'listRoomDispatches'],
  ] as const;
  for (const [url, method] of checks) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 403, url);
    assert.equal(response.json().errorCode, 'TEST_QUERY_GATE');
    assert.equal(calls.at(-1), method);
  }
});
