import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { createTideFeature } from './factory.js';

test('Agent 或定时任务的写入在持久化后通知未持有 runId 的页面', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-change-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir });
  const events: Array<{ scope: string; taskId?: string; runId?: string }> = [];
  const stop = feature.changes.subscribe(event => events.push(event));
  t.after(stop);
  const task = await feature.tasks.create({
    name: '巡检', schedule: 'every 5m', prompt: '检查', agentId: 'worker',
  }, { enabled: false });
  assert.equal(events.at(-1)?.scope, 'task');
  assert.ok(await feature.tasks.detail(task.id));
  const queued = await feature.runStates.create(task.id, 'schedule', task.agentId);
  assert.deepEqual(events.at(-1), {
    type: 'change', scope: 'run', taskId: task.id, runId: queued.runId,
    agentId: 'worker', revision: 2,
  });
  await feature.runStates.markRunning(task.id, queued.runId, task.agentId);
  assert.equal(events.at(-1)?.scope, 'run');
  await new FileTideRunRepository(dataDir, feature.changes).save({
    taskId: task.id, runId: queued.runId, timestamp: new Date().toISOString(),
    status: 'success', sessionId: 'session-1', answer: '完成', rawContent: '完成',
    toolCalls: [], turns: 1, durationMs: 1,
  });
  assert.equal(events.at(-1)?.scope, 'record');
  await feature.runStates.finish(task.id, queued.runId, 'completed');
  assert.equal(events.at(-1)?.scope, 'run');
  assert.equal((await feature.runStates.getRun(task.id, queued.runId))?.status, 'completed');
});
