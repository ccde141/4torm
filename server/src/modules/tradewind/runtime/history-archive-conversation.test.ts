import assert from 'node:assert/strict';
import test from 'node:test';
import { projectArchivedConversation } from './history-archive-conversation.js';

test('归档公开投影保留原生、文本及会议工具图片引用，不夹带图片字节', () => {
  const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  const native = projectArchivedConversation([{ role: 'tool', content: 'native', toolImages }], false);
  const text = projectArchivedConversation([{ role: 'user', toolImages,
    content: JSON.stringify({ type: 'tool_result', name: 'observe', content: 'text', ok: true }) }], false);
  const meeting = projectArchivedConversation([{ speaker: 'Agent', content: 'reviewed',
    toolCalls: [{ tool: 'observe', args: {}, result: 'meeting', toolImages }] }], true);
  for (const visible of [native, text, meeting]) {
    assert.deepEqual(visible.find(message => message.role === 'tool')?.toolImages, toolImages);
    assert.doesNotMatch(JSON.stringify(visible), /base64|dataUrl/);
  }
});

test('文本工具调用与工具结果保留实际内容，不作为人类输入或机器控制JSON展示', () => {
  const visible = projectArchivedConversation([
    { role: 'user', content: '人类问题' },
    { role: 'assistant', content: JSON.stringify({ type: 'tool_call', name: 'read_file', arguments: { path: 'real.ts' } }) },
    { role: 'user', content: JSON.stringify({ type: 'tool_result', name: 'read_file', content: '实际结果', ok: true }) },
    { role: 'assistant', content: '实际答复', reasoningContent: 'PRIVATE_REASONING' },
  ], false);
  assert.deepEqual(visible.map(item => item.role), ['user', 'tool', 'tool', 'assistant']);
  assert.equal(visible[1].toolName, 'read_file');
  assert.equal(visible[2].content, '实际结果');
  assert.doesNotMatch(JSON.stringify(visible), /PRIVATE_|tool_call|tool_result/);
});

test('会议实际已存公共与助理会话分别投影，不泄漏系统注入或推理原文', () => {
  const visible = projectArchivedConversation({
    publicMessages: [{ speaker: '[系统信息]', content: 'PRIVATE_ENV' },
      { speaker: '研究员', content: '公开答复', rawContent: 'PRIVATE_RAW', reasoning: 'PRIVATE_REASONING',
        toolCalls: [{ tool: 'read_file', args: { path: 'real.ts' }, result: '真实工具结果', meta: 'PRIVATE_META' }] }],
    chairMessages: [{ role: 'system', content: 'PRIVATE_PROMPT' }, { role: 'user', content: '实际私聊问题' },
      { role: 'assistant', content: '实际私聊答复', reasoningContent: 'PRIVATE_THINKING' }],
  }, true);
  assert.ok(visible.some(item => item.scope === 'public' && item.content === '公开答复'));
  assert.ok(visible.some(item => item.scope === 'public' && item.toolName === 'read_file' && item.content.includes('真实工具结果')));
  assert.ok(visible.some(item => item.scope === 'chair' && item.content === '实际私聊答复'));
  assert.doesNotMatch(JSON.stringify(visible), /PRIVATE_|rawContent|reasoning|meta/);
});
