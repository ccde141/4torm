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
import { tideCompactionHandler } from '../api/compaction-method.js';
import type { ModuleInvocationContext } from '../../../engine/collaboration/contracts.js';
import { createModelRequestUsage } from '../../../engine/shared/model-request-usage.js';

test('human Tide full compaction archives originals and retains the latest four complete human turns', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-full-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir: directory });
  const tasks = new FileTideTaskRepository(directory);
  const timestamp = new Date().toISOString();
  const recent = Array.from({ length: 4 }, (_, index) => [
    { id: `recent-user-${index}`, role: 'user', content: `最新要求${index}` },
    { id: `recent-answer-${index}`, role: 'assistant', content: `最新回复${index}` },
  ]).flat();
  await tasks.upsert({ id: 'task', name: '日报', agentId: 'agent-a', prompt: '日报', schedule: 'every 1h',
    enabled: false, repeatCount: -1, pushMode: 'accumulate', targetSessionId: 'session', windowN: 4,
    selfLoop: false, consecutiveErrors: 0, createdAt: timestamp });
  await writeTideSession(directory, { id: 'session', agentId: 'agent-a', agentName: 'A', title: '日报',
    model: 'test:model', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'u', role: 'user', content: '旧任务'.repeat(100) },
      { id: 'a', role: 'assistant', content: '旧结果'.repeat(100) }, ...recent] }, 'task', '日报');
  let summaryRequests = 0;
  const port = new TideSessionCompaction(directory, tasks, feature.scheduler, feature.changes, undefined,
    { resolveSummaryBudget: async () => 2_000, summarize: async () => {
      summaryRequests++;
      const request = createModelRequestUsage({ messages: [{ role: 'user', content: '历史资料' }] }, 'compaction');
      request.update({ state: 'sent', wasSent: true });
      request.report({ promptTokens: 100, completionTokens: 10, totalTokens: 110 });
      request.finish('completed', { promptTokens: 100, completionTokens: 10, totalTokens: 110 }, true);
      return '完整日报摘要';
    } });
  const result = await port.compact('agent-a', 'session');
  assert.equal(result.compacted, true);
  assert.deepEqual(result.notices, []);
  assert.ok(Number.isFinite(result.updatedAt));
  const saved = await readTideSession(directory, 'agent-a', 'session');
  assert.ok(saved);
  assert.equal(saved.usage?.modelUsage?.calls, summaryRequests);
  assert.equal(saved.usage?.modelUsage?.total.totalTokens, summaryRequests * 110);
  assert.equal(saved.usage?.modelUsage?.latest, undefined);
  assert.equal(saved.compaction?.type, 'compact-done');
  assert.equal((await feature.tasks.readSession('agent-a', 'session')).compaction?.type, 'compact-done');
  assert.deepEqual(saved.messages.slice(0, 2).map(message => message.content),
    ['旧任务'.repeat(100), '旧结果'.repeat(100)]);
  assert.deepEqual(activeTideContext(saved.messages).map(message => message.content),
    ['[历史压缩记录]\n完整日报摘要', ...recent.map(message => message.content)]);
  const methods = feature.module.manifest.methods;
  const method = methods.find(item => item.id === 'compactSession');
  assert.deepEqual(method?.audiences, ['human', 'internal']);
  assert.equal(method?.permission, 'administer');
  assert.equal(method?.agentTool, undefined);
  let unlock!: () => void;
  const running = feature.scheduler.exclusive('task', () => new Promise<void>(resolve => { unlock = resolve; }));
  await assert.rejects(port.compact('agent-a', 'session'), /暂不能压缩/);
  unlock(); await running;
  const stale = { ...saved, compaction: { type: 'compact-start' as const, id: 'interrupted-manual',
    operation: 'compact' as const, reason: 'manual' as const, startedAt: Date.now(), updatedAt: Date.now() } };
  await writeTideSession(directory, stale, 'task', '日报');
  const restored = await createTideFeature({ dataDir: directory }).tasks.readSession('agent-a', 'session');
  assert.equal(restored.compaction?.type, 'compact-failed');
  assert.equal(restored.compaction?.aborted, true);
  assert.deepEqual(restored.messages, saved.messages);
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
  const controller = new AbortController();
  const port = new TideSessionCompaction(directory, tasks, feature.scheduler, undefined,
    async (agentId, sessionId, _notice, signal) => {
      seen.push(agentId, sessionId); assert.equal(signal, controller.signal);
    });
  await port.compact('agent-a', 'season', controller.signal);
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

test('cancelled manual Tide compaction preserves the original and releases the task reservation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-cancel-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir: directory });
  const tasks = new FileTideTaskRepository(directory);
  const timestamp = new Date().toISOString();
  await tasks.upsert({ id: 'task', name: '日报', agentId: 'agent-a', prompt: '日报', schedule: 'every 1h',
    enabled: false, repeatCount: -1, pushMode: 'accumulate', targetSessionId: 'session', windowN: 4,
    selfLoop: false, consecutiveErrors: 0, createdAt: timestamp });
  const original = { id: 'session', agentId: 'agent-a', agentName: 'A', title: '日报',
    model: 'test:model', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    tokenUsage: { promptTokens: 900, completionTokens: 100, totalTokens: 1_000 },
    messages: [{ id: 'u', role: 'user', content: '旧任务'.repeat(100) },
      { id: 'a', role: 'assistant', content: '旧结果'.repeat(100) },
      ...Array.from({ length: 4 }, (_, index) => [
        { id: `recent-user-${index}`, role: 'user', content: `最新要求${index}` },
        { id: `recent-answer-${index}`, role: 'assistant', content: `最新回复${index}` },
      ]).flat()] };
  await writeTideSession(directory, original, 'task', '日报');
  const controller = new AbortController();
  const port = new TideSessionCompaction(directory, tasks, feature.scheduler, feature.changes, undefined,
    { resolveSummaryBudget: async () => 2_000, summarize: async input => {
      assert.equal(input.signal, controller.signal);
      const snapshot = await feature.tasks.readSession('agent-a', 'session');
      assert.equal(snapshot.compaction?.type, 'compact-start');
      assert.deepEqual(snapshot.messages, original.messages);
      assert.deepEqual(snapshot.tokenUsage, original.tokenUsage);
      controller.abort(); return '不能进入活跃记录的半成品';
    } });
  const handler = tideCompactionHandler(port);
  await assert.rejects(handler.invoke({ signal: controller.signal } as ModuleInvocationContext,
    { agentId: 'agent-a', sessionId: 'session' }), { name: 'AbortError' });
  const cancelled = await readTideSession(directory, 'agent-a', 'session');
  assert.equal(cancelled?.compaction?.type, 'compact-failed');
  assert.equal(cancelled?.compaction?.aborted, true);
  assert.deepEqual(cancelled?.messages, original.messages);
  assert.deepEqual(cancelled?.tokenUsage, original.tokenUsage);
  assert.equal((await feature.tasks.readSession('agent-a', 'session')).compaction?.type, 'compact-failed');
  assert.equal(feature.scheduler.isRunning('task'), false);
});
