import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch, updateDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { createWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { createCycloneRuntimeSource } from './operation-adapter.js';

test('派发实体不伪装成可精确查询的执行轮次', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-probe-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '工作室' });
  const dispatch = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '架构', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '实现', task: '检查接口',
  });
  const source = createCycloneRuntimeSource(dataDir, {
    list: () => [], signal: () => new AbortController().signal,
  });
  const active = (await source.snapshots()).find(item => item.operationId === `dispatch:${dispatch.id}`);
  assert.equal(active?.status, 'queued');
  assert.equal(active?.runId, undefined);
  await updateDispatch(dataDir, workshop.id, dispatch.id, { status: 'completed' });
  const settled = (await source.snapshots()).find(item => item.operationId === `dispatch:${dispatch.id}`);
  assert.equal(settled?.status, 'completed');
  assert.equal(settled?.runId, undefined);
});
