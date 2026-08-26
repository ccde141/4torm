import assert from 'node:assert/strict';
import test from 'node:test';
import { prependSystemPrompt } from './context-messages.js';

test('compacted history is folded into the single leading system message', () => {
  const messages = prependSystemPrompt('Agent role', [
    { role: 'system', content: '[历史上下文摘要]\nSummary' },
    { role: 'user', content: 'Continue' },
  ]);

  assert.deepEqual(messages, [
    { role: 'system', content: 'Agent role\n\n[历史上下文摘要]\nSummary' },
    { role: 'user', content: 'Continue' },
  ]);
  assert.equal(messages.filter(message => message.role === 'system').length, 1);
});

test('ordinary history order and tool metadata remain unchanged', () => {
  const history = [
    { role: 'user' as const, content: 'Read' },
    { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{}' }] },
    { role: 'tool' as const, content: 'data', toolCallId: 'call-1' },
  ];

  const messages = prependSystemPrompt('Agent role', history);
  assert.deepEqual(messages.slice(1), history);
});
