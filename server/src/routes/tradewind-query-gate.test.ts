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

test('信风运行时资源读取经过中心方法路由', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tradewind-query-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createTradewindFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.invoke = async call => {
    calls.push(call.method);
    throw frameworkError({ code: 'TEST_QUERY_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  await app.register(tradewindRoutes, { router });
  t.after(() => app.close());
  const checks = [['/nodes/status', 'readNodeStatuses'],
    ['/chat/node-a/status', 'readNodeStatus'],
    ['/chat/node-a/snapshot', 'readNodeSnapshot'],
    ['/meeting/node-a/status', 'readMeetingStatus']] as const;
  for (const [url, method] of checks) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 403, url);
    assert.equal(response.json().errorCode, 'TEST_QUERY_GATE');
    assert.equal(calls.at(-1), method);
  }
});
