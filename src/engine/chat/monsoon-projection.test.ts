import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../../types';
import { MonsoonMessageProjection } from './monsoon-projection';

const placeholder: ChatMessage = {
  id: 'run-a', inputRunId: 'run-a', role: 'assistant', content: '',
  timestamp: '2026-09-30T00:00:00.000Z', agentId: 'agent-a',
};

test('one projection handles output, tools and the final answer in order', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'ask-a');
  assert.equal(projection.apply({ type: 'reasoning', content: '想' }).flush, 'throttled');
  projection.apply({ type: 'token', content: '答' });
  assert.equal(projection.apply({ type: 'tool-call', tool: 'read_file', args: { path: 'a' } }).flush,
    'immediate');
  projection.apply({ type: 'tool-result', tool: 'read_file', result: 'ok', ok: true });
  projection.apply({ type: 'answer', content: '答案', rawContent: '答案' });
  const message = projection.messages[0]!;
  assert.equal(message.content, '答案');
  assert.equal(message.reasoningContent, '想');
  assert.equal(message.toolSteps?.[0]?.status, 'done');
  assert.equal(projection.content, '答');
});

test('ask, taskboard and usage are explicit projection effects', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'ask-a');
  const board = { revision: 1, items: [] };
  const tool = projection.apply({ type: 'tool-result', tool: 'task_board', result: 'ok',
    ok: true, meta: { taskboard: board } });
  assert.equal(tool.taskboard, board);
  const usage = projection.apply({ type: 'usage', usage: {
    promptTokens: 2, completionTokens: 3, totalTokens: 5,
  } });
  assert.deepEqual(usage.usage, { promptTokens: 2, completionTokens: 3, totalTokens: 5 });
  projection.apply({ type: 'ask', question: '继续？', options: ['是'] });
  assert.equal(projection.messages.at(-1)?.ask?.question, '继续？');
  assert.equal(projection.messages.at(-1)?.ask?.sourceRunId, 'run-a');
  assert.equal(Object.hasOwn(projection.messages.at(-1)!, 'inputRunId'), false);
});

test('missing provider usage explicitly clears the previous call count', () => {
  const projection = new MonsoonMessageProjection([], 'run-a', 'agent-a', () => 'next');
  assert.deepEqual(projection.apply({ type: 'usage', usage: null }), { usage: null });
});

test('compaction updates the save revision without discarding displayed raw history', () => {
  const old = { ...placeholder, id: 'old', content: '原文' };
  const projection = new MonsoonMessageProjection([old, placeholder], 'run-a', 'agent-a', () => 'next');
  const marker = { id: 'compact-a', role: 'system', content: '摘要',
    timestamp: placeholder.timestamp, type: 'compact-marker', contextExact: true,
    nativeContext: [{ role: 'system', content: '摘要' }, { role: 'user', content: '最新请求' }] };
  assert.deepEqual(projection.apply({ type: 'context-compacted', revision: 3, marker }),
    { flush: 'immediate', revision: 3, usage: null });
  assert.deepEqual(projection.messages.map(m => m.id), ['old', 'compact-a', 'run-a']);
  projection.apply({ type: 'compaction-notice', message: '压缩模型离线，已切换' });
  assert.equal(projection.messages.at(-1)?.compactionNotice, '压缩模型离线，已切换');
  assert.equal(projection.messages.at(-1)?.ask, undefined);
  projection.acceptHumanInput();
  assert.equal(projection.messages.at(-1)?.compactionNotice, undefined);
});

test('invalid compaction checkpoint is rejected rather than saved as a success', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'next');
  assert.throws(() => projection.apply({ type: 'context-compacted', revision: -1, marker: {} }));
});
