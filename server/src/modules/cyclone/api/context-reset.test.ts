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
  assert.equal(resetRoom?.compaction?.type, 'compact-done');
  assert.equal(resetRoom?.chairCompaction?.type, 'compact-done');
  assert.equal((await loadSeat(dataDir, workshop.id, seat.id))?.compaction?.type, 'compact-done');
  await router.invoke({ feature: 'cyclone', method: 'resetRoomContext', input: {
    workshopId: workshop.id, roomId: room.id, mode: 'clear', scope: 'public',
  } }, context);
  const cleared = await loadRoom(dataDir, workshop.id, room.id);
  assert.deepEqual(cleared?.publicMessages, []);
  assert.equal(cleared?.dispatchContextVersion, 1);
  assert.match(cleared?.chairMessages?.[0].content ?? '', /摘要:群聊/);
});

test('工位、公共会议与会长摘要返回后取消均保留原文，重新加载可继续使用', async t => {
  for (const target of ['seat', 'room', 'chair'] as const) await t.test(target, async child => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-cancel-'));
    child.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    const controller = new AbortController();
    const feature = createCycloneFeature({ dataDir, summarizer: { summarize: async () => {
      controller.abort(new Error('用户停止'));
      return '不应保存的摘要'; // Simulate a model transport that ignores cancellation.
    } } } as never);
    const router = new CollaborationRouter([feature.module]);
    const workshop = await feature.workshops.create({ title: '隔离测试', chairAgentId: 'chair-a' });
    const seat = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'a', title: '工位' });
    const room = await feature.rooms.create({ workshopId: workshop.id, title: '会议' });
    const originalSeat = (await loadSeat(dataDir, workshop.id, seat.id))!;
    originalSeat.messages = [{ role: 'user', content: '原始工位内容' }];
    originalSeat.tokenUsage = { promptTokens: 9000, completionTokens: 10, totalTokens: 9010 };
    await saveSeat(dataDir, workshop.id, originalSeat);
    const originalRoom = (await loadRoom(dataDir, workshop.id, room.id))!;
    originalRoom.publicMessages = [{ speaker: '人类', content: '原始公共内容', timestamp: 1 }];
    originalRoom.chairMessages = [{ role: 'user', content: '原始会长内容' }];
    await saveRoom(dataDir, workshop.id, originalRoom);
    const method = target === 'seat' ? 'compactSeatContext' : target === 'chair' ? 'compactChairContext' : 'compactRoomContext';
    const input = target === 'seat' ? { workshopId: workshop.id, seatId: seat.id }
      : { workshopId: workshop.id, roomId: room.id, ...(target === 'room' ? { scope: 'both' } : {}) };
    await assert.rejects(router.invoke({ feature: 'cyclone', method, input },
      { ...context, signal: controller.signal }), /用户停止/);
    const fresh = createCycloneFeature({ dataDir, summarizer: { summarize: async () => '新摘要' } } as never);
    const savedSeat = await fresh.seats.require(workshop.id, seat.id);
    const savedRoom = await fresh.rooms.require(workshop.id, room.id);
    assert.deepEqual(savedSeat.messages, originalSeat.messages);
    assert.deepEqual(savedSeat.tokenUsage, originalSeat.tokenUsage);
    assert.deepEqual(savedRoom.publicMessages, originalRoom.publicMessages);
    assert.deepEqual(savedRoom.chairMessages, originalRoom.chairMessages);
    const progress = target === 'seat' ? savedSeat.compaction : target === 'chair' ? savedRoom.chairCompaction : savedRoom.compaction;
    assert.equal(progress?.type, 'compact-failed');
    assert.equal(progress?.aborted, true);
    // Failure releases the existing island lock; it does not wedge future compaction.
    await new CollaborationRouter([fresh.module]).invoke({ feature: 'cyclone', method, input }, context);
  });
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
