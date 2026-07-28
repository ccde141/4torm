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

test('Ask 接续后的工具在重载后仍属于新的独立回复', () => {
  const display = contextToDisplay([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'read-1', name: 'read_file', arguments: '{}' },
      { id: 'ask-1', name: 'ask', arguments: '{"question":"继续吗？"}' },
    ] },
    { role: 'tool', content: 'done', toolCallId: 'read-1' },
    { role: 'tool', content: '继续', toolCallId: 'ask-1' },
    { role: 'assistant', content: '', toolCalls: [
      { id: 'run-1', name: 'run_command', arguments: '{}' },
      { id: 'edit-1', name: 'edit_file', arguments: '{}' },
    ] },
    { role: 'tool', content: 'done', toolCallId: 'run-1' },
    { role: 'tool', content: 'done', toolCallId: 'edit-1' },
  ]);

  assert.deepEqual(display.map(message => message.blocks?.map(block => (
    block.kind === 'tool' ? block.tool : block.kind
  ))), [
    ['read_file', 'ask'],
    ['run_command', 'edit_file'],
  ]);
});

test('等待 Ask 而取消的普通工具不会在重载后显示成功', () => {
  const [message] = contextToDisplay([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'search-1', name: 'mcp:tavily:tavily_search', arguments: '{}' },
    ] },
    { role: 'tool', content: '（因等待用户回复而取消，未执行）', toolCallId: 'search-1' },
  ]);

  assert.equal(message.blocks?.[0]?.kind, 'tool');
  assert.equal('status' in message.blocks![0] ? message.blocks![0].status : undefined, 'error');
});

test('普通结果提到未执行时不误判，delegate 与 contact 占位取消不显示成功', () => {
  const [message] = contextToDisplay([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'read-1', name: 'read_file', arguments: '{}' },
      { id: 'delegate-1', name: 'delegate', arguments: '{"task":"检查"}' },
      { id: 'contact-1', name: 'contact', arguments: '{"target":"研究员","message":"检查"}' },
    ] },
    { role: 'tool', content: '文件记录：该步骤尚未执行，但读取成功。', toolCallId: 'read-1' },
    { role: 'tool', content: '（因等待用户回复而取消，未执行）', toolCallId: 'delegate-1' },
    { role: 'tool', content: '（因等待用户回复而取消，未执行）', toolCallId: 'contact-1' },
  ]);

  assert.deepEqual(message.blocks?.map(block => 'status' in block ? block.status : undefined), [
    'success', 'error', 'error',
  ]);
});
