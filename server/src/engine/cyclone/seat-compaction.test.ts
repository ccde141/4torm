import assert from 'node:assert/strict';
import test from 'node:test';
import { planSeatCompaction } from './seat-compaction.js';

const messages = [
  { role: 'system' as const, content: '旧摘要' },
  { role: 'user' as const, content: '第一轮' },
  { role: 'assistant' as const, content: '', toolCalls: [{ id: 'c1', name: 'run_command', arguments: '{}' }] },
  { role: 'tool' as const, content: '结果', toolCallId: 'c1' },
  { role: 'assistant' as const, content: '第一轮完成' },
  { role: 'user' as const, content: '第二轮' },
  { role: 'assistant' as const, content: '第二轮完成' },
  { role: 'user' as const, content: '第三轮' },
  { role: 'assistant' as const, content: '第三轮完成' },
  { role: 'user' as const, content: '第四轮' },
  { role: 'assistant' as const, content: '第四轮完成' },
  { role: 'user' as const, content: '最后一轮' },
  { role: 'assistant' as const, content: '最后一轮完成' },
];

test('人类主动压缩旧摘要与早期历史，最近四轮回复和工具过程原样保留', () => {
  const plan = planSeatCompaction(messages, 100);
  assert.ok(plan.ok);
  assert.deepEqual(plan.archivedMessages, messages.slice(0, 5));
  assert.deepEqual(plan.keptMessages, messages.slice(5));
  assert.equal(plan.keptTurnCount, 4);
  assert.match(plan.summaryInput, /run_command/);
  assert.doesNotMatch(plan.summaryInput, /最后一轮完成/);
});

test('未完成原生工具链保留原样，不把 tool_calls 与配对结果拆开', () => {
  const pending = [...messages, { role: 'assistant' as const, content: '',
    toolCalls: [{ id: 'pending', name: 'ask', arguments: '{}' }] }];
  const plan = planSeatCompaction(pending);
  assert.ok(plan.ok);
  assert.deepEqual(plan.keptMessages, pending.slice(5));
});

test('空会话不能伪装为成功压缩', () => {
  assert.equal(planSeatCompaction([]).ok, false);
});
