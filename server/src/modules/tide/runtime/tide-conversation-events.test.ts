import assert from 'node:assert/strict';
import test from 'node:test';
import { createTideEventState } from './tide-conversation-events.js';

test('潮汐每次 ReAct 模型返回即串行发布并累计，未知调用清除最新值', async () => {
  const written: Array<number | null> = [];
  const state = createTideEventState(async usage => {
    await Promise.resolve();
    written.push(usage?.totalTokens ?? null);
  });
  state.onEvent({ type: 'usage', usage: {
    promptTokens: 20, completionTokens: 2, totalTokens: 22 } });
  state.onEvent({ type: 'usage', usage: null });
  state.onEvent({ type: 'usage', usage: {
    promptTokens: 30, completionTokens: 3, totalTokens: 33 } });
  await state.flush();
  assert.deepEqual(written, [22, null, 33]);
  assert.deepEqual(state.snapshot().usage, { calls: 3, reportedCalls: 2,
    latest: { promptTokens: 30, completionTokens: 3, totalTokens: 33 },
    total: { promptTokens: 50, completionTokens: 5, totalTokens: 55 } });
});

test('Tide keeps generated MCP media context and ordered display references', () => {
  const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  const nativeContext = [{ role: 'tool' as const, content: 'metadata', toolCallId: 'call-a', toolImages }];
  const state = createTideEventState();
  state.onEvent({ type: 'tool-call', tool: 'mcp:demo:observe', args: {} });
  state.onEvent({ type: 'tool-result', tool: 'mcp:demo:observe', result: 'metadata', ok: true, toolImages });
  state.onEvent({ type: 'answer', content: 'done', rawContent: 'done', native: false, nativeContext });
  assert.deepEqual(state.snapshot().toolContext, nativeContext);
  assert.deepEqual(state.snapshot().toolCalls[0].toolImages, toolImages);
  assert.deepEqual(JSON.parse(state.snapshot().intermediate[1].content).toolImages, toolImages);
  assert.deepEqual(state.snapshot().intermediate[1].toolImages, toolImages);
  assert.notEqual(state.snapshot().toolContext, nativeContext);
});

test('display snapshots finish prior response bubbles once without duplicating the final answer', () => {
  const state = createTideEventState();
  state.onEvent({ type: 'token', content: '先检查资料。' });
  state.onEvent({ type: 'tool-call', tool: 'read', args: {} });
  state.onEvent({ type: 'tool-result', tool: 'read', result: 'evidence', ok: true });
  state.onEvent({ type: 'token', content: '这段交接前的回复。' });
  const first = state.displaySnapshot().map(message => message.id);
  assert.deepEqual(state.displaySnapshot().map(message => message.id), first);
  state.onEvent({ type: 'token', content: '最终答复。' });
  state.onEvent({ type: 'answer', content: '最终答复。', rawContent: '最终答复。' });
  assert.deepEqual(state.snapshot().intermediate.map(message => message.role), ['assistant', 'tool-call', 'tool-result', 'assistant']);
  assert.ok(!state.snapshot().intermediate.some(message => message.content === '最终答复。'));
});
