import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../../engine/shared/compaction/index.js';
import { callPreparedModel } from '../../../engine/shared/react/model-call.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { TideTask } from '../domain/task.js';
import type { TideMessage, TideSession } from '../sessions/session-types.js';
import { activeTideContext } from '../sessions/active-context.js';
import { resolveTarget, saveTurn } from '../sessions/session-resolver.js';
import { readTideSession, writeTideSession } from '../sessions/session-store.js';
import { TideContextCompaction } from './context-compaction.js';
import { createTideEventState } from './tide-conversation-events.js';

test('two successful in-turn compactions save the received display once and keep model checkpoints separate', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-compaction-display-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: true, thresholds: { ...policy.thresholds, tide: 1_000 } });
  const task: TideTask = { id: 'task', agentId: 'agent', name: 'Check', prompt: 'Inspect', schedule: 'every 1m',
    enabled: true, repeatCount: -1, selfLoop: false, pushMode: 'accumulate', windowN: 10, targetSessionId: 'session',
    createdAt: '2026-10-26T00:00:00Z' };
  const session: TideSession = { id: 'session', agentId: task.agentId, agentName: 'A', title: 'Check', model: 'p:m',
    systemPrompt: '', createdAt: task.createdAt, updatedAt: task.createdAt, messages: [
      { id: 'old-user', role: 'user', origin: 'framework', content: '历史任务'.repeat(300) },
      { id: 'old-answer', role: 'assistant', content: '完成结果'.repeat(8_000) }] };
  await writeTideSession(dataDir, session, task.id, task.name);
  const resolved = await resolveTarget(dataDir, task);
  const input: TideMessage = { id: 'this-input', role: 'user', origin: 'framework', content: 'Inspect current screen' };
  resolved.displayInput = input;
  const state = createTideEventState();
  const images = (id: string) => [{ id, name: 'screen.png', mimeType: 'image/png', size: 8 }];
  state.onEvent({ type: 'token', content: '压缩前过程' });
  state.onEvent({ type: 'tool-call', tool: 'observe', args: {} });
  state.onEvent({ type: 'tool-result', tool: 'observe', result: 'metadata-one', ok: true, toolImages: images('shot-one') });
  const messages: ContextMessage[] = [{ role: 'system', content: 'Identity' }, ...resolved.history,
    { role: 'user', origin: 'framework', content: input.content },
    { role: 'assistant', content: '压缩前过程', toolCalls: [{ id: 'call-one', name: 'observe', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'call-one', content: 'metadata-one', toolImages: images('shot-one') }];
  let summaries = 0;
  const compactor = new TideContextCompaction(dataDir, task, resolved, resolved.existing!, undefined, undefined, undefined,
    { summarize: async () => `交接${++summaries}`, resolveSummaryBudget: async () => 100_000 });
  compactor.displaySnapshot = () => [input, ...state.displaySnapshot()];
  const caller = compactor.transform({ call: async () => ({ content: 'Next', finishReason: 'stop' }) });
  await callPreparedModel(caller, messages, undefined, {});
  const first = await readTideSession(dataDir, task.agentId, 'session');
  assert.equal(first?.messages.filter(message => message.type === 'compact-marker').length, 1);
  assert.ok(first?.messages.some(message => message.role === 'tool-result' && message.toolImages?.[0].id === 'shot-one'));
  state.onEvent({ type: 'token', content: '接续过程' });
  state.onEvent({ type: 'tool-call', tool: 'observe', args: { region: 2 } });
  state.onEvent({ type: 'tool-result', tool: 'observe', result: '新'.repeat(35_000), ok: true, toolImages: images('shot-two') });
  messages.push({ role: 'assistant', content: '接续过程', toolCalls: [{ id: 'call-two', name: 'observe', arguments: '{"region":2}' }] },
    { role: 'tool', toolCallId: 'call-two', content: '新'.repeat(35_000), toolImages: images('shot-two') });
  await callPreparedModel(caller, messages, undefined, {});
  assert.equal(summaries, 2);
  messages.push({ role: 'assistant', content: '最终结果' });
  await compactor.checkpoint(messages);
  resolved.turnContext = messages.slice(-3);
  await saveTurn(dataDir, task, resolved, 'A', 'p:m', '', input.content, '最终结果', state.snapshot().intermediate);
  const saved = (await readTideSession(dataDir, task.agentId, 'session'))!;
  assert.equal(new Set(saved.messages.map(message => message.id)).size, saved.messages.length);
  assert.equal(saved.messages.filter(message => message.id === input.id).length, 1);
  assert.equal(saved.messages.filter(message => message.type === 'compact-marker' && !message.contextOnly).length, 2);
  assert.equal(saved.messages.at(-1)?.contextOnly, true);
  const firstBoundary = saved.messages.findIndex(message => message.type === 'compact-marker');
  const secondBoundary = saved.messages.findLastIndex(message => message.type === 'compact-marker' && !message.contextOnly);
  assert.ok(saved.messages.findIndex(message => message.content === '压缩前过程') < firstBoundary);
  assert.ok(saved.messages.findIndex(message => message.content === '接续过程') > firstBoundary);
  assert.ok(saved.messages.findIndex(message => message.content === '接续过程') < secondBoundary);
  assert.deepEqual(activeTideContext(saved.messages), resolved.compactedContext);
  assert.ok(!activeTideContext(saved.messages).some(message => message.content.includes('历史任务')));
});

test('a rejected compaction commit cannot publish display fragments or a successful boundary over concurrent data', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-compaction-display-rejected-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: true, thresholds: { ...policy.thresholds, tide: 1_000 } });
  const task: TideTask = { id: 'task', agentId: 'agent', name: 'Check', prompt: 'Inspect', schedule: 'every 1m',
    enabled: true, repeatCount: -1, selfLoop: false, pushMode: 'accumulate', windowN: 10, targetSessionId: 'session',
    createdAt: '2026-10-26T00:00:00Z' };
  const session: TideSession = { id: 'session', agentId: task.agentId, agentName: 'A', title: 'Check', model: 'p:m',
    systemPrompt: '', createdAt: task.createdAt, updatedAt: task.createdAt,
    messages: [{ id: 'old-input', role: 'user', origin: 'framework', content: '历史任务'.repeat(600) },
      { id: 'old', role: 'assistant', content: '历史资料'.repeat(8_000) }] };
  await writeTideSession(dataDir, session, task.id, task.name);
  const resolved = await resolveTarget(dataDir, task);
  const current = { id: 'current', role: 'user', origin: 'framework' as const, content: 'Inspect' };
  const concurrent: TideSession = { ...session, messages: [...session.messages,
    { id: 'concurrent', role: 'assistant', content: 'Concurrent durable content' }] };
  const compactor = new TideContextCompaction(dataDir, task, resolved, resolved.existing!, undefined, undefined, undefined,
    { resolveSummaryBudget: async () => 100_000, summarize: async () => {
      await writeTideSession(dataDir, concurrent, task.id, task.name); return '交接';
    } });
  compactor.displaySnapshot = () => [current];
  let calls = 0;
  const messages: ContextMessage[] = [{ role: 'system', content: 'Identity' }, ...resolved.history,
    { role: 'user', origin: 'framework', content: current.content }];
  await assert.rejects(callPreparedModel(compactor.transform({ call: async () => { calls++; return { content: 'Next', finishReason: 'stop' }; } }),
    messages, undefined, {}), /会话已发生变化/);
  assert.deepEqual((await readTideSession(dataDir, task.agentId, 'session'))?.messages, concurrent.messages);
  assert.equal(calls, 0);
});
