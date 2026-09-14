import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSessionTitle } from './session-title.js';

test('标题使用所选模型，只发送有限正文，不提供工具', async () => {
  const title = await generateSessionTitle('/unused', { model: 'p:model', user: 'a'.repeat(10000), assistant: 'b'.repeat(10000) }, async params => {
    assert.equal(params.fullModelKey, 'p:model');
    assert.equal(params.tools, undefined);
    assert.ok(JSON.stringify(params.messages).length < 7000);
    return { content: '“项目架构讨论”', rawContent: '' };
  });
  assert.equal(title, '项目架构讨论');
});

test('空标题和模型失败不能伪装成命名成功', async () => {
  const input = { model: 'p:m', user: 'hi', assistant: 'hello' };
  await assert.rejects(generateSessionTitle('/unused', input, async () => ({ content: '', rawContent: '' })), /标题/);
  await assert.rejects(generateSessionTitle('/unused', input, async () => { throw new Error('offline'); }), /offline/);
});
