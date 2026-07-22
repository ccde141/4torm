import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clearSessionLeases, tryAcquireSessionLease } from '../../engine/conversation/session-lease.js';
import { runTideTask } from './runner.js';
import { getTask, upsertTask } from './store.js';
import type { TideTask } from './types.js';

test.beforeEach(() => clearSessionLeases());

test('designated 任务撞到运行中会话时记录失败而不立即重试', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-lease-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const task: TideTask = {
    id: 'tide-a', name: '测试', schedule: 'every 5m', prompt: 'run', agentId: 'agent-a',
    repeatCount: 1, pushMode: 'designated', targetSessionId: 'session-a', windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled: true, createdAt: new Date().toISOString(),
  };
  const release = tryAcquireSessionLease(task.agentId, task.targetSessionId!);
  assert.ok(release);
  await upsertTask(dataDir, task);

  const record = await runTideTask(dataDir, task);
  const updated = await getTask(dataDir, task.id);
  assert.equal(record.status, 'error');
  assert.match(record.error || '', /指定的季风会话正在执行中/);
  assert.ok(updated?.nextRun);
  assert.equal(updated?.consecutiveErrors, 0);
  release();
});
