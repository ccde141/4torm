import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch, updateDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { createWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { createCycloneRuntimeSource } from './operation-adapter.js';
import { beginSeatContact } from '../../../engine/cyclone/seat-event-journal.js';
import { mutateSupervisor } from '../../../engine/cyclone/supervisor-store.js';
import type { CycloneRunSnapshot } from '../domain/operation-snapshot.js';

test('派发实体不伪装成可精确查询的执行轮次', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-probe-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '工作室' });
  const dispatch = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '实现', task: '检查接口',
  });
  const source = createCycloneRuntimeSource(dataDir, {
    list: () => [], signal: () => new AbortController().signal,
  });
  const active = (await source.snapshots()).find(item => item.operationId === `dispatch:${dispatch.id}`);
  assert.equal(active?.status, 'queued');
  assert.equal(active?.runId, undefined);
  await updateDispatch(dataDir, workshop.id, dispatch.id, { status: 'completed' });
  const settled = (await source.snapshots()).find(item => item.operationId === `dispatch:${dispatch.id}`);
  assert.equal(settled?.status, 'completed');
  assert.equal(settled?.runId, undefined);
});

test('内部工位联络复用工位探针身份，结束后不残留运行态', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-contact-probe-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '联络工作室' });
  const source = createCycloneRuntimeSource(dataDir, {
    list: () => [], signal: () => new AbortController().signal,
  });
  const lease = await beginSeatContact(dataDir, { workshopId: workshop.id,
    seatId: 'seat-b', agentId: 'agent-a', sourceSeatId: 'seat-a',
    sourceTitle: '统筹', title: '检查验收条件' });
  const identity = `seat:${workshop.id}:seat-b`;
  const active = await source.snapshots();
  assert.equal(active.find(item => item.operationId === identity)?.status, 'running');
  assert.equal(active.find(item => item.operationId === identity)?.phase, 'seat-contact');
  assert.equal(active.find(item => item.operationId === identity)?.runId, undefined);
  assert.equal(active.find(item => item.operationId === workshop.id)?.status, 'running');
  await lease.finish('completed');
  const done = await source.snapshots();
  assert.equal(done.find(item => item.operationId === identity)?.status, 'completed');
  assert.equal(done.find(item => item.operationId === workshop.id)?.status, 'idle');
});

test('主管 Ask 只将当前挂起轮次投影为等待，不污染旧轮次或失败事实', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-supervisor-probe-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '主管工作室' });
  await mutateSupervisor(dataDir, workshop.id, current => {
    current.pending = { question: '采用哪个方案？', native: true, pendingToolCallId: 'ask-current' };
  });
  const current: CycloneRunSnapshot = { workshopId: workshop.id,
    operationId: `supervisor:${workshop.id}:supervisor`, targetKind: 'supervisor', targetId: 'supervisor',
    phase: 'supervisor-chat', runId: 'current', status: 'completed',
    startedAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:01.000Z' };
  const old = { ...current, runId: 'old', startedAt: '2026-10-19T01:00:00.000Z' };
  let records = [old];
  const source = createCycloneRuntimeSource(dataDir,
    { list: () => [], signal: () => new AbortController().signal },
    { list: async () => records, latest: async () => current });
  assert.equal((await source.snapshots()).find(item => item.runId === 'old')?.status, 'completed');
  records = [current];
  const snapshots = await source.snapshots();
  assert.equal(snapshots.find(item => item.runId === 'current')?.status, 'waiting');
  assert.equal(snapshots.find(item => item.runId === 'current')?.waitingReason, '等待人类回答');
  current.status = 'failed'; current.error = '执行失败';
  const failed = (await source.snapshots()).find(item => item.runId === 'current');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.waitingReason, undefined);
  current.status = 'completed';
  await mutateSupervisor(dataDir, workshop.id, supervisor => { supervisor.pending = undefined; });
  assert.equal((await source.snapshots()).find(item => item.runId === 'current')?.status, 'completed');
});
