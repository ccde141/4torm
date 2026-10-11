import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { installFrameworkErrorHandler } from '../../../routes/error-handler.js';
import { registerConversationTeam } from './team.js';
import { registerConversationTitle } from './title.js';

test('季风标题和成员上下文通过中心调用口', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  t.after(() => app.close());
  const router = new CollaborationRouter([]);
  const calls: string[] = [];
  router.invoke = async call => {
    calls.push(call.method);
    throw frameworkError({ code: 'TEST_AUX_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  registerConversationTitle(app, router);
  registerConversationTeam(app, router);
  const title = await app.inject({ method: 'POST', url: '/title',
    payload: { model: 'p:m', user: '目标', assistant: '结果' } });
  const context = await app.inject('/team/context?agentId=agent-a&sessionId=session-a&memberId=member-a');
  assert.equal(title.statusCode, 403);
  assert.equal(context.statusCode, 403);
  assert.deepEqual(calls, ['generateTitle', 'readMemberContext']);
});
