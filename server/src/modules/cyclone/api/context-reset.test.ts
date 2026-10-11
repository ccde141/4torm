import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { loadRoom, saveRoom } from '../../../engine/cyclone/room-store.js';
import { loadSeat, saveSeat } from '../../../engine/cyclone/seat-store.js';
import { createCycloneFeature } from './factory.js';

const context = {
  actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const },
  audience: 'human' as const,
  enabledFeatures: new Set(['cyclone']),
  permissions: new Set(['administer' as const]),
  requestId: 'context-reset-test',
};

test('中心重置只接收意图并由应用服务生成对应范围摘要', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-reset-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const calls: Array<{ agentId: string; subject: string }> = [];
  const summarizer = { summarize: async (input: { agentId: string; subject: string }) => {
    calls.push(input);
    return `摘要:${input.subject}`;
  } };
  const feature = createCycloneFeature({ dataDir, summarizer } as never);
  const router = new CollaborationRouter([feature.module]);
  const workshop = await feature.workshops.create({ title: '组', chairAgentId: 'chair-a' });
  const seat = await feature.workshops.addSeat({
    workshopId: workshop.id, agentId: 'seat-a', title: '研究员',
  });
  const room = await feature.rooms.create({ workshopId: workshop.id, title: '评审会' });
  const seatData = await loadSeat(dataDir, workshop.id, seat.id);
  assert.ok(seatData);
  seatData.messages = [{ role: 'user', content: '工位上下文' }];
  await saveSeat(dataDir, workshop.id, seatData);
  const roomData = await loadRoom(dataDir, workshop.id, room.id);
  assert.ok(roomData);
  roomData.publicMessages = [{ speaker: '人类', content: '公共上下文', timestamp: 1 }];
  roomData.chairMessages = [{ role: 'user', content: '会长上下文' }];
  await saveRoom(dataDir, workshop.id, roomData);

  await router.invoke({ feature: 'cyclone', method: 'compactSeatContext', input: {
    workshopId: workshop.id, seatId: seat.id,
  } }, context);
  await router.invoke({ feature: 'cyclone', method: 'compactRoomContext', input: {
    workshopId: workshop.id, roomId: room.id, scope: 'both',
  } }, context);

  assert.deepEqual(calls.map(call => call.agentId), ['seat-a', 'chair-a', 'chair-a']);
  assert.match((await loadSeat(dataDir, workshop.id, seat.id))?.messages[0].content ?? '', /摘要:工位/);
  const resetRoom = await loadRoom(dataDir, workshop.id, room.id);
  assert.match(resetRoom?.publicMessages[0].content ?? '', /摘要:群聊/);
  assert.match(resetRoom?.chairMessages?.[0].content ?? '', /摘要:群聊/);
  assert.equal(resetRoom?.dispatchContextVersion || 0, 0);
  await router.invoke({ feature: 'cyclone', method: 'resetRoomContext', input: {
    workshopId: workshop.id, roomId: room.id, mode: 'clear', scope: 'public',
  } }, context);
  const cleared = await loadRoom(dataDir, workshop.id, room.id);
  assert.deepEqual(cleared?.publicMessages, []);
  assert.equal(cleared?.dispatchContextVersion, 1);
  assert.match(cleared?.chairMessages?.[0].content ?? '', /摘要:群聊/);
});

test('摘要生成失败时保留原上下文且不伪装成已重置', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-reset-fail-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const summarizer = { summarize: async () => { throw new Error('模型不可用'); } };
  const feature = createCycloneFeature({ dataDir, summarizer } as never);
  const router = new CollaborationRouter([feature.module]);
  const workshop = await feature.workshops.create({ title: '组' });
  const seat = await feature.workshops.addSeat({
    workshopId: workshop.id, agentId: 'seat-a', title: '研究员',
  });
  const seatData = await loadSeat(dataDir, workshop.id, seat.id);
  assert.ok(seatData);
  seatData.messages = [{ role: 'user', content: '不能丢失' }];
  await saveSeat(dataDir, workshop.id, seatData);

  await assert.rejects(() => router.invoke({
    feature: 'cyclone', method: 'resetSeatContext', input: {
      workshopId: workshop.id, seatId: seat.id, mode: 'summary',
    },
  }, context), /模型不可用/);
  assert.equal((await loadSeat(dataDir, workshop.id, seat.id))?.messages[0].content, '不能丢失');
  const archives = await fs.readdir(path.join(dataDir, 'cyclone', workshop.id, 'bak'));
  assert.equal(archives.length, 1);
  const archive = JSON.parse(await fs.readFile(path.join(dataDir, 'cyclone', workshop.id, 'bak', archives[0]), 'utf8'));
  assert.equal(archive.messages[0].content, '不能丢失');
});
