import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonSessionRepository } from '../../monsoon/infrastructure/session-repository.js';
import { createMonsoonExternalSessionPort } from '../../monsoon/public.js';
import { activeTideContext } from './active-context.js';
import { archiveTideSession } from './session-archive.js';
import type { TideSession } from './session-types.js';
import { resolveTarget, saveTurn } from './session-resolver.js';
import type { TideTask } from '../domain/task.js';

test('designated Tide appends exact compressed context once and preserves all original records', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-season-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const timestamp = new Date().toISOString();
  const repository = new FileMonsoonSessionRepository(directory);
  const session = await repository.create({ id: 'session', agentId: 'agent-a', agentName: 'A',
    title: '会话', model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'old', role: 'user', content: '旧原文', timestamp },
      { id: 'compact', role: 'system', content: '摘要', timestamp, type: 'compact-marker',
        contextExact: true, nativeContext: [{ role: 'system', content: '摘要' }] }] });
  const port = createMonsoonExternalSessionPort(directory);
  await port.append('agent-a', 'session', session.revision,
    { id: 'user', role: 'user', content: '潮汐任务', timestamp },
    { id: 'answer', role: 'assistant', content: '潮汐结果', timestamp },
    [{ role: 'system', content: '摘要' }, { role: 'user', content: '潮汐任务' },
      { role: 'assistant', content: '潮汐结果' }]);
  const saved = await port.read('agent-a', 'session');
  assert.ok(saved);
  assert.deepEqual(saved.messages.map(message => message.content), ['旧原文', '摘要', '潮汐任务', '潮汐结果']);
  assert.deepEqual((await port.activeContext(saved)).map(message => message.content), ['摘要', '潮汐任务', '潮汐结果']);
});

test('Tide rolling retention cannot restore archived rounds through a compaction marker', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-window-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const timestamp = new Date().toISOString();
  const session: TideSession = { id: 'session', agentId: 'agent', agentName: 'A', title: '任务',
    model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp, messages: [
      { id: 'u1', role: 'user', content: '过期轮次' }, { id: 'a1', role: 'assistant', content: '过期结果' },
      { id: 'u2', role: 'user', content: '保留轮次' }, { id: 'a2', role: 'assistant', content: '保留结果' },
      { id: 'compact', role: 'system', content: '摘要', type: 'compact-marker', nativeContext: [
        { role: 'user', content: '过期轮次' }, { role: 'assistant', content: '过期结果' }] }] };
  await archiveTideSession(directory, session, 2, 2, 0, 'task', '任务', { writeActive: async () => {} });
  assert.deepEqual(activeTideContext(session.messages).map(message => message.content), ['保留轮次', '保留结果']);
});

test('rolling retention preserves the current MCP tool images after compaction without reviving archived context', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-media-rolling-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const task: TideTask = { id: 'task', agentId: 'agent', name: 'Media', prompt: 'check', schedule: 'every 1m',
    enabled: true, repeatCount: -1, selfLoop: false, pushMode: 'accumulate', windowN: 2,
    createdAt: new Date().toISOString() };
  const first = await saveTurn(directory, task, await resolveTarget(directory, task), 'A', 'p:m', '', 'old task', 'old answer');
  Object.assign(task, first);
  const second = await resolveTarget(directory, task);
  const toolImages = [{ id: '9dfd2154-439d-4d17-9769-622084b76321', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  second.turnContext = [
    { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'mcp:desktop:observe', arguments: '{}' }] },
    { role: 'tool', content: 'metadata', toolCallId: 'call', toolImages, toolOk: true },
    { role: 'assistant', content: 'current answer' },
  ];
  second.compactedContext = [{ role: 'system', content: 'old task summary' },
    { role: 'user', content: 'current task' }, ...second.turnContext];
  const saved = await saveTurn(directory, task, second, 'A', 'p:m', '', 'current task', 'current answer');
  const restored = await resolveTarget(directory, { ...task, ...saved });
  assert.deepEqual(restored.history.filter(message => message.role === 'tool').map(message => message.toolImages), [toolImages]);
  assert.equal(restored.history.filter(message => message.content === 'current answer').length, 1);
  assert.equal(restored.history.filter(message => message.content === 'current task').length, 1);
  assert.ok(restored.history.every(message => !message.content.includes('old task')));
});
