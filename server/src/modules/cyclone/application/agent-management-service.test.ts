import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { CycloneRoomService } from './room-service.js';
import { CycloneWorkshopService } from './workshop-service.js';
import { CycloneAgentManagementService } from './agent-management-service.js';

test('Agent 增加工位时严格确认全局 Agent 存在，注册表损坏会报真实错误', async t => {
  const { dataDir, workshops, management } = await setup(t);
  const workshop = await workshops.create({ title: '工程组' });
  await assert.rejects(management.addSeat({ workshopId: workshop.id,
    agentId: 'missing', title: '实现' }), hasCode('CYCLONE_AGENT_NOT_FOUND'));
  assert.deepEqual((await workshops.require(workshop.id)).seatIds, []);

  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, '{broken');
  await assert.rejects(management.addSeat({ workshopId: workshop.id,
    agentId: 'agent-a', title: '实现' }), hasCode('CYCLONE_AGENT_REGISTRY_INVALID'));
  await fs.writeFile(registry, JSON.stringify({ 'agent-a': { name: '甲' },
    'agent-b': { name: '乙' } }));
  await assert.rejects(management.addSeat({ workshopId: workshop.id,
    agentId: '__proto__', title: '伪工位' }), hasCode('CYCLONE_AGENT_NOT_FOUND'));
  await assert.rejects(management.addSeat({ workshopId: workshop.id,
    agentId: 'constructor', title: '伪工位' }), hasCode('CYCLONE_AGENT_NOT_FOUND'));
  const seat = await management.addSeat({ workshopId: workshop.id,
    agentId: 'agent-a', title: '实现' });
  assert.equal(seat.agentId, 'agent-a');
  assert.equal(seat.title, '实现');
  assert.equal((await workshops.require(workshop.id)).seatIds.length, 1);
});

test('Agent 建房不会静默丢弃不存在的工位；入会与离会保留历史', async t => {
  const { dataDir, workshops, management, rooms } = await setup(t);
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ 'agent-a': { name: '甲' },
    'agent-b': { name: '乙' } }));
  const workshop = await workshops.create({ title: '工程组' });
  const first = await management.addSeat({ workshopId: workshop.id,
    agentId: 'agent-a', title: '实现' });
  const second = await management.addSeat({ workshopId: workshop.id,
    agentId: 'agent-b', title: '验收' });
  await assert.rejects(management.createRoom({ workshopId: workshop.id,
    title: '讨论', topic: '发布', participantSeatIds: [first.seatId, 'missing'] }),
  hasCode('CYCLONE_ROOM_SEAT_NOT_FOUND'));
  assert.deepEqual((await workshops.require(workshop.id)).roomIds, []);

  let rolledBack = false;
  const partial = new CycloneAgentManagementService(dataDir, workshops, {
    create: async () => ({ id: 'room-partial', title: '讨论', topic: '发布',
      mode: 'build', participantSeatIds: [], updatedAt: 'now' }),
    remove: async () => { rolledBack = true; return { ok: true }; },
  } as never);
  await assert.rejects(partial.createRoom({ workshopId: workshop.id,
    title: '讨论', topic: '发布', participantSeatIds: [first.seatId] }),
  hasCode('CYCLONE_ROOM_CREATE_INCOMPLETE'));
  assert.equal(rolledBack, true);

  const room = await management.createRoom({ workshopId: workshop.id,
    title: '讨论', topic: '发布', participantSeatIds: [first.seatId, second.seatId] });
  assert.deepEqual(room.participantSeatIds, [first.seatId, second.seatId]);
  await management.leave(workshop.id, room.roomId, second.seatId);
  assert.deepEqual((await rooms.require(workshop.id, room.roomId)).participantSeatIds,
    [first.seatId]);
  await management.join(workshop.id, room.roomId, second.seatId);
  const rejoined = await rooms.require(workshop.id, room.roomId);
  assert.deepEqual(rejoined.participantSeatIds, [first.seatId, second.seatId]);
  assert.equal(rejoined.publicMessages.filter(message => message.kind === 'membership').length, 4);
});

async function setup(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-agent-manage-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshops = new CycloneWorkshopService(dataDir);
  const rooms = new CycloneRoomService(dataDir, { list: () => [] } as never,
    workshops, {} as never);
  return { dataDir, workshops, rooms,
    management: new CycloneAgentManagementService(dataDir, workshops, rooms) };
}

function hasCode(code: string) {
  return (error: unknown) => (error as { data?: { code?: string } }).data?.code === code;
}
