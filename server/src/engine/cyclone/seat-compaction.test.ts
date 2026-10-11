import assert from 'node:assert/strict';
import test from 'node:test';
import { planSeatCompaction } from './seat-compaction.js';

const messages = [
  { role: 'system' as const, content: '旧摘要' },
  { role: 'user' as const, content: '第一轮' },
  { role: 'assistant' as const, content: '', toolCalls: [{ id: 'c1', name: 'run_command', arguments: '{}' }] },
  { role: 'tool' as const, content: '结果', toolCallId: 'c1' },
  { role: 'assistant' as const, content: '第一轮完成' },
  { role: 'user' as const, content: '最后一轮' },
  { role: 'assistant' as const, content: '最后一轮完成' },
];

test('人类主动压缩包含全部完整历史及旧摘要，不设门槛或固定保留轮数', () => {
  const plan = planSeatCompaction(messages, 100);
  assert.ok(plan.ok);
  assert.deepEqual(plan.archivedMessages, messages);
  assert.deepEqual(plan.keptMessages, []);
  assert.equal(plan.keptTurnCount, 0);
  assert.match(plan.summaryInput, /run_command/);
  assert.match(plan.summaryInput, /最后一轮完成/);
});

test('未完成原生工具链保留原样，不把 tool_calls 与配对结果拆开', () => {
  const pending = [...messages, { role: 'assistant' as const, content: '',
    toolCalls: [{ id: 'pending', name: 'ask', arguments: '{}' }] }];
  const plan = planSeatCompaction(pending);
  assert.ok(plan.ok);
  assert.deepEqual(plan.keptMessages, pending.slice(messages.length));
});

test('空会话不能伪装为成功压缩', () => {
  assert.equal(planSeatCompaction([]).ok, false);
});
