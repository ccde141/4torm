import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { installFrameworkErrorHandler } from '../../../routes/error-handler.js';
import { registerMonsoonCompaction } from './compaction.js';

test('季风上下文压缩在开启 SSE 前经过中心传输口', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  t.after(() => app.close());
  const router = new CollaborationRouter([]);
  const calls: string[] = [];
  router.prepareTransport = async (_feature, port) => {
    calls.push(port);
    throw frameworkError({ code: 'TEST_COMPACTION_GATE', kind: 'permission',
      message: '中心拒绝', source: 'test', retryable: false });
  };
  registerMonsoonCompaction(app, router);
  const response = await app.inject({ method: 'POST', url: '/compact',
    payload: { agentId: 'agent-a', sessionId: 'session-a' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().errorCode, 'TEST_COMPACTION_GATE');
  assert.deepEqual(calls, ['compaction']);
});
