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
import { installFrameworkErrorHandler } from './error-handler.js';

test('全局变更流先通过中心读准入', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-change-gate-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const called: string[] = [];
  router.invoke = async request => {
    called.push(`${request.feature}.${request.method}`);
    throw frameworkError({ code: 'TEST_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  await app.register(cycloneRoutes, { feature, router });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/changes' });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(called, ['cyclone.listWorkshops']);
  assert.equal(feature.changes.listenerCount, 0);
});

test('Agent 与人类共用的服务写入可立即唤醒 SSE，断线释放监听', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-change-stream-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  const feature = createCycloneFeature({ dataDir });
  await app.register(cycloneRoutes, { feature, router: new CollaborationRouter([feature.module]) });
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const response = await fetch(`${address}/changes`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  t.after(() => { controller.abort(); void reader.cancel().catch(() => undefined); });
  await reader.read(); // connected comment
  assert.equal(feature.changes.listenerCount, 1);
  const workshop = await feature.workshops.create({ title: '协作组' });
  const event = await reader.read();
  assert.deepEqual(JSON.parse(new TextDecoder().decode(event.value).split('data: ')[1]), {
    type: 'change', workshopId: workshop.id, scope: 'workshop', id: workshop.id, revision: 1,
  });
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(feature.changes.listenerCount, 0);
});

test('准入查询期间断开时不建立变更订阅', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-change-abort-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const invoke = router.invoke.bind(router);
  let entered!: () => void;
  let release!: () => void;
  const reachedGate = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  router.invoke = async request => {
    entered();
    await gate;
    return invoke(request);
  };
  await app.register(cycloneRoutes, { feature, router });
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const pending = fetch(`${address}/changes`, { signal: controller.signal }).catch(() => undefined);
  await reachedGate;
  controller.abort();
  await pending;
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(feature.changes.listenerCount, 0);
});
