import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversationHistory } from './conversation-history.js';

test('persisted native context is replayed before final assistant reasoning', () => {
  const history = buildConversationHistory([{
    id: 'a1', role: 'assistant', content: '最终答案',
    timestamp: '2026-01-01T00:00:00.000Z',
    reasoningContent: '先读文件再总结',
    nativeContext: [
      {
        role: 'assistant', content: '', reasoningContent: '先读文件',
        toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{}' }],
      },
      { role: 'tool', content: '文件内容', toolCallId: 'tc-1' },
    ],
  }]);

  assert.deepEqual(history, [
    {
      role: 'assistant', content: '', reasoningContent: '先读文件',
      toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{}' }],
    },
    { role: 'tool', content: '文件内容', toolCallId: 'tc-1' },
    { role: 'assistant', content: '最终答案', reasoningContent: '再总结' },
  ]);
});

test('独立工具卡使用结构化历史而不生成文本标签', () => {
  const history = buildConversationHistory([{
    id: 'tool-1', role: 'assistant', content: '读取文件',
    timestamp: '2026-01-01T00:00:00.000Z',
    toolCall: {
      toolName: 'read_file', params: { filePath: 'README.md' },
      result: '文件内容', status: 'success',
    },
  }]);

  assert.deepEqual(history, [
    {
      role: 'assistant', content: '',
      toolCalls: [{
        id: 'tool-1-single', name: 'read_file',
        arguments: JSON.stringify({ filePath: 'README.md' }),
      }],
    },
    { role: 'tool', content: '文件内容', toolCallId: 'tool-1-single' },
  ]);
});

test('用户消息中的图片随文字进入模型上下文', () => {
  const images = [{
    id: 'image-1', name: 'screen.png', mimeType: 'image/png',
    size: 4,
  }];
  const history = buildConversationHistory([{
    id: 'user-1', role: 'user', content: '看看这张图', images,
    timestamp: '2026-01-01T00:00:00.000Z',
  }]);

  assert.deepEqual(history, [{ role: 'user', content: '看看这张图', images }]);
});
