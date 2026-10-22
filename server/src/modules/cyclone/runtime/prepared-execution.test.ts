import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCycloneFeature } from '../api/factory.js';
import { tryAcquireSeatLock } from '../../../engine/cyclone/seat-store.js';
import { tryAcquireRoomLock } from '../../../engine/cyclone/room-store.js';

test('工位、会长、入会介绍与群聊准备均可幂等释放，未运行资源随关闭释放', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-prepared-'));
  const feature = createCycloneFeature({ dataDir });
  t.after(async () => { await feature.shutdown(); feature.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const workshop = await feature.workshops.create({ chairAgentId: 'fixture-chair' });
  const seat = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'fixture-agent', title: '岗位' });
  const room = await feature.rooms.create({ workshopId: workshop.id, participantSeatIds: [seat.id] });
  const input = { workshopId: workshop.id, roomId: room.id };
  const prepare = [
    () => feature.seatChats.prepare({ workshopId: workshop.id, seatId: seat.id, mode: 'chat' as const, text: '开始' }),
    () => feature.chairChats.prepare({ ...input, message: '开始' }),
    () => feature.roomIntroductions.prepare({ ...input, intros: [] }),
    () => feature.roomRounds.prepare({ ...input, message: '开始' }),
  ];
  for (const factory of prepare) {
    const prepared = await factory();
    assert.equal(feature.executions.list().length, 1);
    await Promise.all([prepared.dispose(new Error('首帧写入失败')), prepared.dispose()]);
    assert.equal(feature.executions.list().length, 0);
    assert.equal((await feature.runs.latest(prepared.execution.operationId))?.status, 'failed');
    await assert.rejects(prepared.run(), /准备已结束/);
  }
  const pending = await prepare[0]();
  await feature.shutdown();
  assert.equal(feature.executions.list().length, 0);
  assert.equal((await feature.runs.latest(pending.execution.operationId))?.status, 'aborted');
  for (const release of [tryAcquireSeatLock(workshop.id, seat.id), tryAcquireRoomLock(workshop.id, room.id)]) {
    assert.ok(release); release();
  }
});
