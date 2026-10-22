import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNodeHistoryMessages, readNodeSnapshot, type NodeHistoryMessage } from './agent-chat-runtime';

test('节点重开读取快照后保留工具结果、错误与截图，不把工具协议显示为人类消息', async () => {
  const toolImages = [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }];
  const stored: NodeHistoryMessage[] = [{ role: 'user', content: '查看练习窗', messageId: 'human-a' },
    { role: 'assistant', content: '', messageId: 'assistant-a', toolSteps: [
      { tool: 'mcp:observe', args: {}, result: 'metadata', status: 'done', toolImages },
      { tool: 'mcp:act', args: { action: { kind: 'click', x: 1, y: 2 } }, result: 'STALE', status: 'error' },
    ] }, { role: 'assistant', content: '需要重新观察', messageId: 'answer-a' }];
  const snapshot = await readNodeSnapshot(new Response(JSON.stringify({ messages: stored,
    roundLog: [], busy: false, lastSeq: 8, workflowId: 'workflow-a', executionId: 'run-a' })),
    { workflowId: 'workflow-a', executionId: 'run-a' });
  const visible = projectNodeHistoryMessages(snapshot.messages, () => 'fallback');
  assert.deepEqual(visible.map(message => message.id), ['human-a', 'assistant-a', 'answer-a']);
  assert.deepEqual(visible[1].toolSteps?.[0].toolImages, toolImages);
  assert.equal(visible[1].toolSteps?.[1].status, 'error');
  assert.equal(visible[1].content, '');
  assert.equal(visible.length, 3);
});

test('压缩后的公开节点消息使用同一图片投影，旧工具角色不会生成额外对话气泡', () => {
  const messages = projectNodeHistoryMessages([
    { role: 'system', content: '[历史压缩记录]\n摘要' },
    { role: 'assistant', content: '', toolSteps: [{ tool: 'mcp:observe', args: {}, result: 'metadata',
      status: 'done', toolImages: [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }] }] },
    { role: 'tool', content: '旧后端工具原文' },
  ], () => 'fallback');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].toolSteps?.[0].toolImages?.[0].id, 'shot-a');
});
