import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { convectionRunFile } from '../../../services/data-paths.js';
import { ConvectionRunRepository } from './run-repository.js';

test('对流轮次记录持久化运行身份与真实终态', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convection-runs-'));
  try {
    const repository = new ConvectionRunRepository(root);
    await repository.start({
      sessionId: 'conv-a', runId: 'run-a', round: 'public',
      startedAt: '2026-09-30T00:00:00.000Z',
    });
    assert.equal((await repository.latest('conv-a'))?.status, 'running');
    await repository.finish('conv-a', 'run-a', 'completed');
    const reloaded = new ConvectionRunRepository(root);
    assert.equal((await reloaded.latest('conv-a'))?.status, 'completed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('同一会话多次轮次在重启后仍可按各自 runId 检查', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convection-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new ConvectionRunRepository(root);
  await repository.start({ sessionId: 'conv-a', runId: 'run-a', round: 'public',
    startedAt: '2026-09-30T00:00:00.000Z' });
  await repository.finish('conv-a', 'run-a', 'completed');
  await repository.start({ sessionId: 'conv-a', runId: 'run-b', round: 'chair',
    startedAt: '2026-09-30T01:00:00.000Z' });
  await repository.finish('conv-a', 'run-b', 'failed', '检查失败');
  const reloaded = new ConvectionRunRepository(root);
  assert.equal((await reloaded.get('conv-a', 'run-a'))?.status, 'completed');
  assert.equal((await reloaded.get('conv-a', 'run-b'))?.status, 'failed');
  assert.equal((await reloaded.latest('conv-a'))?.runId, 'run-b');
});

test('旧版单文件运行记录重启只恢复一次', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convection-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.dirname(convectionRunFile(root, 'conv-a')), { recursive: true });
  await writeFile(convectionRunFile(root, 'conv-a'), JSON.stringify({
    sessionId: 'conv-a', runId: 'run-a', round: 'public', status: 'running',
    startedAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
  }));
  assert.equal(await new ConvectionRunRepository(root).initialize(), 1);
  const reloaded = new ConvectionRunRepository(root);
  assert.equal(await reloaded.initialize(), 0);
  assert.equal((await reloaded.get('conv-a', 'run-a'))?.status, 'crashed');
});

test('对流启动恢复把遗留运行状态校正为 crashed 且不重跑', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convection-recovery-'));
  try {
    await new ConvectionRunRepository(root).start({
      sessionId: 'conv-a', runId: 'run-a', round: 'chair',
      startedAt: '2026-09-30T00:00:00.000Z',
    });
    const reloaded = new ConvectionRunRepository(root);
    assert.equal(await reloaded.initialize(), 1);
    const recovered = await reloaded.latest('conv-a');
    assert.equal(recovered?.status, 'crashed');
    assert.equal(recovered?.runId, 'run-a');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('对流终态写入要求匹配当前轮次身份', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convection-identity-'));
  try {
    const repository = new ConvectionRunRepository(root);
    await repository.start({
      sessionId: 'conv-a', runId: 'run-a', round: 'public',
      startedAt: '2026-09-30T00:00:00.000Z',
    });
    await assert.rejects(
      repository.finish('conv-a', 'run-old', 'failed'),
      error => (error as { data?: { code?: string } }).data?.code === 'CONVECTION_RUN_CHANGED',
    );
    assert.equal((await repository.latest('conv-a'))?.status, 'running');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('对流只在终态持久化完成后通知等待者', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convection-notify-'));
  try {
    const repository = new ConvectionRunRepository(root);
    await repository.start({
      sessionId: 'conv-a', runId: 'run-a', round: 'public',
      startedAt: '2026-09-30T00:00:00.000Z',
    });
    let persistedStatus: string | undefined;
    repository.subscribe('conv-a', 'run-a', () => {
      const record = JSON.parse(readFileSync(convectionRunFile(root, 'conv-a', 'run-a'), 'utf8')) as {
        status?: string;
      };
      persistedStatus = record.status;
    });
    await repository.finish('conv-a', 'run-a', 'completed');
    assert.equal(persistedStatus, 'completed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
