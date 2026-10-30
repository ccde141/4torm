import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { formatTextToolCall, formatTextToolResult } from '../text-tool-protocol.js';
import { estimateCompactionTokens } from './estimate.js';
import { splitCompactionMessages } from './split.js';

const options = { mode: 'full' as const, prefixRatio: 1 };
const system: ContextMessage = { role: 'system', content: 'Rules' };
const direction: ContextMessage = { role: 'user', origin: 'human', content: 'Inspect before writing.' };

test('a native resumed human answer retains its original ask call after later long tool work is summarized', () => {
  const ask: ContextMessage = { role: 'assistant', content: '',
    toolCalls: [{ id: 'ask-answer', name: 'ask', arguments: '{"question":"Which option?"}' }] };
  const answer: ContextMessage = { role: 'tool', origin: 'human', toolCallId: 'ask-answer', content: 'Use option B.' };
  const final: ContextMessage = { role: 'assistant', content: 'Current result' };
  const messages: ContextMessage[] = [system, direction, { role: 'assistant', content: '旧'.repeat(40_000) },
    ask, answer, { role: 'assistant', content: '新'.repeat(80_000) }, final];
  const plan = splitCompactionMessages(messages, options);
  assert.deepEqual(plan?.tail, [direction, ask, answer, final]);
  assert.deepEqual(plan?.retainedIndexes, [1, 3, 4, 6]);
  assert.equal(plan?.tail[1], ask);
  assert.equal(plan?.tail[2], answer);
  assert.ok(estimateCompactionTokens(plan!.tail) <= 30_000);
});

test('a human answer in the middle of a native batch retains every paired result', () => {
  const batch: ContextMessage = { role: 'assistant', content: '', toolCalls: [
    { id: 'ask-answer', name: 'ask', arguments: '{}' }, { id: 'file-result', name: 'read', arguments: '{}' },
  ] };
  const answer: ContextMessage = { role: 'tool', origin: 'human', toolCallId: 'ask-answer', content: 'Approved option B.' };
  const file: ContextMessage = { role: 'tool', toolCallId: 'file-result', content: '证'.repeat(10_000) };
  const messages: ContextMessage[] = [system, direction, batch, answer, file,
    { role: 'assistant', content: '新'.repeat(80_000) }];
  const plan = splitCompactionMessages(messages, options);
  assert.deepEqual(plan?.tail, [direction, batch, answer, file]);
  assert.deepEqual(plan?.retainedIndexes, [1, 2, 3, 4]);
  assert.deepEqual(plan?.tail.filter(message => message.role === 'tool').map(message => message.toolCallId),
    ['ask-answer', 'file-result']);
});

test('an oversized native batch enters the summary as a whole instead of copying only its human result', () => {
  const batch: ContextMessage = { role: 'assistant', content: '', toolCalls: [
    { id: 'ask-answer', name: 'ask', arguments: '{}' }, { id: 'file-result', name: 'read', arguments: '{}' },
  ] };
  const answer: ContextMessage = { role: 'tool', origin: 'human', toolCallId: 'ask-answer', content: 'Approved option B.' };
  const file: ContextMessage = { role: 'tool', toolCallId: 'file-result', content: '证'.repeat(40_000) };
  const messages: ContextMessage[] = [system, direction, batch, answer, file,
    { role: 'assistant', content: '新'.repeat(80_000) }];
  const plan = splitCompactionMessages(messages, options);
  assert.deepEqual(plan?.tail, [direction]);
  assert.ok(plan?.prefix.includes(batch));
  assert.ok(plan?.prefix.includes(answer));
  assert.ok(plan?.prefix.includes(file));
  assert.deepEqual(plan?.retainedIndexes, [1]);
});

test('a resumed text-tool human answer retains the text ask call without breaking its pairing', () => {
  const ask: ContextMessage = { role: 'assistant', content: formatTextToolCall('ask', { question: 'Which option?' }) };
  const answer: ContextMessage = { role: 'user', origin: 'human', content: formatTextToolResult('ask', 'Use option B.', true) };
  const messages: ContextMessage[] = [system, direction, ask, answer,
    { role: 'assistant', content: '新'.repeat(80_000) }];
  const plan = splitCompactionMessages(messages, options);
  assert.deepEqual(plan?.tail, [direction, ask, answer]);
  assert.deepEqual(plan?.retainedIndexes, [1, 2, 3]);
  assert.equal(plan?.tail[1], ask);
  assert.equal(plan?.tail[2], answer);
});

test('an unmatched legacy human tool result is not copied into an otherwise complete retained context', () => {
  const answer: ContextMessage = { role: 'tool', origin: 'human', toolCallId: 'missing-call', content: 'Use option B.' };
  const messages: ContextMessage[] = [system, direction, answer,
    { role: 'assistant', content: '新'.repeat(80_000) }];
  const plan = splitCompactionMessages(messages, options);
  assert.deepEqual(plan?.tail, [direction]);
  assert.ok(plan?.prefix.includes(answer));
});
