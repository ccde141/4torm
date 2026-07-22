import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createDispatch,
  expireDispatchDecisions,
  listRoomDispatches,
  updateDispatch,
} from './dispatch-store.js';

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
