import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { createMonsoonFeature } from './factory.js';
import { registerMonsoonSessions } from './sessions.js';
import { installFrameworkErrorHandler } from '../../../routes/error-handler.js';

test('季风会话读写均先经过中心方法路由', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-session-gate-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createMonsoonFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.invoke = async call => {
    calls.push(call.method);
    throw frameworkError({ code: 'TEST_SESSION_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  const app = Fastify();
  installFrameworkErrorHandler(app);
  registerMonsoonSessions(app, router);
  t.after(() => app.close());
  const cases = [
    ['POST', '/sessions', { agentId: 'agent-a', id: 'session-a' }, 'createSession'],
    ['GET', '/sessions/agent-a', undefined, 'listSessions'],
    ['GET', '/sessions/agent-a/session-a', undefined, 'readSession'],
    ['PUT', '/sessions/agent-a/session-a', { session: {}, expectedRevision: 1, mode: 'rename' },
      'replaceSession'],
    ['DELETE', '/sessions/agent-a/session-a', undefined, 'deleteSession'],
  ] as const;
  for (const [method, url, payload, expected] of cases) {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    assert.equal(response.statusCode, 403, `${method} ${url}`);
    assert.equal(response.json().errorCode, 'TEST_SESSION_GATE');
    assert.equal(calls.at(-1), expected);
  }
});
