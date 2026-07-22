import assert from 'node:assert/strict';
import test from 'node:test';
import { recordSeatAssistantResult } from './seat-reasoning.js';

test('工位将本轮多段思考绑定到最终回复', () => {
  const messages = [{ role: 'user' as const, content: '开始' }];

  recordSeatAssistantResult(messages, '最终回复', '第一段第二段');

  assert.deepEqual(messages, [
    { role: 'user', content: '开始' },
    { role: 'assistant', content: '最终回复', reasoning: '第一段第二段' },
  ]);
});

test('工位已有最终回复时只补充思考，不重复写入消息', () => {
  const messages = [{ role: 'assistant' as const, content: '最终回复' }];

  recordSeatAssistantResult(messages, '最终回复', '分析过程');

  assert.deepEqual(messages, [
    { role: 'assistant', content: '最终回复', reasoning: '分析过程' },
  ]);
});

test('中止与错误结果不进入工位历史', () => {
  const messages = [{ role: 'user' as const, content: '开始' }];

  recordSeatAssistantResult(messages, '[中止] 已停止', '未完成分析');
  recordSeatAssistantResult(messages, '[错误] 请求失败', '失败分析');

  assert.deepEqual(messages, [{ role: 'user', content: '开始' }]);
});
