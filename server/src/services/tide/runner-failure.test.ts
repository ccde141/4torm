import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getTask, listRunRecords, upsertTask } from './store.js';
import { runTideTask } from './runner.js';
import type { TideTask } from './types.js';

test('Agent 不存在时记录失败并按连续失败规则暂停任务', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-failure-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const task: TideTask = {
    id: 'tide-missing-agent', name: '缺失 Agent', schedule: 'every 5m', prompt: 'run',
    agentId: 'agent-missing', repeatCount: -1, pushMode: 'accumulate', windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled: true,
    createdAt: new Date().toISOString(), nextRun: new Date(0).toISOString(),
  };
  await upsertTask(dataDir, task);

  let current = task;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const before = Date.now();
    const record = await runTideTask(dataDir, current);
    assert.equal(record.status, 'error');
    const fresh = await getTask(dataDir, task.id);
    assert.ok(fresh);
    assert.equal(fresh.consecutiveErrors, attempt);
    assert.ok(fresh.nextRun && new Date(fresh.nextRun).getTime() > before);
    current = fresh;
  }

  const finalTask = await getTask(dataDir, task.id);
  assert.equal(finalTask?.enabled, false);
  assert.equal((await listRunRecords(dataDir, task.id)).length, 3);
});
