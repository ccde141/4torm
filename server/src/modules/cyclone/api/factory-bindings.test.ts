import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { createCycloneFeature } from './factory.js';
import { tryAcquireRoomLock } from '../../../engine/cyclone/room-store.js';
import { tryAcquireSeatLock } from '../../../engine/cyclone/seat-store.js';

const actor = { type: 'human' as const, id: 'human', actingAs: 'human' as const };
const human: CollaborationContext = { actor, audience: 'human',
  enabledFeatures: new Set(['cyclone']), permissions: new Set(['observe']), requestId: 'req-human' };
const agent: CollaborationContext = { actor: { type: 'agent', id: 'agent-a', actingAs: 'human' },
  audience: 'agent', enabledFeatures: new Set(['cyclone']),
  permissions: new Set(['observe', 'execute']), requestId: 'req-agent' };

test('factory binds Agent reads and private chat starts without exposing live activity to Agent', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-bindings-'));
  try {
    const router = new CollaborationRouter([createCycloneFeature({ dataDir }).module]);
    const tools = router.listAgentTools().map(item => item.definition.name);
    assert.ok(tools.includes('list_collaboration_workshops'));
    assert.ok(tools.includes('start_collaboration_seat_chat'));
    assert.ok(tools.includes('start_collaboration_chair_chat'));
    const agentMethods = router.listManifests(agent)[0].methods.map(item => item.id);
    const humanMethods = router.listManifests(human)[0].methods.map(item => item.id);
    assert.equal(agentMethods.includes('readPrivateChatActivity'), false);
    assert.equal(humanMethods.includes('readPrivateChatActivity'), true);
    await assert.rejects(router.invoke({ feature: 'cyclone', method: 'readPrivateChatActivity',
      input: { workshopId: 'w', targetKind: 'seat', targetId: 's', since: 0 } }, agent));
    assert.equal(await router.invoke({ feature: 'cyclone', method: 'readPrivateChatActivity',
      input: { workshopId: 'w', targetKind: 'seat', targetId: 's', since: 0 } }, human), null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('中心工位记忆读写保留版本冲突与受众边界', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-memory-bindings-'));
  const feature = createCycloneFeature({ dataDir });
  t.after(async () => { feature.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const router = new CollaborationRouter([feature.module]);
  const context = { ...human, permissions: new Set(['observe', 'design'] as const) };
  const workshop = await feature.workshops.create({});
  const seat = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-a', title: '岗位' });
  const identity = { workshopId: workshop.id, seatId: seat.id };
  const invoke = (method: string, extra = {}) => router.invoke({ feature: 'cyclone', method,
    input: { ...identity, ...extra } }, context);
  assert.deepEqual(await invoke('readSeatMemory'), { revision: 0, entries: [] });
  const input = { expectedRevision: 0, entry: { title: '资料', content: '本项目记录' } };
  await invoke('saveSeatMemory', input);
  await assert.rejects(invoke('saveSeatMemory', input), error => (error as { data: { kind: string } }).data.kind === 'conflict');
  const board = await invoke('readSeatMemory') as { revision: number; entries: Array<{ content: string }> };
  assert.equal(board.revision, 1);
  assert.equal(board.entries[0].content, '本项目记录');
  await assert.rejects(router.invoke({ feature: 'cyclone', method: 'readSeatMemory', input: identity }, agent));
  await assert.rejects(invoke('saveSeatMemory', { ...input, unexpected: '跨域' }));
});

test('角色与协作策略共用工位和相关会议冲突门，拒绝后与写入失败后全部释放锁', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-config-bindings-'));
  const feature = createCycloneFeature({ dataDir });
  t.after(async () => { feature.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const router = new CollaborationRouter([feature.module]);
  const context = { ...human, permissions: new Set(['observe', 'design'] as const) };
  const workshop = await feature.workshops.create({});
  const seat = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-a', title: '岗位' });
  await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-b', title: '重复名' });
  const roomA = await feature.rooms.create({ workshopId: workshop.id, participantSeatIds: [seat.id] });
  const roomB = await feature.rooms.create({ workshopId: workshop.id, participantSeatIds: [seat.id] });
  const invoke = (method: string, patch: Record<string, unknown>) => router.invoke({ feature: 'cyclone', method,
    input: { workshopId: workshop.id, seatId: seat.id, ...patch } }, context);
  const policy = { contact: false, dispatch: false, bulletin: true };
  const releaseRoom = tryAcquireRoomLock(workshop.id, roomB.id)!;
  for (const [method, patch] of [['updateSeatRole', { rolePrompt: '新角色' }],
    ['updateSeatCollaboration', policy]] as const) {
    await assert.rejects(invoke(method, patch), error => (error as { data: { code: string } }).data.code === 'CYCLONE_SEAT_BUSY');
    const seatRelease = tryAcquireSeatLock(workshop.id, seat.id);
    const roomRelease = tryAcquireRoomLock(workshop.id, roomA.id);
    assert.ok(seatRelease); assert.ok(roomRelease);
    seatRelease(); roomRelease();
  }
  releaseRoom();
  await assert.rejects(invoke('updateSeatRole', { title: '重复名' }));
  const roomRelease = tryAcquireRoomLock(workshop.id, roomB.id);
  assert.ok(roomRelease); roomRelease();
  await invoke('updateSeatRole', { rolePrompt: '新角色' });
  const firstPolicy = await invoke('updateSeatCollaboration', policy) as typeof policy;
  assert.deepEqual(firstPolicy, policy);
  assert.deepEqual(Object.keys(firstPolicy).sort(), ['bulletin', 'contact', 'dispatch']);
  const nextPolicy = { ...firstPolicy, contact: true };
  assert.deepEqual(await invoke('updateSeatCollaboration', nextPolicy), nextPolicy);
  assert.deepEqual((await feature.seats.require(workshop.id, seat.id)).collaboration, nextPolicy);
  assert.equal((await feature.seats.require(workshop.id, seat.id)).rolePrompt, '新角色');
});
