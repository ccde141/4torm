import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { createConvectionFeature } from '../modules/convection/public.js';
import { convectionRoutes } from './convection.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('对流会话查询须经过中心方法路由', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-query-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createConvectionFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.invoke = async call => {
    calls.push(call.method);
    throw frameworkError({ code: 'TEST_QUERY_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  await app.register(convectionRoutes, { feature, router });
  t.after(() => app.close());
  for (const [url, method] of [['/list', 'listSessions'],
    ['/session/session-a/status', 'readSession']] as const) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().errorCode, 'TEST_QUERY_GATE');
    assert.equal(calls.at(-1), method);
  }
});
