import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerConversationTitle } from './title.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { monsoonAuxiliaryHandlers, monsoonAuxiliaryManifests } from './auxiliary-methods.js';

test('命名接口拒绝缺失、错误类型、超长和额外字段，校验前不调用模型', async t => {
  const app = Fastify();
  let calls = 0;
  const title = async () => { calls++; return 'unused'; };
  const router = new CollaborationRouter([{ manifest: {
    id: 'monsoon', version: 1, title: '季风', methods: monsoonAuxiliaryManifests(true, false),
  }, handlers: monsoonAuxiliaryHandlers(title) }]);
  registerConversationTitle(app, router);
  t.after(() => app.close());
  for (const payload of [
    {}, { model: 'p:m', user: 3, assistant: 'a' },
    { model: 'p:m', user: 'u', assistant: 'a', tools: 'unexpected' },
    { model: 'p:m', user: 'u'.repeat(2001), assistant: 'a' },
  ]) {
    const result = await app.inject({ method: 'POST', url: '/title', payload });
    assert.equal(result.statusCode, 400);
  }
  assert.equal(calls, 0);
});
