import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { tideTaskRuns } from '../services/tide/scheduler.js';
import { getTask, upsertTask } from '../services/tide/store.js';
import type { TideTask } from '../services/tide/types.js';
import { tideRoutes } from './tide.js';

test('正在执行的潮汐任务不能删除', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-delete-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(tideRoutes, { prefix: '/api/tide' });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const task: TideTask = {
    id: 'tide-running', name: '运行中任务', schedule: 'every 5m', prompt: 'run',
    agentId: 'agent-a', repeatCount: 1, pushMode: 'accumulate', windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled: false,
    createdAt: new Date().toISOString(),
  };
  await upsertTask(dataDir, task);

  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const running = tideTaskRuns.run(task.id, () => hold);

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tide/task/${task.id}`,
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.json().error, /正在执行/);
  assert.ok(await getTask(dataDir, task.id));

  release();
  await running;
});
