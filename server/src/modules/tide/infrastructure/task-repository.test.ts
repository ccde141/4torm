import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { tideTasksFile } from '../../../services/data-paths.js';
import { FileTideTaskRepository } from './task-repository.js';
import { createTideFeature } from '../api/factory.js';

test('missing Tide task storage is an empty valid snapshot', async (t) => {
  const dataDir = await tempDataDir(t);
  const snapshot = await new FileTideTaskRepository(dataDir).read();
  assert.deepEqual(snapshot.tasks, []);
  assert.match(snapshot.revision, /^[a-f0-9]{16}$/);
});

test('corrupt Tide JSON is quarantined and reported instead of becoming an empty list', async (t) => {
  const dataDir = await tempDataDir(t);
  const file = tideTasksFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{broken', 'utf8');

  await assert.rejects(
    new FileTideTaskRepository(dataDir).read(),
    (error: unknown) => error instanceof FrameworkError && error.data.code === 'TIDE_TASKS_CORRUPT',
  );
  const names = await fs.readdir(path.dirname(file));
  assert.equal(names.some(name => name.startsWith('tasks.json.corrupt-')), true);
  await assert.rejects(fs.access(file));
});

test('schema-invalid Tide data is reported without overwriting the source', async (t) => {
  const dataDir = await tempDataDir(t);
  const file = tideTasksFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify([{ id: 'task-a' }]), 'utf8');

  await assert.rejects(
    new FileTideTaskRepository(dataDir).read(),
    (error: unknown) => error instanceof FrameworkError && error.data.code === 'TIDE_TASKS_INVALID',
  );
  assert.match(await fs.readFile(file, 'utf8'), /task-a/);
});

test('out-of-range Tide counters are rejected as invalid stored data', async (t) => {
  const dataDir = await tempDataDir(t);
  const file = tideTasksFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify([{ ...task('task-a', 'A'), repeatCount: -2 }]), 'utf8');

  await assert.rejects(
    new FileTideTaskRepository(dataDir).read(),
    (error: unknown) => error instanceof FrameworkError && error.data.code === 'TIDE_TASKS_INVALID',
  );
});

test('serialized Tide upserts do not lose concurrent tasks', async (t) => {
  const dataDir = await tempDataDir(t);
  const repository = new FileTideTaskRepository(dataDir);

  await Promise.all([
    repository.upsert(task('task-a', 'A')),
    repository.upsert(task('task-b', 'B')),
  ]);

  const snapshot = await repository.read();
  assert.deepEqual(snapshot.tasks.map(item => item.id).sort(), ['task-a', 'task-b']);
});

test('调度CAS仅更改下次时间，保留人工编辑且同一时点只能推进一次', async t => {
  const repository = new FileTideTaskRepository(await tempDataDir(t));
  const original = { ...task('daily', '日报'), enabled: true, schedule: 'daily 08:00',
    nextRun: '2026-10-21T00:00:00.000Z' };
  await repository.upsert(original);
  await repository.upsert({ ...original, name: '人工改名', prompt: '新的任务内容' });
  const expected = { schedule: original.schedule, nextRun: original.nextRun };
  const outcomes = await Promise.all([
    repository.reschedule(original.id, expected, '2026-10-22T00:00:00.000Z'),
    repository.reschedule(original.id, expected, '2026-10-23T00:00:00.000Z'),
  ]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  const saved = await repository.get(original.id);
  assert.equal(saved?.name, '人工改名');
  assert.equal(saved?.prompt, '新的任务内容');
  assert.equal(saved?.nextRun, '2026-10-22T00:00:00.000Z');
});

test('暂停、次数耗尽和已变更计划均拒绝旧调度CAS', async t => {
  const repository = new FileTideTaskRepository(await tempDataDir(t));
  const original = { ...task('daily', '日报'), enabled: true, schedule: 'daily 08:00',
    nextRun: '2026-10-21T00:00:00.000Z' };
  const expected = { schedule: original.schedule, nextRun: original.nextRun };
  for (const changed of [{ enabled: false }, { repeatCount: 0 }, { schedule: 'daily 09:00' }]) {
    await repository.upsert({ ...original, ...changed });
    assert.equal(await repository.reschedule(original.id, expected, '2026-10-22T00:00:00.000Z'), false);
    assert.equal((await repository.get(original.id))?.nextRun, original.nextRun);
  }
});

test('原子任务修改不重建已删任务，不允许变更身份，失败后保留原数据并释放队列', async t => {
  const repository = new FileTideTaskRepository(await tempDataDir(t));
  let invoked = false;
  assert.equal(await repository.mutate('missing', current => { invoked = true; return current; }), undefined);
  assert.equal(invoked, false);
  await repository.upsert(task('original', '原任务'));
  await assert.rejects(repository.mutate('original', current => ({ ...current, id: 'other' })),
    (error: unknown) => error instanceof FrameworkError && error.data.code === 'TIDE_TASK_ID_CHANGED');
  assert.equal((await repository.get('original'))?.name, '原任务');
  assert.equal(await repository.get('other'), undefined);
  assert.equal((await repository.mutate('original', current => ({ ...current, name: '更新成功' })))?.name, '更新成功');
});

test('结算、计划修改和暂停共用文件事务，旧执行快照不会覆盖最新计划或启停', async t => {
  const dataDir = await tempDataDir(t);
  const settlement = new FileTideTaskRepository(dataDir);
  const editor = new FileTideTaskRepository(dataDir);
  const feature = createTideFeature({ dataDir });
  const original = { ...task('atomic', '定时任务'), enabled: true, schedule: 'daily 08:00',
    nextRun: '2026-10-22T00:00:00.000Z' };
  await settlement.upsert(original);
  const entered = deferred();
  const release = deferred();
  let held = false;
  const read = settlement.read.bind(settlement);
  t.mock.method(settlement, 'read', async () => {
    const snapshot = await read();
    if (!held) { held = true; entered.resolve(); await release.promise; }
    return snapshot;
  });
  const finishing = settlement.mutate(original.id, current => ({ ...current,
    lastRun: '2026-10-21T00:00:00.000Z', nextRun: '2026-10-23T00:00:00.000Z' }));
  await entered.promise;
  const edited = editor.mutate(original.id, current => ({ ...current, schedule: 'daily 09:00',
    nextRun: '2026-10-22T01:00:00.000Z', prompt: '修改后的任务' }));
  const paused = feature.tasks.setEnabled(original.id, false);
  release.resolve();
  await Promise.all([finishing, edited, paused]);
  const stored = await settlement.get(original.id);
  assert.equal(stored?.enabled, false);
  assert.equal(stored?.schedule, 'daily 09:00');
  assert.equal(stored?.nextRun, '2026-10-22T01:00:00.000Z');
  assert.equal(stored?.prompt, '修改后的任务');
  assert.equal(stored?.lastRun, '2026-10-21T00:00:00.000Z');
});

function task(id: string, name: string) {
  return {
    id, name, schedule: 'every 5m', prompt: `${name} private prompt`, agentId: 'agent-a',
    repeatCount: -1, pushMode: 'accumulate' as const, windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled: false,
    createdAt: '2026-09-29T00:00:00.000Z',
  };
}

async function tempDataDir(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-s1-tide-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
