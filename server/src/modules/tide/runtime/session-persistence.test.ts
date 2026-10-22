import { createMonsoonExternalSessionPort } from '../../monsoon/public.js';
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
  const resolved = await resolveTarget(dataDir, task, createMonsoonExternalSessionPort(dataDir));
  const changes = new TideChangeFeed();
  const events: unknown[] = [];
  changes.subscribe(event => events.push(event));
  const saved = await persistTideConversation(dataDir, task, {
    agentName: 'Worker', agentModel: 'test:model', rolePrompt: '', resolved,
    userMessage: '检查', answer: '完成', rawContent: '完成', toolCalls: [],
    turns: 1, intermediate: [],
  }, '完成', changes);
  assert.equal(saved.sessionState, 'retained', '指定季风即使 windowN=1 也保留会话');
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
  const first = await resolveTarget(dataDir, task, createMonsoonExternalSessionPort(dataDir));
  const saved = await saveTurn(dataDir, task, first, 'Worker', 'test:model', '',
    '检查', '首次完成', [], { calls: 1, reportedCalls: 1,
      latest: { promptTokens: 20, completionTokens: 2, totalTokens: 22 },
      total: { promptTokens: 20, completionTokens: 2, totalTokens: 22 } });
  assert.equal(saved.sessionState, 'retained');
  task.targetSessionId = saved.targetSessionId;
  const second = await resolveTarget(dataDir, task, createMonsoonExternalSessionPort(dataDir));
  await saveTurn(dataDir, task, second, 'Worker', 'test:model', '',
    '再检查', '再次完成', [], { calls: 1, reportedCalls: 0 });
  const session = await readTideSession(dataDir, 'worker', saved.targetSessionId);
  assert.equal(session?.tokenUsage, undefined);
  assert.deepEqual(session?.usage, { calls: 2, reportedCalls: 1,
    total: { promptTokens: 20, completionTokens: 2, totalTokens: 22 } });
});

test('保存结果记录本轮实际是否已归档，不依赖未来的任务配置', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-saved-session-state-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const task: TideTask = { id: 'task-state', name: '巡检', schedule: 'every 5m',
    prompt: '检查', agentId: 'worker', pushMode: 'accumulate', windowN: 1,
    selfLoop: false, repeatCount: -1, consecutiveErrors: 0, enabled: false,
    createdAt: '2026-10-21T00:00:00.000Z' };
  const first = await saveTurn(dataDir, task, await resolveTarget(dataDir, task),
    'Worker', 'test:model', '', '检查一', '结果一');
  assert.equal(first.sessionState, 'archived');
  assert.equal((await readTideSession(dataDir, task.agentId, first.targetSessionId))?.messages.length, 0);
  task.targetSessionId = first.targetSessionId;
  task.windowN = 2;
  const second = await saveTurn(dataDir, task, await resolveTarget(dataDir, task),
    'Worker', 'test:model', '', '检查二', '结果二');
  assert.equal(second.sessionState, 'retained');
  assert.equal(first.sessionState, 'archived');
  task.roundSeq = second.roundSeq;
  task.archiveBatch = second.archiveBatch;
  const third = await saveTurn(dataDir, task, await resolveTarget(dataDir, task),
    'Worker', 'test:model', '', '检查三', '结果三');
  assert.equal(third.sessionState, 'retained', '滚动归档旧轮后，本轮仍在会话中');
});
