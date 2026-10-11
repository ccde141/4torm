import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { tideTasksFile } from '../../../services/data-paths.js';
import { FileTideTaskRepository } from './task-repository.js';

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
