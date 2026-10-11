import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkshop } from './workshop-store.js';
import { addSeat } from './seat-store.js';
import { createRoom, loadRoom } from './room-store.js';
import { speakInRoom } from './room-runner.js';

test('工位执行异常时已接受的群聊输入仍保存在真实会话', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cyclone-round-persist-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '持久化检查' });
  const seat = await addSeat(dataDir, workshop.id, { title: '检查员', agentId: 'agent-missing' });
  const room = await createRoom(dataDir, workshop.id,
    { title: '讨论', topic: '异常中保留事实', participantSeatIds: [seat.id] });
  await assert.rejects(speakInRoom(dataDir, workshop.id, room, '需要检查的需求', event => {
    if (event.type === 'seat-start') throw new Error('界面事件通道故障');
  }), /界面事件通道故障/);
  const saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.ok(saved?.publicMessages.some(item => item.content === '需要检查的需求'));
});
