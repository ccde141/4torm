import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { createCycloneFeature } from './factory.js';

test('Agent 经中心入口完成气旋建工位、建房、公告与派发查询，维护操作不暴露', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-agent-gateway-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ 'agent-a': { name: '甲' },
    'agent-b': { name: '乙' } }));
  const feature = createCycloneFeature({ dataDir });
  const workshop = await feature.workshops.create({ title: '工程组' });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([feature.module]),
    async () => ({ toolMode: 'selected', tools: ['framework_capability_cyclone'] }));
  const identity = { agentId: 'agent-a' };
  const names = (await gateway.tools(identity)).map(tool => tool.name);
  assert.ok(names.includes('add_collaboration_seat'));
  assert.ok(names.includes('post_collaboration_bulletin'));
  assert.ok(names.includes('list_collaboration_dispatches'));
  assert.ok(!names.some(name => /delete|reset|compact|dismiss|reorder/.test(name)));

  const seat = await gateway.invokeTool('add_collaboration_seat', {
    workshopId: workshop.id, agentId: 'agent-b', title: '验收',
  }, identity) as { seatId: string };
  const room = await gateway.invokeTool('create_collaboration_room', {
    workshopId: workshop.id, title: '质量评审', topic: '发布前检查',
    participantSeatIds: [seat.seatId],
  }, identity) as { roomId: string; participantSeatIds: string[] };
  assert.deepEqual(room.participantSeatIds, [seat.seatId]);
  await gateway.invokeTool('post_collaboration_bulletin', {
    workshopId: workshop.id, text: '先完成发布前检查',
  }, identity);
  const board = await gateway.invokeTool('read_collaboration_bulletin', {
    workshopId: workshop.id,
  }, identity) as { items: Array<{ author: string }> };
  assert.equal(board.items[0]?.author, 'Agent:agent-a');
  const dispatches = await gateway.invokeTool('list_collaboration_dispatches', {
    workshopId: workshop.id,
  }, identity) as { items: unknown[] };
  assert.deepEqual(dispatches.items, []);
});
