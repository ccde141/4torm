import assert from 'node:assert/strict';
import test from 'node:test';
import { contextToDisplay } from './messageDisplay.js';

test('ordinary content preserves legacy protocol literals', () => {
  const content = 'example: <action tool="read_file">{}</action>';
  const [message] = contextToDisplay([{ role: 'assistant', content }]);
  assert.equal(message.content, content);
});

test('文本联络和查询按保存的JSON还原原卡片及最终回复，保持消息原索引', () => {
  const display = contextToDisplay([
    { role: 'user', content: '请联络资料员' },
    { role: 'assistant', content: JSON.stringify({ type: 'tool_call', name: 'contact',
      arguments: { target: '资料员', message: '核对资料' } }) },
    { role: 'user', content: JSON.stringify({ type: 'tool_result', name: 'contact', ok: true,
      content: JSON.stringify({ contactId: 'c-1', status: 'running', delivered: true }) }) },
    { role: 'assistant', content: '```tool_call\n' + JSON.stringify({ type: 'tool_call', name: 'contact_read',
      arguments: { contactId: 'c-1' } }) + '\n```' },
    { role: 'user', content: JSON.stringify({ type: 'tool_result', name: 'contact_read', ok: true,
      content: JSON.stringify({ contactId: 'c-1', status: 'completed', delivered: true, reply: '资料已核对' }) }) },
    { role: 'assistant', content: '已完成核验。' },
  ]);
  assert.deepEqual(display.map(message => message.sourceIndex), [0, 1, 3, 5]);
  const contact = display[1].blocks?.[0];
  assert.equal(contact?.kind, 'contact');
  assert.equal(contact?.kind === 'contact' ? contact.communicationId : null, 'c-1');
  assert.equal(contact?.kind === 'contact' ? contact.status : null, 'success');
  assert.equal(contact?.kind === 'contact' ? contact.reply : null, '资料已核对');
  assert.equal(display[2].blocks?.[0].kind, 'tool');
  assert.equal(display[3].content, '已完成核验。');
});

test('文本联络忙线按真实失败显示，不消耗不匹配的人类消息或其他工具协议', () => {
  const ordinary = JSON.stringify({ type: 'tool_result', name: 'other', ok: true, content: '人类引用' });
  const display = contextToDisplay([
    { role: 'assistant', content: JSON.stringify({ type: 'tool_call', name: 'contact', arguments: { target: '资料员' } }) },
    { role: 'user', content: JSON.stringify({ type: 'tool_result', name: 'contact', ok: false,
      content: JSON.stringify({ contactId: 'c-busy', status: 'busy', delivered: false }) }) },
    { role: 'user', content: ordinary },
    { role: 'assistant', content: JSON.stringify({ type: 'tool_call', name: 'read_file', arguments: { path: 'a' } }) },
  ]);
  const contact = display[0].blocks?.[0];
  assert.equal(contact?.kind === 'contact' ? contact.status : null, 'error');
  assert.equal(contact?.kind === 'contact' ? contact.delivered : null, false);
  assert.equal(display[1].role, 'user');
  assert.equal(display[1].content, ordinary);
  assert.match(display[2].content, /read_file/);
});
