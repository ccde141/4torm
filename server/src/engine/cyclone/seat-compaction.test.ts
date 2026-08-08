import assert from 'node:assert/strict';
import test from 'node:test';
import type { SeatContextMessage } from './types.js';
import {
  CYCLONE_COMPACT_MIN_TOKENS,
  planSeatCompaction,
} from './seat-compaction.js';

const user = (content: string): SeatContextMessage => ({ role: 'user', content });
const assistant = (content: string): SeatContextMessage => ({ role: 'assistant', content });

test('滚动压缩保留最近三个完整人类回合，不拆散工具调用链', () => {
  const messages: SeatContextMessage[] = [
    { role: 'system', content: '旧摘要' },
    user('第一轮'),
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'run_command', arguments: '{"cmd":"test"}' }] },
    { role: 'tool', content: '12 tests passed', toolCallId: 'call-1' },
    assistant('第一轮完成'),
    user('第二轮'), assistant('第二轮完成'),
    user('第三轮'), assistant('第三轮完成'),
    user('第四轮'), assistant('第四轮完成'),
  ];

  const result = planSeatCompaction(messages, CYCLONE_COMPACT_MIN_TOKENS);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.keptMessages, messages.slice(5));
  assert.deepEqual(result.archivedMessages, messages.slice(0, 5));
  assert.equal(result.keptTurnCount, 3);
  assert.match(result.summaryInput, /run_command/);
  assert.match(result.summaryInput, /12 tests passed/);
});

test('Ask 的工具结果和续答留在发起它的人类回合内', () => {
  const messages: SeatContextMessage[] = [
    user('第一轮'), assistant('完成'),
    user('第二轮'), assistant('完成'),
    user('第三轮'), assistant('完成'),
    user('第四轮'),
    { role: 'assistant', content: '', toolCalls: [{ id: 'ask-1', name: 'ask', arguments: '{"question":"继续？"}' }] },
    { role: 'tool', content: '继续', toolCallId: 'ask-1' },
    assistant('继续处理后的结论'),
  ];

  const result = planSeatCompaction(messages, CYCLONE_COMPACT_MIN_TOKENS);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.keptMessages, messages.slice(2));
  assert.equal(result.keptMessages.at(-1)?.content, '继续处理后的结论');
});

test('不足三个以上完整回合时不压缩', () => {
  const messages = [user('一'), assistant('答一'), user('二'), assistant('答二'), user('三')];
  const result = planSeatCompaction(messages, CYCLONE_COMPACT_MIN_TOKENS);
  assert.deepEqual(result, {
    ok: false,
    reason: 'not-enough-turns',
    estimatedTokens: CYCLONE_COMPACT_MIN_TOKENS,
    turnCount: 3,
  });
});

test('真实 token 不足压缩门槛时保持原上下文', () => {
  const messages = [user('一'), assistant('答一'), user('二'), assistant('答二'), user('三'), assistant('答三'), user('四')];
  const result = planSeatCompaction(messages, 7999);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'below-threshold');
  assert.equal(result.estimatedTokens, 7999);
});

test('没有真实 token 时估算包含工具参数与工具结果', () => {
  const large = 'x'.repeat(30_000);
  const messages: SeatContextMessage[] = [
    user('一'), { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'run_command', arguments: large }] },
    { role: 'tool', content: large, toolCallId: 'c1' },
    user('二'), assistant('答二'), user('三'), assistant('答三'), user('四'),
  ];
  const result = planSeatCompaction(messages);
  assert.equal(result.ok, true);
  assert.ok(result.estimatedTokens >= CYCLONE_COMPACT_MIN_TOKENS);
});
