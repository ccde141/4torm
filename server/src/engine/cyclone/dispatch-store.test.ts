import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createDispatch,
  expireDispatchDecisions,
  listRoomDispatches,
  listWorkshopDispatches,
  subscribeDispatchChanges,
  updateDispatch,
} from './dispatch-store.js';
import { activateDispatch, claimDispatch, withdrawExpiredDispatch } from './dispatch-admission.js';

test('派发创建和终态提交后通知，重复创建与活动进度不通知', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-notify-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const seen: string[] = [];
  subscribeDispatchChanges(dataDir, () => { throw new Error('SSE 已断开'); });
  const stop = subscribeDispatchChanges(dataDir, item => seen.push(`${item.id}:${item.status}`));
  t.after(stop);
  const input = { workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 2,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '实现接口' };
  const created = await createDispatch(dataDir, input);
  await createDispatch(dataDir, input);
  await updateDispatch(dataDir, 'work-a', created.id, { activity: { phase: 'llm-waiting' } });
  await updateDispatch(dataDir, 'work-a', created.id, { status: 'completed', response: '完成' });
  assert.deepEqual(seen, [`${created.id}:queued`, `${created.id}:completed`]);
  stop();
  await updateDispatch(dataDir, 'work-a', created.id, { decisionState: 'included' });
  assert.equal(seen.length, 2);
});

test('派发记录独立落盘并按来源房间读取', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const created = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 2,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '实现接口',
  });

  assert.equal(created.status, 'queued');
  assert.equal(created.readState, 'unread');
  assert.equal(created.decisionState, 'pending');
  assert.deepEqual((await listRoomDispatches(dataDir, 'work-a', 'room-a')).map(x => x.id), [created.id]);
  assert.deepEqual(await listRoomDispatches(dataDir, 'work-a', 'room-b'), []);
});

test('完成状态与回执原子更新且三轮后只过期未处理决策', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const created = await createDispatch(dataDir, {
    workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-1', sourceRoundSeq: 4,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '后端', task: '实现接口',
  });

  await updateDispatch(dataDir, 'work-a', created.id, {
    status: 'completed', response: '接口已经完成', completedAt: new Date().toISOString(),
    decisionDeadlineRoundSeq: 7,
  });
  assert.equal(await expireDispatchDecisions(dataDir, 'work-a', 'room-a', 6), 0);
  assert.equal(await expireDispatchDecisions(dataDir, 'work-a', 'room-a', 7), 1);

  const [expired] = await listRoomDispatches(dataDir, 'work-a', 'room-a');
  assert.equal(expired.decisionState, 'expired');
  assert.equal(expired.response, '接口已经完成');
});

test('相同来源轮次与顺序的重复派发只落盘一次', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-idempotent-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const input = {
    workshopId: 'work-a', sourceKind: 'room' as const, sourceRoomId: 'room-a',
    sourceSeatId: 'seat-a', sourceSeatTitle: '架构', sourceTurnId: 'turn-1',
    sourceRoundSeq: 1, dispatchOrder: 0, targetSeatId: 'seat-b',
    targetSeatTitle: '后端', task: '实现接口',
  };

  const [first, repeated] = await Promise.all([
    createDispatch(dataDir, input),
    createDispatch(dataDir, input),
  ]);

  assert.equal(repeated.id, first.id);
  assert.equal((await listWorkshopDispatches(dataDir, 'work-a')).length, 1);
});

test('相同投递身份不能悄悄改写任务内容', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-conflict-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const input = {
    workshopId: 'work-a', sourceKind: 'seat' as const, sourceRoomId: '',
    sourceSeatId: 'seat-a', sourceSeatTitle: '架构', sourceTurnId: 'turn-1',
    sourceRoundSeq: 0, dispatchOrder: 0, targetSeatId: 'seat-b',
    targetSeatTitle: '后端', task: '实现接口', receiptState: 'pending' as const,
  };
  await createDispatch(dataDir, input);

  await assert.rejects(
    createDispatch(dataDir, { ...input, task: '删除接口' }),
    /派发幂等键冲突/,
  );
  const [saved] = await listWorkshopDispatches(dataDir, 'work-a');
  assert.equal(saved.task, '实现接口');
});

test('接入与期限撤回竞争同一落盘槽，撤回后旧快照不能复活', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-admission-race-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const input = { workshopId: 'work-a', sourceKind: 'seat' as const, sourceRoomId: '',
    sourceSeatId: 'seat-a', sourceSeatTitle: '调度', sourceRoundSeq: 0,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '核验', task: '核验' };
  const accepted = await createDispatch(dataDir, { ...input, sourceTurnId: 'accepted' });
  const deadline = Date.parse(accepted.admissionDeadlineAt!);
  const [claim, afterExpiry] = await Promise.all([
    claimDispatch(dataDir, 'work-a', accepted.id, deadline - 1),
    withdrawExpiredDispatch(dataDir, 'work-a', accepted.id, deadline + 1),
  ]);
  assert.equal(claim.claimed, true);
  assert.equal(afterExpiry?.status, 'running');
  assert.equal(afterExpiry?.delivered, true);
  const expired = await createDispatch(dataDir, { ...input, sourceTurnId: 'expired' });
  const expiredDeadline = Date.parse(expired.admissionDeadlineAt!);
  const [withdrawn, lateClaim] = await Promise.all([
    withdrawExpiredDispatch(dataDir, 'work-a', expired.id, expiredDeadline),
    claimDispatch(dataDir, 'work-a', expired.id, expiredDeadline - 1),
  ]);
  assert.equal(withdrawn?.errorCode, 'CYCLONE_TARGET_BUSY');
  assert.equal(withdrawn?.delivered, false);
  assert.equal(withdrawn?.decisionState, 'not_applicable');
  assert.equal(lateClaim.claimed, false);
  const revived = await updateDispatch(dataDir, 'work-a', expired.id, { status: 'running', delivered: true });
  assert.equal(revived?.status, 'failed');
  assert.equal(revived?.delivered, false);
});

test('群聊未放行时不计入接入期限，放行后从允许投递时刻计30秒', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-deferred-admission-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const item = await createDispatch(dataDir, { workshopId: 'work-a', sourceRoomId: 'room-a',
    sourceSeatId: 'seat-a', sourceSeatTitle: '调度', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '核验', task: '核验', deliveryDeferred: true });
  const later = Date.parse(item.createdAt) + 120_000;
  assert.equal(item.admissionDeadlineAt, undefined);
  assert.equal((await withdrawExpiredDispatch(dataDir, 'work-a', item.id, later))?.status, 'queued');
  assert.equal((await claimDispatch(dataDir, 'work-a', item.id, later)).claimed, false);
  const ready = await activateDispatch(dataDir, 'work-a', item.id, later);
  assert.equal(Date.parse(ready!.admissionDeadlineAt!) - later, 30_000);
  const repeated = await activateDispatch(dataDir, 'work-a', item.id, later + 20_000);
  assert.equal(repeated?.admissionDeadlineAt, ready?.admissionDeadlineAt, '重复kick不得延长期限');
});
