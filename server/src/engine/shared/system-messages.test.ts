import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSystemMessages } from './system-messages.js';

test('normalizes compact and reset summaries to one leading system message', () => {
  const messages = normalizeSystemMessages([
    { role: 'system', content: 'Agent role' },
    { role: 'user', content: 'Old request' },
    { role: 'system', content: 'Compact summary' },
    { role: 'assistant', content: 'Old answer' },
    { role: 'system', content: 'Reset summary' },
  ]);

  assert.deepEqual(messages, [
    { role: 'system', content: 'Agent role\n\nCompact summary\n\nReset summary' },
    { role: 'user', content: 'Old request' },
    { role: 'assistant', content: 'Old answer' },
  ]);
});

test('keeps user assistant and tool messages byte-for-byte and in order', () => {
  const history = [
    { role: 'user' as const, content: 'Read' },
    { role: 'assistant' as const, content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }] },
    { role: 'tool' as const, content: 'body', toolCallId: 'c1' },
  ];
  assert.deepEqual(normalizeSystemMessages(history), history);
});
