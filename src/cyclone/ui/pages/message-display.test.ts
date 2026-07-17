import assert from 'node:assert/strict';
import test from 'node:test';
import { contextToDisplay } from './messageDisplay.js';

test('显示消息保留原始 ContextMessage 索引，跳过 tool result 后仍可编辑删除', () => {
  const display = contextToDisplay([
    { role: 'user', content: 'question' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{}' }] },
    { role: 'tool', content: 'result', toolCallId: 'tc-1' },
    { role: 'assistant', content: 'answer' },
  ]);
  assert.deepEqual(display.map(message => message.sourceIndex), [0, 1, 3]);
});
