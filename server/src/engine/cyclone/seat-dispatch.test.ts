import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadDispatch, updateDispatch } from './dispatch-store.js';
import { addSeat, loadSeat, saveSeat } from './seat-store.js';
import {
  createSeatDispatchRecord,
  deliverSeatDispatchReceipts,
  createSupervisorDispatchRecord,
} from './seat-dispatch.js';
import { createWorkshop } from './workshop-store.js';

test('工位异步派发完成后只向源工位上下文投递一次回执', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-dispatch-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const source = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '调度' });
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '后端' });

  const dispatch = await createSeatDispatchRecord(dataDir, {
    workshopId: workshop.id, sourceSeatId: source.id, sourceSeatTitle: source.title,
    targetSeatTitle: target.title, task: '实现接口', sourceTurnId: 'seat-turn-a', dispatchOrder: 0,
  });
  assert.equal(dispatch.sourceKind, 'seat');
  assert.equal(dispatch.decisionState, 'not_applicable');
  assert.equal(dispatch.receiptState, 'pending');
  await updateDispatch(dataDir, workshop.id, dispatch.id, {
    status: 'completed', response: '接口已经完成', completedAt: new Date().toISOString(),
  });

  const firstSeat = await loadSeat(dataDir, workshop.id, source.id);
  assert.ok(firstSeat);
  assert.equal(await deliverSeatDispatchReceipts(dataDir, workshop.id, firstSeat), 1);
  const deliveredSeat = await loadSeat(dataDir, workshop.id, source.id);
  assert.equal(deliveredSeat?.messages.length, 1);
  assert.equal(deliveredSeat?.messages[0].kind, 'dispatch-receipt');
  assert.equal(deliveredSeat?.messages[0].dispatchId, dispatch.id);
  assert.match(deliveredSeat?.messages[0].content || '', /接口已经完成/);
  assert.equal((await loadDispatch(dataDir, workshop.id, dispatch.id))?.receiptState, 'delivered');

  assert.ok(deliveredSeat);
  assert.equal(await deliverSeatDispatchReceipts(dataDir, workshop.id, deliveredSeat), 0);
  assert.equal((await loadSeat(dataDir, workshop.id, source.id))?.messages.length, 1);
});

test('主管派发拥有独立来源且只能投递当前工作室现役工位', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supervisor-dispatch-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '核验' });
  const item = await createSupervisorDispatchRecord(dataDir, { workshopId: workshop.id,
    targetSeatTitle: target.title, task: '核验', sourceTurnId: 'supervisor-turn-a' });
  assert.equal(item.sourceKind, 'supervisor'); assert.equal(item.sourceSeatId, 'supervisor');
  assert.equal(item.decisionState, 'not_applicable'); assert.equal(item.targetSeatId, target.id);
  assert.equal(item.receiptState, 'pending'); assert.ok(item.admissionDeadlineAt);
  await assert.rejects(createSupervisorDispatchRecord(dataDir, { workshopId: workshop.id,
    targetSeatTitle: '未知', task: '核验', sourceTurnId: 'supervisor-turn-b' }), /目标工位不存在/);
  const other = await createWorkshop(dataDir);
  const foreign = await addSeat(dataDir, other.id, { agentId: 'agent-a', title: '外部核验' });
  await assert.rejects(createSupervisorDispatchRecord(dataDir, { workshopId: workshop.id,
    targetSeatTitle: foreign.id, task: '不可跨工作室', sourceTurnId: 'supervisor-turn-c' }), /不属于当前工作室/);
  const duplicate = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '临时工位' });
  duplicate.title = target.title;
  await saveSeat(dataDir, workshop.id, duplicate);
  await assert.rejects(createSupervisorDispatchRecord(dataDir, { workshopId: workshop.id,
    targetSeatTitle: target.title, task: '不可猜测同名目标', sourceTurnId: 'supervisor-turn-d' }), /名称存在歧义/);
  await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: target.id });
  const byId = await createSupervisorDispatchRecord(dataDir, { workshopId: workshop.id,
    targetSeatTitle: target.id, task: 'ID 优先寻址', sourceTurnId: 'supervisor-turn-e' });
  assert.equal(byId.targetSeatId, target.id);
  assert.equal(byId.targetSeatTitle, target.title);
});
