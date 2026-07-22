import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRoomDispatchRecord } from './room-dispatch.js';
import { addSeat } from './seat-store.js';
import { createWorkshop } from './workshop-store.js';

test('群聊副本可以把任务派发给自己的固定工位', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-self-dispatch-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '架构' });

  const dispatch = await createRoomDispatchRecord(dataDir, {
    workshopId: workshop.id, roomId: 'room-a', sourceSeatId: seat.id,
    sourceSeatTitle: seat.title, sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    contextVersion: 0, dispatchOrder: 0, targetSeatTitle: seat.title, task: '整理方案',
  });

  assert.equal(dispatch.sourceSeatId, dispatch.targetSeatId);
  assert.equal(dispatch.targetSeatTitle, seat.title);
});
