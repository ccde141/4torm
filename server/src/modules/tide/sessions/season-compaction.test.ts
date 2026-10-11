import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonSessionRepository } from '../../monsoon/infrastructure/session-repository.js';
import { SeasonSessionPort } from './season-session-port.js';
import { activeTideContext } from './active-context.js';
import { archiveTideSession } from './session-archive.js';
import type { TideSession } from './session-types.js';

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
  const port = new SeasonSessionPort(directory);
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
