import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('真实本地时区变化重排每日计划，DST 跳变按时执行且重复时分只运行一次', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-clock-zone-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', scenario, dataDir], {
    cwd: new URL('../../../../', import.meta.url),
    env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { changedZone: true, fold: 1, spring: 1 });
});

const scenario = `
import assert from 'node:assert/strict';
import path from 'node:path';
import { mock } from 'node:test';
import { createTideFeature } from './src/modules/tide/api/factory.ts';
import { FileTideTaskRepository } from './src/modules/tide/infrastructure/task-repository.ts';
import { CollaborationRouter } from './src/engine/collaboration/router.ts';
import { internalContext } from './src/engine/collaboration/internal-context.ts';

let now = Date.UTC(2026, 9, 22, 6);
mock.timers.enable({ apis: ['Date'], now });
function clock(value) { now = value; mock.timers.setTime(value); }
const input = schedule => ({ name: 'daily', schedule, prompt: 'check', agentId: 'fixture-agent' });
function fixture(name) {
  let executions = 0;
  const dataDir = path.join(process.argv[1], name);
  const feature = createTideFeature({ dataDir, execute: async (_deps, task, _manual, runId) => {
    executions += 1;
    return { taskId: task.id, runId, timestamp: new Date(now).toISOString(), status: 'success',
      sessionId: 'fixture-session', answer: 'done', rawContent: 'done', toolCalls: [], turns: 1, durationMs: 1 };
  } });
  const router = new CollaborationRouter([feature.module]);
  feature.scheduler.bindScheduledTrigger(taskId => router.invoke({ feature: 'tide',
    method: 'triggerScheduledTask', input: { taskId } },
    internalContext('tide.scheduler', 'timezone-fixture', 'tide')));
  return { feature, repository: new FileTideTaskRepository(dataDir), count: () => executions };
}

const zone = fixture('zone');
const zonedTask = await zone.feature.tasks.create(input('daily 08:00'));
assert.equal(zonedTask.nextRun, '2026-10-22T08:00:00.000Z');
await zone.feature.scheduler.scanDue();
process.env.TZ = 'Asia/Tokyo';
assert.equal(new Date(now).getHours(), 15);
await zone.feature.scheduler.scanDue();
assert.equal((await zone.repository.get(zonedTask.id)).nextRun, '2026-10-22T23:00:00.000Z');
assert.equal(zone.count(), 0);
zone.feature.scheduler.stop();

process.env.TZ = 'America/New_York';
clock(Date.UTC(2026, 10, 1, 4, 59, 59));
const fold = fixture('fold');
const foldTask = await fold.feature.tasks.create(input('daily 01:30'));
assert.equal(foldTask.nextRun, '2026-11-01T05:30:00.000Z');
clock(Date.UTC(2026, 10, 1, 5, 30));
await fold.feature.scheduler.scanDue();
await fold.feature.scheduler.drain();
assert.equal(fold.count(), 1);
assert.equal((await fold.repository.get(foldTask.id)).nextRun, '2026-11-02T06:30:00.000Z');
clock(Date.UTC(2026, 10, 1, 6, 30));
await fold.feature.scheduler.scanDue();
await fold.feature.scheduler.drain();
assert.equal(fold.count(), 1);
fold.feature.scheduler.stop();

clock(Date.UTC(2026, 2, 8, 6, 59, 59));
const spring = fixture('spring');
const springTask = await spring.feature.tasks.create(input('daily 03:00'));
assert.equal(springTask.nextRun, '2026-03-08T07:00:00.000Z');
clock(now + 1_000);
assert.equal(new Date(now).getHours(), 3);
await spring.feature.scheduler.scanDue();
await spring.feature.scheduler.drain();
assert.equal(spring.count(), 1);
assert.equal((await spring.repository.get(springTask.id)).nextRun, '2026-03-09T07:00:00.000Z');
spring.feature.scheduler.stop();
process.stdout.write(JSON.stringify({ changedZone: true, fold: fold.count(), spring: spring.count() }));
`;
