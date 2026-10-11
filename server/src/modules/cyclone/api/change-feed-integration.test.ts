import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { COLLABORATION_PERMISSIONS, type CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { createCycloneFeature } from './factory.js';

test('人类与 Agent 的结构和公告写入共用事实来源并发出轻量通知', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-change-shared-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ 'agent-a': { name: '甲' } }));
  const feature = createCycloneFeature({ dataDir });
  t.after(() => feature.dispose());
  const router = new CollaborationRouter([feature.module]);
  const human: CollaborationContext = { actor: { type: 'human', id: 'local-human', actingAs: 'human' },
    audience: 'human', enabledFeatures: new Set(['cyclone']),
    permissions: new Set(COLLABORATION_PERMISSIONS), requestId: 'human-1' };
  const gateway = new AgentCollaborationGateway(router,
    async () => ({ toolMode: 'selected', tools: ['framework_capability_cyclone'] }));
  const signals: Array<{ scope: string; id: string }> = [];
  feature.changes.subscribe(signal => signals.push(signal));
  const workshop = await router.invoke({ feature: 'cyclone', method: 'createWorkshop',
    input: { title: '联调工作室' } }, human) as { id: string };
  const seat = await gateway.invokeTool('add_collaboration_seat', {
    workshopId: workshop.id, agentId: 'agent-a', title: '实现',
  }, { agentId: 'agent-a' }) as { seatId: string };
  const room = await gateway.invokeTool('create_collaboration_room', {
    workshopId: workshop.id, title: '联调', topic: '前端刷新',
  }, { agentId: 'agent-a' }) as { roomId: string };
  await gateway.invokeTool('join_collaboration_room', { workshopId: workshop.id,
    roomId: room.roomId, seatId: seat.seatId }, { agentId: 'agent-a' });
  await gateway.invokeTool('leave_collaboration_room', { workshopId: workshop.id,
    roomId: room.roomId, seatId: seat.seatId }, { agentId: 'agent-a' });
  await gateway.invokeTool('post_collaboration_bulletin', {
    workshopId: workshop.id, text: 'Agent 公告',
  }, { agentId: 'agent-a' });
  await router.invoke({ feature: 'cyclone', method: 'mutateWorkshopBulletin',
    input: { workshopId: workshop.id, operations: [{ op: 'add', text: '人类公告' }] } }, human);
  assert.deepEqual(signals.map(signal => signal.scope), [
    'workshop', 'workshop', 'room', 'room', 'room', 'bulletin', 'bulletin',
  ]);
  assert.equal(signals[2]?.id, room.roomId);
  const summary = await feature.workshops.summary(workshop.id);
  assert.equal(summary.seats.length, 1);
  assert.equal(summary.rooms.length, 1);
  assert.equal(summary.bulletin.entries.length, 2);
  assert.deepEqual((await feature.rooms.require(workshop.id, room.roomId)).participantSeatIds, []);
  await assert.rejects(gateway.invokeTool('join_collaboration_room', {
    workshopId: workshop.id, roomId: room.roomId, seatId: 'missing',
  }, { agentId: 'agent-a' }));
  assert.equal(signals.length, 7);
});
