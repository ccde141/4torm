import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadDispatch, updateDispatch } from './dispatch-store.js';
import { addSeat, loadSeat } from './seat-store.js';
import {
  createSeatDispatchRecord,
  deliverSeatDispatchReceipts,
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
