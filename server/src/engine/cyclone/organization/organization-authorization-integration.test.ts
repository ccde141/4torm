import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execContact } from '../contact.js';
import { listOtherSeats, listWorkshopSeats } from '../contact-registry.js';
import { createRoomDispatchRecord } from '../room-dispatch.js';
import { createSeatDispatchRecord } from '../seat-dispatch.js';
import { addSeat, loadSeat } from '../seat-store.js';
import { createWorkshop } from '../workshop-store.js';
import { saveWorkshopOrganization } from './organization-store.js';

test('名册与三个执行入口共同阻止未授权跨组协作', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-auth-integration-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '授权集成测试' });
  const source = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '产品' });
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '开发' });
  await saveWorkshopOrganization(dataDir, workshop.id, {
    expectedRevision: 0,
    groups: [
      {
        id: 'product', title: '产品组', seatIds: [source.id],
        position: { x: 0, y: 0 },
      },
      {
        id: 'engineering', title: '研发组', seatIds: [target.id],
        position: { x: 400, y: 0 },
      },
    ],
    externalRelations: [],
  });

  assert.deepEqual(await listOtherSeats(dataDir, workshop.id, source.id), []);
  assert.deepEqual(
    (await listWorkshopSeats(dataDir, workshop.id, source.id)).map(item => item.title),
    [source.title],
  );
  await assert.rejects(
    createSeatDispatchRecord(dataDir, {
      workshopId: workshop.id, sourceSeatId: source.id, sourceSeatTitle: source.title,
      sourceTurnId: 'turn-a', dispatchOrder: 0, targetSeatTitle: target.title, task: '越权任务',
    }),
    /不在当前派发范围内/,
  );
  await assert.rejects(
    createRoomDispatchRecord(dataDir, {
      workshopId: workshop.id, roomId: 'room-a', sourceSeatId: source.id,
      sourceSeatTitle: source.title, sourceTurnId: 'turn-a', sourceRoundSeq: 1,
      contextVersion: 0, dispatchOrder: 0, targetSeatTitle: target.title, task: '越权任务',
    }),
    /不在当前派发范围内/,
  );
  const selfDispatch = await createRoomDispatchRecord(dataDir, {
    workshopId: workshop.id, roomId: 'room-a', sourceSeatId: source.id,
    sourceSeatTitle: source.title, sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    contextVersion: 0, dispatchOrder: 1, targetSeatTitle: source.title, task: '带回自己的工位',
  });
  assert.equal(selfDispatch.targetSeatId, source.id);

  const contactResult = await execContact({
    dataDir, workshopId: workshop.id, fromSeatId: source.id,
    fromTitle: source.title, depth: 0,
  }, target.title, '越权联络');
  assert.match(contactResult, /^联络失败：.*不在当前联络范围内/);
  assert.deepEqual((await loadSeat(dataDir, workshop.id, target.id))?.messages, []);
});
