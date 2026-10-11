import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { installFrameworkErrorHandler } from '../../../routes/error-handler.js';
import { createMonsoonFeature } from './factory.js';
import { monsoonRoutes } from './routes.js';

test('季风 SSE 路由须经过中心准备口，且不提前打开流', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-gate-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  installFrameworkErrorHandler(app);
  const feature = createMonsoonFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.prepareTransport = async (_feature, portId) => {
    calls.push(portId);
    throw frameworkError({ code: 'TEST_GATE', kind: 'permission',
      message: '中心拒绝', source: 'test', retryable: false });
  };
  await app.register(monsoonRoutes, { feature, router });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const chat = await app.inject({ method: 'POST', url: '/chat', payload: {
    sessionId: 'session-a', agentId: 'agent-a', inputRunId: 'run-a', messages: [],
  } });
  const reply = await app.inject({ method: 'POST', url: '/reply', payload: {
    sessionId: 'session-a', inputRunId: 'run-b', answer: '继续',
  } });
  assert.deepEqual(calls, ['chat', 'reply']);
  assert.equal(chat.statusCode, 403);
  assert.equal(reply.statusCode, 403);
  assert.equal(chat.json().errorCode, 'TEST_GATE');
  assert.equal(reply.json().errorCode, 'TEST_GATE');
});
