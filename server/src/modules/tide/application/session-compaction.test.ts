import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTideFeature } from '../api/factory.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { readTideSession, writeTideSession } from '../sessions/session-store.js';
import { activeTideContext } from '../sessions/active-context.js';
import { TideSessionCompaction } from './session-compaction.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';

test('human Tide full compaction archives originals and leaves only the summary in active model context', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-full-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir: directory });
  const tasks = new FileTideTaskRepository(directory);
  const timestamp = new Date().toISOString();
  await tasks.upsert({ id: 'task', name: '日报', agentId: 'agent-a', prompt: '日报', schedule: 'every 1h',
    enabled: false, repeatCount: -1, pushMode: 'accumulate', targetSessionId: 'session', windowN: 4,
    selfLoop: false, consecutiveErrors: 0, createdAt: timestamp });
  await writeTideSession(directory, { id: 'session', agentId: 'agent-a', agentName: 'A', title: '日报',
    model: 'test:model', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'u', role: 'user', content: '旧任务'.repeat(100) },
      { id: 'a', role: 'assistant', content: '旧结果'.repeat(100) }] }, 'task', '日报');
  const port = new TideSessionCompaction(directory, tasks, feature.scheduler, feature.changes, undefined,
    { resolveSummaryBudget: async () => 2_000, summarize: async () => '完整日报摘要' });
  assert.deepEqual(await port.compact('agent-a', 'session'), { compacted: true, notices: [] });
  const saved = await readTideSession(directory, 'agent-a', 'session');
  assert.ok(saved);
  assert.deepEqual(saved.messages.slice(0, 2).map(message => message.content),
    ['旧任务'.repeat(100), '旧结果'.repeat(100)]);
  assert.deepEqual(activeTideContext(saved.messages).map(message => message.content), ['[历史压缩记录]\n完整日报摘要']);
  const methods = feature.module.manifest.methods;
  const method = methods.find(item => item.id === 'compactSession');
  assert.deepEqual(method?.audiences, ['human', 'internal']);
  assert.equal(method?.permission, 'administer');
  assert.equal(method?.agentTool, undefined);
  let unlock!: () => void;
  const running = feature.scheduler.exclusive('task', () => new Promise<void>(resolve => { unlock = resolve; }));
  await assert.rejects(port.compact('agent-a', 'session'), /暂不能压缩/);
  unlock(); await running;
});

test('designated Tide manual compaction delegates to the registered Monsoon lifecycle port', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-designated-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir: directory });
  const tasks = new FileTideTaskRepository(directory);
  await tasks.upsert({ id: 'task', name: '跟进', agentId: 'agent-a', prompt: '跟进', schedule: 'every 1h',
    enabled: false, repeatCount: -1, pushMode: 'designated', targetSessionId: 'season', windowN: 1,
    selfLoop: false, consecutiveErrors: 0, createdAt: new Date().toISOString() });
  await tasks.upsert({ id: 'task-2', name: '跟进二', agentId: 'agent-a', prompt: '跟进', schedule: 'every 1h',
    enabled: false, repeatCount: -1, pushMode: 'designated', targetSessionId: 'season', windowN: 1,
    selfLoop: false, consecutiveErrors: 0, createdAt: new Date().toISOString() });
  const seen: string[] = [];
  const port = new TideSessionCompaction(directory, tasks, feature.scheduler, undefined,
    async (agentId, sessionId) => { seen.push(agentId, sessionId); });
  await port.compact('agent-a', 'season');
  assert.deepEqual(seen, ['agent-a', 'season']);
});

test('ambiguous accumulate compaction rejects before reading or overwriting either owner', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-ambiguous-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir: directory });
  const tasks = new FileTideTaskRepository(directory);
  for (const id of ['task-a', 'task-b']) await tasks.upsert({ id, name: id,
    agentId: 'agent-a', prompt: '检查', schedule: 'every 1h', enabled: false,
    repeatCount: -1, pushMode: 'accumulate', targetSessionId: 'shared', windowN: 4,
    selfLoop: false, consecutiveErrors: 0, createdAt: new Date().toISOString() });
  let modelCalls = 0;
  const port = new TideSessionCompaction(directory, tasks, feature.scheduler, undefined, undefined,
    { summarize: async () => { modelCalls += 1; return 'summary'; } });
  await assert.rejects(port.compact('agent-a', 'shared'), error =>
    error instanceof FrameworkError && error.data.code === 'TIDE_SESSION_AMBIGUOUS');
  assert.equal(modelCalls, 0);
});
