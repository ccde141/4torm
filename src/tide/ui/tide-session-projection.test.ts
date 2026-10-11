import assert from 'node:assert/strict';
import test from 'node:test';
import type { TideSession } from '../../api/tide';
import { visibleTideMessages } from './tide-session-projection';

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
  assert.deepEqual(messages.map(message => message.role), ['assistant', 'assistant', 'tool-call', 'tool-result', 'assistant']);
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
