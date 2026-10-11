import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { cycloneRoutes } from './cyclone.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('气旋工作室 HTTP 只保留读取端点', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-http-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  await app.register(cycloneRoutes, {
    feature, router: new CollaborationRouter([feature.module]),
  });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const workshopId = (await feature.workshops.create({ title: '研究组' })).id;
  await feature.workshops.rename(workshopId, '验证组');
  await feature.workshops.mutateBulletin(workshopId, [{ op: 'add', text: '核对结果' }]);
  const summary = (await app.inject(`/workshop/${workshopId}/summary`)).json();
  assert.equal(summary.title, '验证组');
  assert.deepEqual(summary.seats, []);
  assert.deepEqual(summary.rooms, []);

  const bulletin = (await app.inject(`/workshop/${workshopId}/bulletin`)).json();
  assert.equal(bulletin.entries[0].text, '核对结果');
  assert.equal((await app.inject({ method: 'POST', url: '/create' })).statusCode, 404);
  for (const action of ['rename', 'delete', 'set-chair', 'add-seat', 'gen-duty',
    'bulletin-mutate', 'bulletin-revert', 'open-workspace']) {
    assert.equal((await app.inject({
      method: 'POST', url: `/workshop/${workshopId}/${action}`,
    })).statusCode, 404, action);
  }
});
