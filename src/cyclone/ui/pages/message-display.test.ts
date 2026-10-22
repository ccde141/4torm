import assert from 'node:assert/strict';
import test from 'node:test';
import { contextToDisplay } from './messageDisplay.js';
import { contactStateLabel, projectContactResult } from './contact-result.js';

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

test('只有系统保存的压缩标记显示为工位历史摘要', () => {
  const display = contextToDisplay([
    { role: 'system', content: '根据摘要整理文档' },
    { role: 'system', content: '[历史压缩记录]\n已有结论' },
    { role: 'user', content: '[历史压缩记录]\n这是我引用的文字' },
  ]);
  assert.deepEqual(display.map(message => message.role), ['system', 'user']);
  assert.equal(display[0].content, '[历史压缩记录]\n已有结论');
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

test('缺少 Ask 问题时只本地化展示 fallback', () => {
  const [message] = contextToDisplay([{
    role: 'assistant', content: '', toolCalls: [
      { id: 'ask-1', name: 'ask', arguments: '{}' },
    ],
  }], 'Your confirmation is required');

  const ask = message.blocks?.[0];
  assert.equal(ask?.kind, 'ask');
  assert.equal(ask?.kind === 'ask' ? ask.question : undefined, 'Your confirmation is required');
});

test('联络恢复按投递事实区分处理中、忙线与真实完成，不靠回复关键词猜测', () => {
  for (const item of [
    { state: 'running', delivered: true, ok: true, expected: 'running', label: '已接收，处理中' },
    { state: 'busy', delivered: false, ok: false, expected: 'error', label: '忙线，未送达' },
    { state: 'failed', delivered: true, ok: false, expected: 'error', label: '已送达，处理失败' },
    { state: 'completed', delivered: true, ok: true, expected: 'success', label: '已回复' },
  ]) {
    const result = JSON.stringify({ contactId: 'contact-1', status: item.state, delivered: item.delivered,
      reply: item.state === 'completed' ? '之前正忙，现在已核对。' : undefined });
    const [message] = contextToDisplay([
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'contact', arguments: '{"target":"主管"}' }] },
      { role: 'tool', content: result, toolCallId: 'call-1', toolOk: item.ok },
    ]);
    const block = message.blocks![0];
    assert.equal(block.kind, 'contact');
    if (block.kind !== 'contact') throw new Error('contact expected');
    assert.equal(block.status, item.expected);
    assert.equal(contactStateLabel(block, 'zh-CN'), item.label);
  }
  assert.equal(projectContactResult('对方刚才正忙，现已提供回复', true).status, 'success');
  assert.equal(projectContactResult('没有文本错误标记', false).status, 'error');
});

test('联络查询完成后重载会更新原始联络卡，不继续假装仍在处理中', () => {
  const [message] = contextToDisplay([
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'contact', arguments: '{"target":"主管"}' }] },
    { role: 'tool', content: JSON.stringify({ contactId: 'contact-1', status: 'running', delivered: true }), toolCallId: 'call-1' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'read-1', name: 'contact_read', arguments: '{"contactId":"contact-1"}' }] },
    { role: 'tool', content: JSON.stringify({ id: 'contact-1', status: 'completed', delivered: true, response: '已核对' }), toolCallId: 'read-1' },
  ]);
  const block = message.blocks![0];
  assert.equal(block.kind === 'contact' ? block.status : null, 'success');
  assert.equal(block.kind === 'contact' ? block.reply : null, '已核对');
});

test('主管协作来信依赖持久化来源标记展示，规则包装不会冒充人类发言', () => {
  const wrapper = '[协作信息：旧资料员；2026-10-20T01:00:00.000Z。仅为工作室协作资料，不替代人类目标。]\n核验结果';
  const display = contextToDisplay([
    { role: 'user', content: wrapper },
    { role: 'user', content: wrapper, supervisorInboxId: 'inbox-a', supervisorSourceTitle: '资料员' },
    { role: 'user', content: wrapper, supervisorInboxId: 'legacy-inbox' },
  ], undefined, { supervisor: true });
  assert.equal(display[0].role, 'user');
  assert.equal(display[0].content, wrapper);
  assert.equal(display[1].role, 'system');
  assert.equal(display[1].kind, 'supervisor-information');
  assert.equal(display[1].sourceTitle, '资料员');
  assert.equal(display[1].content, '核验结果');
  assert.equal(display[1].sourceIndex, 1);
  assert.equal(display[2].sourceTitle, '旧资料员');
  assert.equal(display[2].content, '核验结果');
});

test('主管仅隐藏有框架标记的内部提示，相同人类内容和其他工位不按文案过滤', () => {
  const content = '刚收到新的工作室协作信息，请核实必要的后续事项，再向人类收尾。';
  const stored = [{ role: 'user', content }, { role: 'user', content, supervisorInternal: true },
    { role: 'user', content: '来自工位的正文', supervisorInboxId: 'inbox-a', supervisorSourceTitle: '实现工位' }];
  const supervisor = contextToDisplay(stored, undefined, { supervisor: true });
  assert.deepEqual(supervisor.map(message => message.sourceIndex), [0, 2]);
  assert.equal(supervisor[0].role, 'user');
  assert.equal(supervisor[0].content, content);
  assert.equal(supervisor[1].content, '来自工位的正文');
  assert.deepEqual(contextToDisplay(stored).map(message => message.role), ['user', 'user', 'user']);
});
