import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from './types.js';
import { deleteContextMessage, editContextMessage } from './message-mutations.js';

test('编辑消息只替换目标内容', () => {
  const messages: ContextMessage[] = [
    { role: 'user', content: 'old' },
    { role: 'assistant', content: 'reply' },
  ];
  const changed = editContextMessage(messages, 0, 'new');
  assert.equal(changed, true);
  assert.deepEqual(messages, [
    { role: 'user', content: 'new' },
    { role: 'assistant', content: 'reply' },
  ]);
});

test('删除 assistant 时同时删除对应 tool result', () => {
  const messages: ContextMessage[] = [
    { role: 'user', content: 'go' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{}' }],
    },
    { role: 'tool', content: 'result', toolCallId: 'tc-1' },
    { role: 'assistant', content: 'done' },
  ];
  const changed = deleteContextMessage(messages, 1);
  assert.equal(changed, true);
  assert.deepEqual(messages, [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'done' },
  ]);
});

test('越界索引不改变消息数组', () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'keep' }];
  assert.equal(editContextMessage(messages, 3, 'new'), false);
  assert.equal(deleteContextMessage(messages, -1), false);
  assert.deepEqual(messages, [{ role: 'user', content: 'keep' }]);
});
