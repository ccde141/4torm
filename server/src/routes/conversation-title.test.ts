import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerConversationTitle } from './conversation-title.js';

test('命名接口拒绝缺失、错误类型、超长和额外字段，校验前不调用模型', async t => {
  const app = Fastify();
  registerConversationTitle(app);
  t.after(() => app.close());
  for (const payload of [
    {}, { model: 'p:m', user: 3, assistant: 'a' },
    { model: 'p:m', user: 'u', assistant: 'a', tools: 'unexpected' },
    { model: 'p:m', user: 'u'.repeat(2001), assistant: 'a' },
  ]) {
    const result = await app.inject({ method: 'POST', url: '/title', payload });
    assert.equal(result.statusCode, 400);
  }
});
