import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createTideFeature } from '../modules/tide/public.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { tideRoutes } from './tide.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';

test('潮汐 HTTP 只保留读取与会话传输，写操作由中心路由独占', async t => {
  const { app, feature } = await setup(t);
  const task = await feature.tasks.create({
    name: 'task', schedule: 'every 5m', prompt: 'work', agentId: 'agent-a',
  });

  assert.equal((await app.inject('/api/tide/tasks')).json()[0].id, task.id);
  assert.equal((await app.inject(`/api/tide/task/${task.id}`)).json().task.id, task.id);
  assert.deepEqual((await app.inject(`/api/tide/task/${task.id}/runs?limit=20`)).json(), []);
  assert.equal((await app.inject({
    method: 'POST', url: '/api/tide/task', payload: { name: 'legacy write' },
  })).statusCode, 404);
});

test('潮汐读取入口拒绝无效分页', async t => {
  const { app, feature } = await setup(t);
  const task = await feature.tasks.create({
    name: 'task', schedule: 'every 5m', prompt: 'work', agentId: 'agent-a',
  });
  const response = await app.inject(`/api/tide/task/${task.id}/runs?limit=abc`);
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().errorCode, 'TIDE_TASK_INPUT_INVALID');
});

async function setup(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-read-route-'));
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const feature = createTideFeature({ dataDir });
  await app.register(tideRoutes, { prefix: '/api/tide', feature,
    router: new CollaborationRouter([feature.module]) });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { app, feature };
}
