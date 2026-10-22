import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversationHistory } from './conversation-history.js';
import { hydratePendingRuns } from './pending-runs.js';
import { MonsoonMessageProjection } from './monsoon-projection.js';
import type { ChatSession } from '../../store/chat.js';

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

test('structured tool arguments survive stream projection, persistence and history replay', () => {
  const args = { count: 2, enabled: false, empty: null,
    items: ['first', { weight: 0.5 }], config: { labels: ['a', 'b'] } };
  const projection = new MonsoonMessageProjection([{
    id: 'structured-run', role: 'assistant', content: '', timestamp: '2026-01-01T00:00:00.000Z',
  }], 'structured-run', 'agent-a', () => 'next');
  projection.apply({ type: 'tool-call', tool: 'mcp__example__calculate', args });
  projection.apply({ type: 'tool-result', result: 'calculated', ok: true });
  const persisted = JSON.parse(JSON.stringify(projection.messages));

  assert.deepEqual(persisted[0].toolSteps[0].args, args);
  const history = buildConversationHistory(persisted);
  const call = history.find(message => message.toolCalls)?.toolCalls?.[0];
  assert.equal(call?.name, 'mcp__example__calculate');
  assert.deepEqual(JSON.parse(call?.arguments ?? '{}'), args);
});

test('recovered compaction retains display tools but feeds only later work into the model', () => {
  for (const hasLaterWork of [false, true]) {
    const timestamp = '2026-01-01T00:00:00.000Z';
    const session: ChatSession = { id: 'session-a', agentId: 'agent-a', agentName: 'A', title: 'Compact',
      model: 'model-a', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
      messages: [{ id: 'run-a', inputRunId: 'run-a', role: 'assistant', content: '', timestamp,
        runCommitted: false, contextExact: true, nativeContext: [{ role: 'tool', content: 'old-result' }] }] };
    const marker = { id: 'compact-a', role: 'system', type: 'compact-marker', content: 'summary',
      timestamp, contextExact: true, nativeContext: [{ role: 'system', content: 'summary' }] };
    const events = [
      { type: 'tool-call', tool: 'read_file', args: { path: 'old' } },
      { type: 'tool-result', result: 'old-result' },
      { type: 'context-compacted', marker, revision: 1 },
      ...(hasLaterWork ? [{ type: 'tool-call', tool: 'read_file', args: { path: 'new' } },
        { type: 'tool-result', result: 'new-result' }] : []),
    ];
    const run = { runId: 'run-a', truncated: true, events };
    const recovered = hydratePendingRuns(session, [run]);
    assert.equal(recovered.messages.find(message => message.id === 'run-a')?.toolSteps?.length,
      hasLaterWork ? 2 : 1);
    const history = buildConversationHistory(recovered.messages);
    assert.equal(history.some(message => message.role === 'tool' && message.content === 'old-result'), false);
    assert.equal(history.some(message => message.role === 'tool' && message.content === 'new-result'), hasLaterWork);
    assert.deepEqual(hydratePendingRuns(recovered, [run]), recovered);
  }
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

test('native context claims aggregated assistant content before the final answer', () => {
  const history = buildConversationHistory([{
    id: 'a2', role: 'assistant', content: 'Before tools\n\nFinal answer',
    timestamp: '2026-01-01T00:00:00.000Z',
    nativeContext: [
      {
        role: 'assistant', content: 'Before tools',
        toolCalls: [{ id: 'tc-2', name: 'read_file', arguments: '{}' }],
      },
      { role: 'tool', content: 'file content', toolCallId: 'tc-2' },
    ],
  }]);

  assert.deepEqual(history.at(-1), { role: 'assistant', content: 'Final answer' });
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

test('被停止的执行回灌已完成证据，并明确标记没有结果的工具与未完成状态', () => {
  const history = buildConversationHistory([{
    id: 'stopped-1', role: 'assistant', content: '已经完成第一步',
    timestamp: '2026-01-01T00:00:00.000Z', streamStopped: true,
    toolSteps: [
      { tool: 'write_file', args: { path: 'done.md' }, result: 'written', status: 'done' },
      { tool: 'run_command', args: { command: 'long task' }, status: 'running' },
    ],
  }]);

  assert.equal(history[1]?.content, 'written');
  assert.match(history[3]?.content ?? '', /执行被停止.*没有返回结果/);
  assert.match(history.at(-1)?.content ?? '', /上一轮执行被人类停止.*不代表任务完成/);
});
