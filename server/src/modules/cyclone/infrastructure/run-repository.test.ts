import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CycloneRunRepository } from './run-repository.js';

const execution = {
  operationId: 'seat:workshop-a:seat-a', runId: 'cyclone-run-a',
  workshopId: 'workshop-a', targetKind: 'seat' as const, targetId: 'seat-a',
  phase: 'seat-chat' as const, startedAt: '2026-09-30T00:00:00.000Z',
};

test('气旋运行记录持久化完整执行身份与真实终态', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-runs-'));
  try {
    const repository = new CycloneRunRepository(root);
    await repository.start(execution);
    assert.equal((await repository.latest(execution.operationId))?.status, 'running');
    await repository.finish(execution.operationId, execution.runId, 'completed');
    const reloaded = new CycloneRunRepository(root);
    const latest = await reloaded.latest(execution.operationId);
    assert.equal(latest?.status, 'completed');
    assert.equal(latest?.phase, 'seat-chat');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('群聊运行记录重启后保留多个实际参与 Agent', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-participants-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const room = { ...execution, operationId: 'room:workshop-a:room-a',
    targetKind: 'room' as const, targetId: 'room-a', phase: 'room-speak' as const };
  const repository = new CycloneRunRepository(root);
  await repository.start(room);
  await repository.finish(room.operationId, room.runId, 'completed', undefined, ['agent-a']);
  assert.deepEqual((await new CycloneRunRepository(root).get(room.operationId, room.runId))?.agentIds,
    ['agent-a']);
});

test('同一事项的两次运行重启后仍能按各自 runId 读取', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new CycloneRunRepository(root);
  await repository.start(execution);
  await repository.finish(execution.operationId, execution.runId, 'completed');
  const second = { ...execution, runId: 'cyclone-run-b',
    startedAt: '2026-09-30T01:00:00.000Z' };
  await repository.start(second);
  await repository.finish(second.operationId, second.runId, 'failed', '验证失败');

  const reloaded = new CycloneRunRepository(root);
  assert.equal((await reloaded.get(execution.operationId, execution.runId))?.status, 'completed');
  assert.equal((await reloaded.get(second.operationId, second.runId))?.status, 'failed');
  assert.equal((await reloaded.latest(execution.operationId))?.runId, second.runId);
  assert.equal((await reloaded.list()).length, 1);
  const history = await reloaded.history(execution.workshopId);
  assert.equal(history.length, 2);
  assert.equal(history.find(item => item.runId === second.runId)?.status, 'failed');
  history[0].status = 'running';
  assert.equal((await reloaded.history('another-workshop')).length, 0);
  assert.equal((await reloaded.history()).some(item => item.status === 'running'), false);
});

test('气旋启动恢复把遗留运行状态校正为 crashed 且不重跑', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-recovery-'));
  try {
    await new CycloneRunRepository(root).start(execution);
    const reloaded = new CycloneRunRepository(root);
    assert.equal(await reloaded.initialize(), 1);
    const recovered = await reloaded.latest(execution.operationId);
    assert.equal(recovered?.status, 'crashed');
    assert.equal(recovered?.runId, execution.runId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('旧版单文件运行记录恢复一次后不再重复崩溃', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cyclone', 'runtime');
  await mkdir(directory, { recursive: true });
  const name = createHash('sha256').update(execution.operationId).digest('hex');
  await writeFile(path.join(directory, `${name}.json`), JSON.stringify({
    ...execution, status: 'running', updatedAt: execution.startedAt,
  }));
  const first = new CycloneRunRepository(root);
  assert.equal(await first.initialize(), 1);
  assert.equal((await first.get(execution.operationId, execution.runId))?.status, 'crashed');
  const second = new CycloneRunRepository(root);
  assert.equal(await second.initialize(), 0);
  assert.equal((await second.get(execution.operationId, execution.runId))?.status, 'crashed');
});

test('气旋终态写入要求匹配当前运行身份', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-identity-'));
  try {
    const repository = new CycloneRunRepository(root);
    await repository.start(execution);
    await assert.rejects(
      repository.finish(execution.operationId, 'cyclone-run-old', 'failed'),
      error => (error as { data?: { code?: string } }).data?.code === 'CYCLONE_RUN_CHANGED',
    );
    assert.equal((await repository.latest(execution.operationId))?.status, 'running');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('损坏的气旋运行记录阻止启动且保留原文', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-corrupt-'));
  const directory = path.join(root, 'cyclone', 'runtime');
  const file = path.join(directory, 'broken.json');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(file, '{broken', 'utf8');
    await assert.rejects(
      new CycloneRunRepository(root).initialize(),
      error => (error as { data?: { code?: string } }).data?.code === 'CYCLONE_RUN_CORRUPT',
    );
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('运行文件身份不匹配时不把损坏记录伪装成未找到', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cyclone-mismatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new CycloneRunRepository(root);
  await repository.start(execution);
  await repository.finish(execution.operationId, execution.runId, 'completed');
  const directory = path.join(root, 'cyclone', 'runtime');
  const [file] = await readdir(directory);
  assert.ok(file);
  await writeFile(path.join(directory, file), JSON.stringify({
    ...execution, operationId: 'seat:other:seat-a',
    status: 'completed', updatedAt: execution.startedAt,
  }));
  await assert.rejects(repository.get(execution.operationId, execution.runId),
    error => (error as { data?: { code?: string } }).data?.code === 'CYCLONE_RUN_CORRUPT');
});
