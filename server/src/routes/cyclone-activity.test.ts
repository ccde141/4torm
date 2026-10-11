import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { beginExternalSeatActivity, clearExternalSeatActivities } from '../engine/cyclone/seat-activity.js';
import { listLockedSeatIds, tryAcquireSeatLock } from '../engine/cyclone/seat-store.js';
import { cycloneActivityRoutes } from './cyclone-activity.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';

test('工作室活动接口一次返回所有运行中工位', async (t) => {
  clearExternalSeatActivities();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-activity-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  const feature = createCycloneFeature({ dataDir });
  await app.register(cycloneActivityRoutes, {
    prefix: '/api/cyclone', feature, router: new CollaborationRouter([feature.module]),
  });
  t.after(() => app.close());
  const workshopId = 'workshop-a';
  beginExternalSeatActivity(workshopId, 'seat-b', 'contact', '联络中', 'seat-a');
  beginExternalSeatActivity('workshop-b', 'seat-other', 'dispatch', '其他工作室');
  const release = tryAcquireSeatLock(workshopId, 'seat-a');
  assert.ok(release);
  t.after(() => release());

  const response = await app.inject({
    method: 'GET', url: `/api/cyclone/workshop/${workshopId}/activities`,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().runningSeatIds, ['seat-a']);
  assert.equal(response.json().activities['seat-b'].kind, 'contact');
  assert.equal(response.json().activities['seat-b'].sourceSeatId, 'seat-a');
  assert.equal(response.json().activities['seat-a'], undefined);
  assert.equal(response.json().activities['seat-other'], undefined);

  release();
  assert.deepEqual(listLockedSeatIds(workshopId), []);
});
