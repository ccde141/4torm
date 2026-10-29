import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../../types';
import { MonsoonMessageProjection } from './monsoon-projection';

const placeholder: ChatMessage = {
  id: 'run-a', inputRunId: 'run-a', role: 'assistant', content: '',
  timestamp: '2026-09-30T00:00:00.000Z', agentId: 'agent-a',
};

test('team wait heartbeats identify waiting members without creating a tool step or message', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'next');
  projection.apply({ type: 'heartbeat', phase: 'team-waiting', elapsed: 0, members: ['Collector'] });
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.messages[0].streamingPhase, 'team-waiting');
  assert.equal(projection.messages[0].streamingTool, 'Collector');
  assert.equal(projection.messages[0].toolSteps, undefined);
});

test('MCP screenshots survive stream completion, reload and conversation history reconstruction', async () => {
  const { buildConversationHistory } = await import('./conversation-history');
  const images = [{ id: 'image-a', name: 'screen.png', mimeType: 'image/png', size: 10 }];
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'next');
  projection.apply({ type: 'tool-call', tool: 'mcp:desktop:observe', args: { crop: [0, 0, 50, 50] } });
  projection.apply({ type: 'tool-result', tool: 'mcp:desktop:observe', result: '{"observation_id":"a"}', ok: true, toolImages: images });
  projection.apply({ type: 'answer', content: 'Seen' });
  const reloaded: ChatMessage[] = JSON.parse(JSON.stringify(projection.messages));
  assert.deepEqual(reloaded[0].toolSteps?.[0].toolImages, images);
  assert.deepEqual(buildConversationHistory(reloaded).find(message => message.role === 'tool')?.toolImages, images);
});

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

test('tool preparation is visible before complete arguments arrive', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'next');
  assert.deepEqual(projection.apply({ type: 'tool-progress', tool: 'write_file', argumentChars: 2400, elapsed: 1500 }),
    { flush: 'throttled', firstOutput: true });
  assert.equal(projection.messages[0].streamingPhase, 'tool-preparing');
  assert.equal(projection.messages[0].streamingArgumentChars, 2400);
  assert.equal(projection.messages[0].phaseElapsed, 2);
  assert.equal(projection.messages[0].toolSteps, undefined);
  projection.apply({ type: 'tool-call', tool: 'write_file', args: { path: 'a', content: 'full content' } });
  assert.equal(projection.messages[0].streamingPhase, 'tool-exec');
  assert.equal(projection.messages[0].toolSteps?.[0].args.content, 'full content');
});

test('text, tools and team reports retain received order across saving', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'next');
  projection.apply({ type: 'token', content: '先核对' });
  projection.apply({ type: 'tool-call', tool: 'framework_capability_cyclone', args: { action: 'inspect' } });
  projection.apply({ type: 'tool-result', result: 'found', ok: true });
  const report = { type: 'team-activity', id: 'report-event', stage: 'reported',
    memberId: 'member-a', runId: 'work-a', reportId: 'report-a', timestamp: placeholder.timestamp };
  projection.apply(report); projection.apply(report);
  projection.apply({ type: 'token', content: '然后汇报' });
  projection.apply({ type: 'answer', content: '先核对\n\n然后汇报' });
  const saved = JSON.parse(JSON.stringify(projection.messages[0])) as ChatMessage;
  assert.deepEqual(saved.activitySequence?.map(item => item.kind), ['text', 'tool', 'team', 'text']);
  assert.equal(saved.activitySequence?.filter(item => item.kind === 'team').length, 1);
  assert.equal(saved.toolSteps?.[0].result, 'found');
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

test('in-loop compaction preserves a single assistant while creating one stable boundary per committed marker', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'next');
  projection.apply({ type: 'token', content: '检查旧结果' });
  projection.apply({ type: 'tool-call', tool: 'read_file', args: { path: 'fixture' } });
  projection.apply({ type: 'tool-result', result: 'done', ok: true });
  const marker = { id: 'compact-in-loop', role: 'system', content: '四项交接',
    timestamp: placeholder.timestamp, type: 'compact-marker', contextExact: true,
    execution: { assistantId: 'run-a', toolOffset: 1 }, nativeContext: [{ role: 'system', content: '交接' }] };
  projection.apply({ type: 'context-compacted', revision: 3, marker });
  projection.apply({ type: 'tool-call', tool: 'read_file', args: { path: 'fixture-next' } });
  projection.apply({ type: 'tool-result', result: 'next-result', ok: true });
  projection.apply({ type: 'context-compacted', revision: 3, marker });
  projection.apply({ type: 'token', content: '继续当前任务' });
  const saved = JSON.parse(JSON.stringify(projection.messages)) as ChatMessage[];
  assert.equal(saved.filter(item => item.role === 'assistant').length, 1);
  assert.equal(saved.filter(item => item.role === 'user').length, 0);
  assert.deepEqual(saved.at(-1)?.activitySequence?.map(item => item.kind), ['text', 'tool', 'compact', 'tool', 'text']);
  assert.deepEqual(saved.at(-1)?.toolSteps?.map(item => item.result), ['done', 'next-result']);
  assert.equal(saved.filter(item => item.id === marker.id).length, 1);
});

test('compaction notices and rejected checkpoints do not start a fresh execution segment', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'next');
  projection.apply({ type: 'tool-call', tool: 'read_file', args: {} });
  projection.apply({ type: 'compaction-notice', message: '压缩已取消，保留原上下文' });
  assert.throws(() => projection.apply({ type: 'context-compacted', revision: 2, marker: {
    id: 'bad', role: 'system', content: '', timestamp: '', type: 'compact-marker', contextExact: true,
    nativeContext: [], execution: { assistantId: 'run-a', toolOffset: -1 },
  } }));
  assert.deepEqual(projection.messages[0].activitySequence?.map(item => item.kind), ['tool']);
});

test('replayed older checkpoints cannot move behind newer compactions in saved context history', () => {
  const projection = new MonsoonMessageProjection([placeholder], 'run-a', 'agent-a', () => 'next');
  const marker = (id: string, summary: string) => ({ id, role: 'system', content: summary,
    timestamp: placeholder.timestamp, type: 'compact-marker', contextExact: true,
    execution: { assistantId: 'run-a', toolOffset: 0, textOffset: 0 }, nativeContext: [{ role: 'system', content: summary }] });
  const first = marker('compact-first', '旧交接');
  projection.apply({ type: 'context-compacted', revision: 3, marker: first });
  projection.apply({ type: 'context-compacted', revision: 4, marker: marker('compact-second', '新交接') });
  const replayed = projection.apply({ type: 'context-compacted', revision: 3, marker: first });
  assert.deepEqual(projection.messages.map(item => item.id), ['compact-first', 'compact-second', 'run-a']);
  assert.equal(projection.messages.at(-1)?.activitySequence?.filter(item => item.kind === 'compact').length, 2);
  assert.equal(Object.hasOwn(replayed, 'usage'), false);
});
