import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentRegistryFile, tradewindRunDir } from './data-paths.js';
import { recoverStartupState } from './startup-recovery.js';
import { createDispatch, loadDispatch, updateDispatch } from '../engine/cyclone/dispatch-store.js';
import { createWorkshop } from '../engine/cyclone/workshop-store.js';
import { drainCycloneDispatches } from '../engine/cyclone/dispatch-queue.js';

test('启动恢复释放 Agent 残留锁并标记 Tradewind 运行记录为 crashed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-startup-recovery-'));
  const dataDir = path.join(root, 'data');
  const registryFile = agentRegistryFile(dataDir);
  const runDir = tradewindRunDir(dataDir, 'wf-1', 'run-1');
  await fs.mkdir(path.dirname(registryFile), { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(registryFile, JSON.stringify({
    agentA: { busy: true, status: 'tradewind' },
    agentB: { busy: false, status: 'offline' },
  }));
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify({
    executionId: 'run-1',
    workflowId: 'wf-1',
    startTime: '2026-01-01T00:00:00.000Z',
    status: 'running',
  }));
  const sessionsDir = path.join(dataDir, 'agents', 'agentA', 'sessions');
  const workspaceDir = path.join(dataDir, 'agents', 'agentA', '.workspace');
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  const atomicTemp = path.join(sessionsDir, 'session.json.4321.123e4567-e89b-42d3-a456-426614174000.tmp');
  const storageTemp = path.join(sessionsDir, 'session.json.4321.1760000000000.abc123.tmp');
  const legacyTaskboardTemp = path.join(sessionsDir, 'session.taskboard.json.tmp');
  const ordinaryTemp = path.join(sessionsDir, 'notes.tmp');
  const workspaceTemp = path.join(workspaceDir, 'draft.json.4321.123e4567-e89b-42d3-a456-426614174000.tmp');
  await Promise.all([
    fs.writeFile(atomicTemp, 'partial'),
    fs.writeFile(storageTemp, 'partial'),
    fs.writeFile(legacyTaskboardTemp, 'partial'),
    fs.writeFile(ordinaryTemp, 'keep'),
    fs.writeFile(workspaceTemp, 'keep'),
  ]);

  const result = await recoverStartupState(dataDir);

  assert.equal(result.crashedRuns, 1);
  assert.equal(result.removedTempFiles, 3);
  assert.deepEqual(result.releasedAgents, [
    'agentA (busy)',
    'agentA (status:tradewind→idle)',
  ]);
  const registry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  assert.equal(registry.agentA.busy, false);
  assert.equal(registry.agentA.status, 'idle');
  assert.equal(registry.agentB.status, 'offline');
  const meta = JSON.parse(await fs.readFile(path.join(runDir, 'meta.json'), 'utf8'));
  assert.equal(meta.status, 'crashed');
  assert.equal(typeof meta.endTime, 'string');
  await Promise.all([
    assert.rejects(fs.access(atomicTemp)),
    assert.rejects(fs.access(storageTemp)),
    assert.rejects(fs.access(legacyTaskboardTemp)),
  ]);
  assert.equal(await fs.readFile(ordinaryTemp, 'utf8'), 'keep');
  assert.equal(await fs.readFile(workspaceTemp, 'utf8'), 'keep');
});

test('启动恢复将中断的气旋派发标为失败且不自动重试', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-startup-recovery-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '恢复测试' });
  const dispatch = await createDispatch(dataDir, {
    workshopId: workshop.id,
    sourceRoomId: 'room-a',
    sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度',
    sourceTurnId: 'turn-a',
    sourceRoundSeq: 1,
    dispatchOrder: 0,
    targetSeatId: 'seat-b',
    targetSeatTitle: '执行',
    task: '处理中断任务',
  });
  await updateDispatch(dataDir, workshop.id, dispatch.id, { status: 'running' });

  const result = await recoverStartupState(dataDir);
  const recovered = await loadDispatch(dataDir, workshop.id, dispatch.id);

  assert.equal(result.failedCycloneDispatches, 1);
  assert.equal(recovered?.status, 'failed');
  assert.match(recovered?.error || '', /未自动重试/);
});

test('启动自愈阶段不在运行依赖就绪前消费排队派发', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-startup-recovery-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '恢复测试' });
  const queued = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'missing-seat', targetSeatTitle: '执行', task: '等待启动',
  });

  await recoverStartupState(dataDir);
  await drainCycloneDispatches();
  const recovered = await loadDispatch(dataDir, workshop.id, queued.id);

  assert.equal(recovered?.status, 'queued');
});
