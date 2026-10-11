import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TideTask } from '../domain/task.js';
import { recordTargetUsage, resolveTarget, saveTurn } from './session-resolver.js';
import { readTideSession } from './session-store.js';

test('existing accumulate session refreshes each call without doubling final totals', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-live-usage-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const task: TideTask = { id: 'task-live', name: '巡检', schedule: 'every 5m',
    prompt: '检查', agentId: 'worker', pushMode: 'accumulate', windowN: 4,
    roundSeq: 0, selfLoop: false, repeatCount: 2, consecutiveErrors: 0,
    enabled: true, createdAt: new Date().toISOString() };
  const first = await resolveTarget(dataDir, task);
  const previous = { promptTokens: 10, completionTokens: 2, totalTokens: 12 };
  const saved = await saveTurn(dataDir, task, first, 'Worker', 'test:model', '',
    '初次检查', '完成', [], { calls: 1, reportedCalls: 1, latest: previous, total: previous });
  task.targetSessionId = saved.targetSessionId;
  const live = await resolveTarget(dataDir, task);
  const current = { promptTokens: 20, completionTokens: 3, totalTokens: 23 };

  assert.equal(await recordTargetUsage(dataDir, task, live, current), true);
  const afterFirstCall = await readTideSession(dataDir, 'worker', saved.targetSessionId);
  assert.deepEqual(afterFirstCall?.tokenUsage, current);
  assert.equal(afterFirstCall?.usage?.calls, 2);
  assert.deepEqual(afterFirstCall?.messages.map(message => message.content), ['初次检查', '完成']);

  assert.equal(await recordTargetUsage(dataDir, task, live, null), true);
  const afterUnknownCall = await readTideSession(dataDir, 'worker', saved.targetSessionId);
  assert.equal(afterUnknownCall?.tokenUsage, undefined);
  assert.equal(afterUnknownCall?.usage?.calls, 3);
  assert.deepEqual(afterUnknownCall?.usage?.total,
    { promptTokens: 30, completionTokens: 5, totalTokens: 35 });

  await saveTurn(dataDir, task, live, 'Worker', 'test:model', '', '再检查', '再次完成', [],
    { calls: 2, reportedCalls: 1, total: current });
  const final = await readTideSession(dataDir, 'worker', saved.targetSessionId);
  assert.equal(final?.usage?.calls, 3);
  assert.equal(final?.usage?.reportedCalls, 2);
  assert.deepEqual(final?.usage?.total,
    { promptTokens: 30, completionTokens: 5, totalTokens: 35 });
  assert.deepEqual(final?.messages.map(message => message.content),
    ['初次检查', '完成', '再检查', '再次完成']);
});

test('N=1 accumulate keeps live usage after round archive clears messages', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-live-usage-n1-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const task: TideTask = { id: 'task-n1', name: '巡检', schedule: 'every 5m',
    prompt: '检查', agentId: 'worker', pushMode: 'accumulate', windowN: 1,
    roundSeq: 0, selfLoop: false, repeatCount: 2, consecutiveErrors: 0,
    enabled: true, createdAt: new Date().toISOString() };
  const initial = await resolveTarget(dataDir, task);
  const first = await saveTurn(dataDir, task, initial, 'Worker', 'test:model', '',
    '初次检查', '完成');
  task.targetSessionId = first.targetSessionId;
  task.roundSeq = first.roundSeq;
  task.archiveBatch = first.archiveBatch;
  const live = await resolveTarget(dataDir, task);
  const reported = { promptTokens: 7, completionTokens: 1, totalTokens: 8 };
  await recordTargetUsage(dataDir, task, live, reported);
  assert.deepEqual((await readTideSession(dataDir, 'worker', first.targetSessionId))?.tokenUsage,
    reported);
  await saveTurn(dataDir, task, live, 'Worker', 'test:model', '', '再次检查', '再次完成', [],
    { calls: 1, reportedCalls: 1, latest: reported, total: reported });
  const final = await readTideSession(dataDir, 'worker', first.targetSessionId);
  assert.deepEqual(final?.messages, []);
  assert.equal(final?.usage?.calls, 1);
  assert.deepEqual(final?.tokenUsage, reported);
});
