import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonSessionRepository } from '../../monsoon/infrastructure/session-repository.js';
import { TideChangeFeed } from '../application/change-feed.js';
import { resolveTarget, saveTurn } from '../sessions/session-resolver.js';
import { readTideSession } from '../sessions/session-store.js';
import type { TideTask } from '../domain/task.js';
import { TideTaskService } from '../application/task-service.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { FileTideRunStateRepository } from '../infrastructure/run-state-repository.js';
import { TideScheduler } from './scheduler.js';
import { persistTideConversation } from './session-persistence.js';

test('指定季风会话追加后索引版本与潮汐会话通知一起更新', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-season-change-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const now = new Date().toISOString();
  await sessions.create({ id: 'session-1', agentId: 'worker', agentName: 'Worker',
    title: '工作记录', messages: [], model: 'test:model', systemPrompt: '',
    createdAt: now, updatedAt: now, revision: 1, messageRevision: 1 });
  const tasks = new FileTideTaskRepository(dataDir);
  const runs = new FileTideRunRepository(dataDir);
  const runStates = new FileTideRunStateRepository(dataDir);
  const scheduler = new TideScheduler({ dataDir, tasks, runs, runStates });
  const service = new TideTaskService(dataDir, tasks, runs, runStates, scheduler);
  const task = await service.create({ name: '巡检', schedule: 'every 5m',
    prompt: '检查', agentId: 'worker', pushMode: 'designated',
    targetSessionId: 'session-1' });
  const resolved = await resolveTarget(dataDir, task);
  const changes = new TideChangeFeed();
  const events: unknown[] = [];
  changes.subscribe(event => events.push(event));
  await persistTideConversation(dataDir, task, {
    agentName: 'Worker', agentModel: 'test:model', rolePrompt: '', resolved,
    userMessage: '检查', answer: '完成', rawContent: '完成', toolCalls: [],
    turns: 1, intermediate: [],
  }, '完成', changes);
  assert.equal((await sessions.get('worker', 'session-1'))?.revision, 2);
  assert.equal((await sessions.list('worker'))[0]?.revision, 2);
  assert.deepEqual(events, [{ type: 'change', scope: 'session', agentId: 'worker',
    taskId: task.id, sessionId: 'session-1', revision: 1 }]);
});

test('累计潮汐会话保留历次真实用量，未知调用清空最近请求', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-usage-acc-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const task: TideTask = { id: 'task-acc', name: '巡检', schedule: 'every 5m',
    prompt: '检查', agentId: 'worker', pushMode: 'accumulate',
    windowN: 4, roundSeq: 0, selfLoop: false, repeatCount: 2,
    consecutiveErrors: 0, enabled: true, createdAt: new Date().toISOString() };
  const first = await resolveTarget(dataDir, task);
  const saved = await saveTurn(dataDir, task, first, 'Worker', 'test:model', '',
    '检查', '首次完成', [], { calls: 1, reportedCalls: 1,
      latest: { promptTokens: 20, completionTokens: 2, totalTokens: 22 },
      total: { promptTokens: 20, completionTokens: 2, totalTokens: 22 } });
  task.targetSessionId = saved.targetSessionId;
  const second = await resolveTarget(dataDir, task);
  await saveTurn(dataDir, task, second, 'Worker', 'test:model', '',
    '再检查', '再次完成', [], { calls: 1, reportedCalls: 0 });
  const session = await readTideSession(dataDir, 'worker', saved.targetSessionId);
  assert.equal(session?.tokenUsage, undefined);
  assert.deepEqual(session?.usage, { calls: 2, reportedCalls: 1,
    total: { promptTokens: 20, completionTokens: 2, totalTokens: 22 } });
});
