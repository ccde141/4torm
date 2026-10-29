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
  const result = visibleTideMessages(session).find(message => message.role === 'tool-result')!;
  assert.equal(result.role, 'tool-result');
  assert.deepEqual(result.toolImages, toolImages);
  assert.deepEqual(JSON.parse(result.content), { tool: 'mcp:observe', result: 'metadata', ok: true });
});

test('Tide screen retains original history and restores only legacy snapshot records missing from raw history', () => {
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '日报',
    model: 'model', systemPrompt: '', createdAt: '', updatedAt: '', messages: [
      { id: 'old', role: 'user', content: '旧原文' },
      { id: 'marker', role: 'system', content: '摘要', type: 'compact-marker', nativeContext: [
        { role: 'system', content: '摘要' }, { role: 'user', content: '最近任务' },
        { role: 'assistant', content: '最近结果' }] },
      { id: 'new', role: 'user', content: '新任务' }] };
  assert.deepEqual(visibleTideMessages(session).map(message => message.content), ['旧原文', '摘要', '最近任务', '最近结果', '新任务']);
  assert.equal(session.messages[0].content, '旧原文');
  assert.equal(visibleTideMessages(session)[1].type, 'compact-marker');
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
  assert.deepEqual(visibleTideMessages(session).map(message => message.role), ['system', 'tool-call', 'tool-result']);
  assert.match(visibleTideMessages(session)[1].content, /"tool":"read_file"/);
});

test('multiple successful boundaries retain distinct raw bubbles without replaying human or tail copies', () => {
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '巡检',
    model: 'model', systemPrompt: '', createdAt: '', updatedAt: '', messages: [
      { id: 'human', role: 'user', content: '保留原话' },
      { id: 'before', role: 'assistant', content: '压缩前过程' },
      { id: 'one', role: 'system', type: 'compact-marker', content: '第一份交接', nativeContext: [
        { role: 'system', content: '第一份交接' }, { role: 'user', content: '保留原话' }] },
      { id: 'middle', role: 'assistant', content: '第一段接续' },
      { id: 'two', role: 'system', type: 'compact-marker', content: '第二份交接', nativeContext: [
        { role: 'system', content: '第二份交接' }, { role: 'user', content: '保留原话' },
        { role: 'assistant', content: '第一段接续' }] },
      { id: 'after', role: 'assistant', content: '第二段接续' },
      { id: 'sync', role: 'system', type: 'compact-marker', content: '[历史压缩记录]', contextOnly: true,
        nativeContext: [{ role: 'system', content: '第二份交接' }, { role: 'assistant', content: '第二段接续' }] },
    ] };
  const original = structuredClone(session);
  const visible = visibleTideMessages(session);
  assert.deepEqual(visible.map(message => message.id), ['human', 'before', 'one', 'middle', 'two', 'after']);
  assert.deepEqual(visibleTideMessages(structuredClone(session)), visible);
  assert.deepEqual(session, original);
});

test('raw legacy screenshot results keep their image without replaying the same native result', () => {
  const toolImages = [{ id: 'shot-42', name: 'desktop.png', mimeType: 'image/png', size: 128 }];
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '巡检',
    model: 'model', systemPrompt: '', createdAt: '', updatedAt: '', messages: [
      { id: 'call', role: 'tool-call', content: JSON.stringify({ tool: 'mcp:observe', args: {} }) },
      { id: 'result', role: 'tool-result', content: JSON.stringify({ tool: 'mcp:observe', result: 'metadata', ok: true, toolImages }) },
      { id: 'marker', role: 'system', type: 'compact-marker', content: '交接', nativeContext: [
        { role: 'assistant', content: '', toolCalls: [{ id: 'native-42', name: 'mcp:observe', arguments: '{}' }] },
        { role: 'tool', content: 'metadata', toolCallId: 'native-42', toolImages }] },
    ] };
  const visible = visibleTideMessages(session);
  assert.deepEqual(visible.map(message => message.role), ['tool-call', 'tool-result', 'system']);
  assert.deepEqual(visible[1].toolImages, toolImages);
});
