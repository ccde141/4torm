import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCycloneFeature } from '../api/factory.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { loadSeat } from '../../../engine/cyclone/seat-store.js';
import { loadRoom } from '../../../engine/cyclone/room-store.js';
import { loadSupervisor } from '../../../engine/cyclone/supervisor-store.js';
import { buildSeatRequestContext } from '../../../engine/cyclone/current-input.js';
import { buildSupervisorRequestContext } from '../../../engine/cyclone/supervisor-runner.js';
import { buildChairPrompt } from '../../../engine/cyclone/seat-prompt.js';
import { buildCycloneCompactionContext } from './compaction-context.js';

test('Cyclone manual targets reuse their seat, chair and supervisor request identities', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-ordered-context-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents', 'worker', '.workspace'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({ worker: {
    name: 'Worker', model: 'p:model', config: { toolMode: 'selected', tools: [], skills: [] },
  } }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://context-no-request.test/v1', models: ['model'], nativeMode: 'native',
  }] }));
  t.mock.method(globalThis, 'fetch', async () => assert.fail('request assembly does not call a model'));
  const feature = createCycloneFeature({ dataDir });
  const workshop = await feature.workshops.create({ title: 'Project', chairAgentId: 'worker' });
  const seat = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'worker', title: 'Evidence' });
  const room = await feature.rooms.create({ workshopId: workshop.id, title: 'Review' });
  await feature.supervisor.configure(workshop.id, { agentId: 'worker', rolePrompt: 'Track project delivery.' });
  const agent = (await loadAgent(dataDir, 'worker'))!;
  const savedSeat = (await loadSeat(dataDir, workshop.id, seat.id))!;
  const expectedSeat = await buildSeatRequestContext(dataDir, workshop.id, savedSeat, agent);
  const actualSeat = await buildCycloneCompactionContext(dataDir, agent, { workshopId: workshop.id, kind: 'seat', id: seat.id });
  assert.deepEqual(actualSeat.messages, expectedSeat.messages.slice(0, 1));
  assert.deepEqual(actualSeat.tools, expectedSeat.tools);
  assert.equal(actualSeat.historyToolTransport, 'native');
  const savedRoom = (await loadRoom(dataDir, workshop.id, room.id))!;
  const expectedChair = await buildChairPrompt(dataDir, workshop.id, savedRoom, workshop, agent);
  for (const kind of ['room', 'chair'] as const) {
    const actual = await buildCycloneCompactionContext(dataDir, agent, { workshopId: workshop.id, kind, id: room.id });
    assert.deepEqual(actual.messages, [expectedChair.systemMessage]);
    assert.equal(actual.tools, undefined, 'public compaction does not borrow participant tools');
  }
  const supervisor = await loadSupervisor(dataDir, workshop.id);
  const expectedSupervisor = await buildSupervisorRequestContext(dataDir, workshop.id, supervisor, agent, true, '');
  const actualSupervisor = await buildCycloneCompactionContext(dataDir, agent, { workshopId: workshop.id, kind: 'supervisor' });
  assert.deepEqual(actualSupervisor.messages, expectedSupervisor.messages.slice(0, 1));
  assert.deepEqual(actualSupervisor.tools, expectedSupervisor.tools);
});
