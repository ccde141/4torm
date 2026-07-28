import assert from 'node:assert/strict';
import test from 'node:test';
import { recordSeatAssistantResult } from './seat-reasoning.js';
import type { SeatContextMessage } from './types.js';

test('工位将本轮多段思考绑定到最终回复', () => {
  const messages = [{ role: 'user' as const, content: '开始' }];

  recordSeatAssistantResult(messages, '最终回复', '第一段第二段');

  assert.deepEqual(messages, [
    { role: 'user', content: '开始' },
    { role: 'assistant', content: '最终回复', reasoning: '第一段第二段', reasoningContent: '第一段第二段' },
  ]);
});

test('工位已有最终回复时只补充思考，不重复写入消息', () => {
  const messages = [{ role: 'assistant' as const, content: '最终回复' }];

  recordSeatAssistantResult(messages, '最终回复', '分析过程');

  assert.deepEqual(messages, [
    { role: 'assistant', content: '最终回复', reasoning: '分析过程', reasoningContent: '分析过程' },
  ]);
});

test('工位最终回复只回灌尚未属于工具轮的思考', () => {
  const messages: SeatContextMessage[] = [
    { role: 'assistant', content: '', reasoningContent: '先读文件', toolCalls: [{ id: '1', name: 'read_file', arguments: '{}' }] },
    { role: 'tool', content: '结果', toolCallId: '1' },
  ];

  recordSeatAssistantResult(messages, '最终回复', '先读文件再总结');

  assert.deepEqual(messages.at(-1), {
    role: 'assistant', content: '最终回复',
    reasoning: '先读文件再总结', reasoningContent: '再总结',
  });
});

test('工位最终回复不会把旧轮次思考计入本轮工具推理', () => {
  const messages: SeatContextMessage[] = [
    { role: 'assistant', content: '旧回复', reasoningContent: '旧思考' },
    { role: 'user', content: '新问题' },
    { role: 'assistant', content: '', reasoningContent: '先检查', toolCalls: [{ id: '2', name: 'read_file', arguments: '{}' }] },
    { role: 'tool', content: '结果', toolCallId: '2' },
  ];

  recordSeatAssistantResult(messages, '新回复', '先检查再回答', 2);

  assert.deepEqual(messages.at(-1), {
    role: 'assistant', content: '新回复',
    reasoning: '先检查再回答', reasoningContent: '再回答',
  });
});

test('seat history claims aggregated assistant content before the final answer', () => {
  const messages: SeatContextMessage[] = [
    {
      role: 'assistant', content: 'Before tools',
      toolCalls: [{ id: 'content-1', name: 'read_file', arguments: '{}' }],
    },
    { role: 'tool', content: 'file content', toolCallId: 'content-1' },
  ];

  recordSeatAssistantResult(messages, 'Before tools\n\nFinal answer', '');

  assert.deepEqual(messages.at(-1), { role: 'assistant', content: 'Final answer' });
});

test('中止与错误结果不进入工位历史', () => {
  const messages = [{ role: 'user' as const, content: '开始' }];

  recordSeatAssistantResult(messages, '[中止] 已停止', '未完成分析');
  recordSeatAssistantResult(messages, '[错误] 请求失败', '失败分析');

  assert.deepEqual(messages, [{ role: 'user', content: '开始' }]);
});
