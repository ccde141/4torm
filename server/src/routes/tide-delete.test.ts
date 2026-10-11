import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTideFeature } from '../modules/tide/public.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import type { CollaborationContext } from '../engine/collaboration/contracts.js';

test('正在执行的潮汐任务不能删除', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-delete-'));
  const feature = createTideFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const task = await feature.tasks.create({
    name: '运行中任务', schedule: 'every 5m', prompt: 'run', agentId: 'agent-a',
    repeatCount: 1, pushMode: 'accumulate', windowN: 1,
  });

  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const running = feature.scheduler.exclusive(task.id, () => hold);

  await assert.rejects(router.invoke({
    feature: 'tide', method: 'deleteTask', input: { taskId: task.id },
  }, context), /正在执行/);
  assert.equal((await feature.tasks.detail(task.id)).task.id, task.id);

  release();
  await running;
});

const context: CollaborationContext = {
  actor: { type: 'human', id: 'local-human', actingAs: 'human' },
  audience: 'human', enabledFeatures: new Set(['tide']),
  permissions: new Set(['observe', 'design', 'execute', 'intervene', 'administer']),
  requestId: 'tide-delete-test',
};
