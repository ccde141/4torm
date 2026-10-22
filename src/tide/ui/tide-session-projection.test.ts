import assert from 'node:assert/strict';
import test from 'node:test';
import type { TideSession } from '../../api/tide';
import { visibleTideMessages } from './tide-session-projection';

test('压缩保留区的原生截图结果恢复为可读取的工具图片引用', () => {
  const toolImages = [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }];
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '巡检',
    model: 'model', systemPrompt: '', createdAt: '', updatedAt: '', messages: [
      { id: 'marker', role: 'system', content: '摘要', type: 'compact-marker', nativeContext: [
        { role: 'assistant', content: '', toolCalls: [{ id: 'call-a', name: 'mcp:observe', arguments: '{}' }] },
        { role: 'tool', content: 'metadata', toolCallId: 'call-a', toolImages }] }] };
  const result = visibleTideMessages(session).find(message => message.role === 'tool-result');
  assert.deepEqual(result?.toolImages, toolImages);
  assert.equal(JSON.parse(result!.content).tool, 'mcp:observe');
});

test('带框架截图引用的文本工具回执不会在压缩保留区冒充人类消息', () => {
  const toolImages = [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }];
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '巡检',
    model: 'model', systemPrompt: '', createdAt: '', updatedAt: '', messages: [
      { id: 'marker', role: 'system', content: '摘要', type: 'compact-marker', nativeContext: [
        { role: 'user', content: JSON.stringify({ type: 'tool_result', name: 'mcp:observe', content: 'metadata', ok: true }), toolImages }] }] };
  const result = visibleTideMessages(session)[0];
  assert.equal(result.role, 'tool-result');
  assert.deepEqual(result.toolImages, toolImages);
  assert.deepEqual(JSON.parse(result.content), { tool: 'mcp:observe', result: 'metadata', ok: true });
});

test('Tide screen consumes exact compressed history and leaves original records intact', () => {
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '日报',
    model: 'model', systemPrompt: '', createdAt: '', updatedAt: '', messages: [
      { id: 'old', role: 'user', content: '旧原文' },
      { id: 'marker', role: 'system', content: '摘要', type: 'compact-marker', nativeContext: [
        { role: 'system', content: '摘要' }, { role: 'user', content: '最近任务' },
        { role: 'assistant', content: '最近结果' }] },
      { id: 'new', role: 'user', content: '新任务' }] };
  assert.deepEqual(visibleTideMessages(session).map(message => message.content), ['摘要', '最近任务', '最近结果', '新任务']);
  assert.equal(session.messages[0].content, '旧原文');
  assert.equal(visibleTideMessages(session)[0].type, 'compact-marker');
});

test('a compacted native tool chain keeps its call, result and failure status visible', () => {
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '巡检',
    model: 'model', systemPrompt: '', createdAt: '', updatedAt: '', messages: [
      { id: 'marker', role: 'system', content: '摘要', type: 'compact-marker', nativeContext: [
        { role: 'system', content: '摘要' },
        { role: 'assistant', content: '检查目录', toolCalls: [{ id: 'call-1', name: 'list_directory', arguments: '{"path":"./src"}' }] },
        { role: 'tool', toolCallId: 'call-1', toolOk: false, content: '目录不存在' },
        { role: 'assistant', content: '需要确认目录' }] }] };
  const messages = visibleTideMessages(session);
  assert.deepEqual(messages.map(message => message.role), ['system', 'assistant', 'tool-call', 'tool-result', 'assistant']);
  assert.deepEqual(JSON.parse(messages[2].content), { tool: 'list_directory', args: { path: './src' } });
  assert.deepEqual(JSON.parse(messages[3].content), { tool: 'list_directory', result: '目录不存在', ok: false });
});

test('recorded text-mode tool evidence in a retained tail returns to its existing tool card shape', () => {
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '巡检',
    model: 'model', systemPrompt: '', createdAt: '', updatedAt: '', messages: [
      { id: 'marker', role: 'system', content: '摘要', type: 'compact-marker', nativeContext: [
        { role: 'user', content: '[已记录的 tool-call]\n{"tool":"read_file","args":{"path":"./a.md"}}' },
        { role: 'user', content: '[已记录的 tool-result]\n{"tool":"read_file","result":"content","ok":true}' }] }] };
  assert.deepEqual(visibleTideMessages(session).map(message => message.role), ['tool-call', 'tool-result']);
  assert.match(visibleTideMessages(session)[0].content, /"tool":"read_file"/);
});
