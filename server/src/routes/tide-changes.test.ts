import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { createTideFeature } from '../modules/tide/public.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { tideRoutes } from './tide.js';

test('潮汐变更流先经过中心读准入，拒绝后不留订阅', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-change-gate-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const called: string[] = [];
  router.invoke = async request => {
    called.push(`${request.feature}.${request.method}`);
    throw frameworkError({ code: 'TEST_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  const app = Fastify();
  installFrameworkErrorHandler(app);
  await app.register(tideRoutes, { feature, router });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/changes' });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(called, ['tide.readTaskList']);
  assert.equal(feature.changes.listenerCount, 0);
});

test('潮汐任务外部写入即时唤醒页面流，断线释放订阅', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-change-stream-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir });
  const app = Fastify();
  await app.register(tideRoutes, { feature, router: new CollaborationRouter([feature.module]) });
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const response = await fetch(`${address}/changes`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  t.after(() => { controller.abort(); void reader.cancel().catch(() => undefined); });
  await reader.read();
  assert.equal(feature.changes.listenerCount, 1);
  const task = await feature.tasks.create({ name: '巡检', schedule: 'every 5m',
    prompt: '检查', agentId: 'worker' }, { enabled: false });
  const event = await reader.read();
  assert.deepEqual(JSON.parse(new TextDecoder().decode(event.value).split('data: ')[1]), {
    type: 'change', scope: 'task', taskId: task.id, agentId: 'worker', revision: 1,
  });
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(feature.changes.listenerCount, 0);
});
