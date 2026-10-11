import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { createTideFeature } from '../modules/tide/public.js';
import { tideRoutes } from './tide.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('潮汐页面读取须经过中心方法路由', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-query-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const feature = createTideFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.invoke = async call => {
    calls.push(call.method);
    throw frameworkError({ code: 'TEST_QUERY_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  await app.register(tideRoutes, { feature, router });
  t.after(() => app.close());
  const cases = [
    ['/tasks', 'readTaskList'], ['/task/task-a', 'readTaskDetail'],
    ['/task/task-a/runs', 'readTaskRuns'], ['/sessions/agent-a', 'readSessions'],
    ['/session/agent-a/session-a', 'readSession'],
  ] as const;
  for (const [url, method] of cases) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 403, url);
    assert.equal(response.json().errorCode, 'TEST_QUERY_GATE');
    assert.equal(calls.at(-1), method);
  }
});
