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

test('工位异步回执可见且不会被识别为归档摘要', () => {
  const [receipt] = contextToDisplay([{
    role: 'system', kind: 'dispatch-receipt', dispatchId: 'dispatch-a', content: '任务完成',
  }]);
  assert.equal(receipt.kind, 'dispatch-receipt');
  assert.equal(receipt.dispatchId, 'dispatch-a');
  assert.equal(receipt.content, '任务完成');
});

test('工位最终回复重载后保留独立思考内容', () => {
  const [message] = contextToDisplay([{
    role: 'assistant', content: '最终回复', reasoning: '先分析，再作答。',
  }]);
  assert.equal(message.content, '最终回复');
  assert.equal(message.reasoning, '先分析，再作答。');
});
