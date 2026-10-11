import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { createTradewindFeature } from '../modules/tradewind/public.js';
import { tradewindRoutes } from './tradewind.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('信风 SSE 两个订阅入口先经过中心准入', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tradewind-stream-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createTradewindFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.prepareTransport = async (_feature, port) => {
    calls.push(port);
    throw frameworkError({ code: 'TEST_STREAM_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  await app.register(tradewindRoutes, { router });
  t.after(() => app.close());
  for (const [url, port] of [['/stream', 'unifiedEvents'],
    ['/meeting/node-a/events', 'meetingEvents']] as const) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 403, url);
    assert.equal(response.json().errorCode, 'TEST_STREAM_GATE');
    assert.equal(calls.at(-1), port);
  }
});
