import assert from 'node:assert/strict';
import test from 'node:test';
import { activeMonsoonMessages, projectMonsoonContext } from './active-context.js';
import type { MonsoonMessage } from '../domain/session.js';

const message = (id: string, role: MonsoonMessage['role'], content: string,
  extra: Record<string, unknown> = {}): MonsoonMessage => ({
  id, role, content, timestamp: '2026-10-10T00:00:00.000Z', ...extra,
});

test('active context keeps latest summary and exact tool history, never pre-summary raw', () => {
  const messages = [message('old', 'user', 'archived'),
    message('marker', 'system', 'summary', { type: 'compact-marker', contextExact: true,
      nativeContext: [{ role: 'system', content: 'summary' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'read', arguments: '{}' }] },
        { role: 'tool', content: 'evidence', toolCallId: 'call' }] }),
    message('answer', 'assistant', 'done'), message('new', 'user', 'continue')];
  assert.equal(activeMonsoonMessages({ messages }).length, 3);
  const context = projectMonsoonContext({ messages });
  assert.deepEqual(context.map(item => item.content), ['summary', '', 'evidence', 'done', 'continue']);
  assert.equal(context[2]?.toolCallId, 'call');
});

test('raw display messages can be context-omitted after exact Tide checkpoint', () => {
  const context = projectMonsoonContext({ messages: [
    message('marker', 'system', 'summary', { type: 'compact-marker', contextOmitted: true }),
    message('user', 'user', 'question', { contextOmitted: true }),
    message('answer', 'assistant', 'answer', { contextExact: true, nativeContext: [
      { role: 'system', content: 'summary' }, { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' }] }),
  ] });
  assert.deepEqual(context.map(item => item.content), ['summary', 'question', 'answer']);
});

test('unfinished placeholder is excluded but interrupted tool evidence is preserved', () => {
  const context = projectMonsoonContext({ messages: [
    message('question', 'user', 'question'),
    message('work', 'assistant', 'partial', { toolSteps: [
      { tool: 'read', args: { path: 'file' }, result: 'found', status: 'done' }], streamStopped: true }),
    message('pending', 'assistant', '', { runCommitted: false, streamingPhase: 'llm-waiting' }),
  ] });
  assert.equal(context.filter(item => item.role === 'tool').length, 1);
  assert.equal(context.at(-1)?.content.includes('人类停止'), true);
});

test('legacy tool evidence restores MCP media references and its failure status', () => {
  const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  const context = projectMonsoonContext({ messages: [message('answer', 'assistant', 'done', {
    toolSteps: [{ tool: 'mcp:demo:observe', args: {}, result: 'metadata', ok: false, toolImages }],
  })] });
  assert.deepEqual(context.find(message => message.role === 'tool')?.toolImages, toolImages);
  assert.equal(context.find(message => message.role === 'tool')?.toolOk, false);
  assert.doesNotMatch(JSON.stringify(context), /base64|data:image/);
});
