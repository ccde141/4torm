import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { FileTideRunStateRepository } from './run-state-repository.js';
import { TideChangeFeed } from '../application/change-feed.js';

test('潮汐运行事实按 runId 完成完整生命周期', async (t) => {
  const repository = new FileTideRunStateRepository(await tempDataDir(t));
  const queued = await repository.create('task-a', 'manual');
  assert.equal(queued.status, 'queued');
  assert.ok(queued.runId.startsWith('tide-run-'));

  const running = await repository.markRunning('task-a', queued.runId);
  assert.equal(running.status, 'running');
  assert.ok(running.startedAt);

  const completed = await repository.finish('task-a', queued.runId, 'completed');
  assert.equal(completed.status, 'completed');
  assert.ok(completed.finishedAt);
  assert.deepEqual(await repository.get('task-a'), completed);
});

test('每次模型调用后持久化实际用量，缺失用量清空最新值但保留已知累计', async t => {
  const dataDir = await tempDataDir(t);
  const repository = new FileTideRunStateRepository(dataDir);
  const queued = await repository.create('task-usage', 'manual');
  await repository.markRunning('task-usage', queued.runId);
  const first = await repository.recordUsage('task-usage', queued.runId,
    { promptTokens: 12, completionTokens: 3, totalTokens: 15 });
  assert.deepEqual(first.usage, { calls: 1, reportedCalls: 1,
    latest: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    total: { promptTokens: 12, completionTokens: 3, totalTokens: 15 } });
  const missing = await repository.recordUsage('task-usage', queued.runId, null);
  assert.deepEqual(missing.usage, { calls: 2, reportedCalls: 1,
    total: { promptTokens: 12, completionTokens: 3, totalTokens: 15 } });
  assert.deepEqual((await new FileTideRunStateRepository(dataDir)
    .getRun('task-usage', queued.runId))?.usage, missing.usage);
});

test('compaction notices are durable before invalidation, survive scheduled runs and clear only on accepted human input', async t => {
  const dataDir = await tempDataDir(t);
  const changes = new TideChangeFeed();
  const repository = new FileTideRunStateRepository(dataDir, changes);
  const pending: Array<Promise<string | undefined>> = [];
  const remove = changes.subscribe(event => {
    if (event.scope === 'run') pending.push(repository.getRun(event.taskId, event.runId)
      .then(state => state?.compactionNotice));
  });
  const first = await repository.create('notice-task', 'schedule');
  await repository.markRunning('notice-task', first.runId);
  await repository.recordCompactionNotice('notice-task', first.runId, '压缩模型离线，已改用会话模型');
  assert.equal((await repository.get('notice-task'))?.status, 'running');
  assert.equal((await repository.get('notice-task'))?.compactionNotice, '压缩模型离线，已改用会话模型');
  await repository.finish('notice-task', first.runId, 'completed');
  assert.equal((await repository.create('notice-task', 'schedule')).compactionNotice,
    '压缩模型离线，已改用会话模型');
  assert.equal((await repository.create('notice-task', 'manual')).compactionNotice,
    '压缩模型离线，已改用会话模型');
  const accepted = await repository.create('notice-task', 'manual', undefined, true);
  assert.equal(accepted.compactionNotice, undefined);
  await repository.recordCompactionNotice('notice-task', accepted.runId, '新故障');
  await repository.acknowledgeCompactionNotice('notice-task');
  assert.equal((await repository.get('notice-task'))?.compactionNotice, undefined);
  assert.equal((await repository.getRun('notice-task', first.runId))?.compactionNotice,
    '压缩模型离线，已改用会话模型');
  remove();
  assert.ok((await Promise.all(pending)).includes('压缩模型离线，已改用会话模型'));
});

test('旧运行不能覆盖同一任务的新运行事实', async (t) => {
  const repository = new FileTideRunStateRepository(await tempDataDir(t));
  const first = await repository.create('task-a', 'schedule');
  await repository.create('task-a', 'manual');

  await assert.rejects(
    repository.markRunning('task-a', first.runId),
    (error: unknown) => error instanceof FrameworkError
      && error.data.code === 'TIDE_RUN_STATE_STALE',
  );
});

test('潮汐第二次触发后旧 runId 仍可精确读取且重启后保持', async t => {
  const dataDir = await tempDataDir(t);
  const repository = new FileTideRunStateRepository(dataDir);
  const first = await repository.create('task-a', 'manual');
  await repository.finish('task-a', first.runId, 'completed');
  const second = await repository.create('task-a', 'schedule');
  await repository.finish('task-a', second.runId, 'failed', {
    code: 'TIDE_RUN_FAILED', message: '验证失败',
  });
  const reloaded = new FileTideRunStateRepository(dataDir);
  assert.equal((await reloaded.getRun('task-a', first.runId))?.status, 'completed');
  assert.equal((await reloaded.getRun('task-a', second.runId))?.status, 'failed');
  assert.equal((await reloaded.get('task-a'))?.runId, second.runId);
});

test('启动恢复把 queued 与 running 校正为 crashed', async (t) => {
  const repository = new FileTideRunStateRepository(await tempDataDir(t));
  const queued = await repository.create('task-queued', 'schedule');
  const running = await repository.create('task-running', 'manual');
  await repository.markRunning('task-running', running.runId);
  const completed = await repository.create('task-completed', 'manual');
  await repository.finish('task-completed', completed.runId, 'completed');

  assert.equal(await repository.recoverCrashed(), 2);
  assert.equal((await repository.get('task-queued'))?.status, 'crashed');
  assert.equal((await repository.get('task-running'))?.status, 'crashed');
  assert.equal((await repository.get('task-completed'))?.status, 'completed');
  assert.equal((await repository.get('task-queued'))?.runId, queued.runId);
});

test('旧版潮汐单文件事实仍可按 runId 读取且只恢复一次', async t => {
  const dataDir = await tempDataDir(t);
  const directory = path.join(dataDir, 'tide', 'runtime');
  await fs.mkdir(directory, { recursive: true });
  const name = createHash('sha256').update('task-old').digest('hex');
  await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify({
    schemaVersion: 1, taskId: 'task-old', runId: 'tide-run-old',
    trigger: 'manual', status: 'running',
    createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
  }));
  const first = new FileTideRunStateRepository(dataDir);
  assert.equal(await first.recoverCrashed(), 1);
  const second = new FileTideRunStateRepository(dataDir);
  assert.equal(await second.recoverCrashed(), 0);
  assert.equal((await second.getRun('task-old', 'tide-run-old'))?.status, 'crashed');
});

test('损坏的潮汐运行事实不会伪装成空闲', async (t) => {
  const dataDir = await tempDataDir(t);
  const repository = new FileTideRunStateRepository(dataDir);
  await repository.create('task-a', 'manual');
  const runtimeDir = path.join(dataDir, 'tide', 'runtime');
  const taskDir = path.join(runtimeDir, (await fs.readdir(runtimeDir))[0]!);
  const file = path.join(taskDir, (await fs.readdir(taskDir))[0]!);
  await fs.writeFile(file, '{broken', 'utf8');

  await assert.rejects(
    repository.get('task-a'),
    (error: unknown) => error instanceof FrameworkError
      && error.data.code === 'TIDE_RUN_STATE_CORRUPT',
  );
});

async function tempDataDir(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-run-state-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
