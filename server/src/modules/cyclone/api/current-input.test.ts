import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { observeModelRequests, type ModelRequestUsageEvent } from '../../../engine/shared/model-request-usage.js';
import { createWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { addSeat } from '../../../engine/cyclone/seat-store.js';
import { createCycloneFeature } from './factory.js';

test('status read returns a transient estimate without persistence, execution or billing', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-input-read-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { name: 'Worker', model: 'removed:worker', config: { tools: [], toolMode: 'selected' } },
  }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Read estimates must not use the network'); });
  const workshop = await createWorkshop(dataDir, { title: 'Input workshop' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'worker', title: 'Research' });
  const feature = createCycloneFeature({ dataDir });
  t.after(() => feature.dispose());
  const before = await feature.seats.require(workshop.id, seat.id);
  const events: ModelRequestUsageEvent[] = [];
  const read = feature.module.handlers!.readSeat;
  const projected = await observeModelRequests(event => events.push(event), () => read.invoke(
    {} as Parameters<typeof read.invoke>[0], { workshopId: workshop.id, targetId: seat.id })) as
    typeof before & { currentInput: { tokens: number } };
  assert.ok(projected.currentInput.tokens > 0);
  assert.deepEqual(await feature.seats.require(workshop.id, seat.id), before);
  assert.deepEqual(feature.executions.list(), []);
  assert.deepEqual(events, []);
});
