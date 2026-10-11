import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { cycloneRoutes } from './cyclone.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { COLLABORATION_FEATURES, COLLABORATION_PERMISSIONS } from '../engine/collaboration/contracts.js';

async function setup(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-control-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  await app.register(cycloneRoutes, { feature, router });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { app, router, feature };
}

test('气旋执行只能经中心门控中止并拒绝旧执行身份', async t => {
  const { app, router, feature } = await setup(t);
  const context = {
    actor: { type: 'human' as const, id: 'local-human', actingAs: 'human' as const },
    audience: 'human' as const, enabledFeatures: new Set(COLLABORATION_FEATURES),
    permissions: new Set(COLLABORATION_PERMISSIONS), requestId: 'cyclone-control',
  };
  const workshop = await feature.workshops.create({ title: '测试工作室' });
  const seat = await feature.workshops.addSeat({
    workshopId: workshop.id, agentId: 'agent-control', title: '测试工位',
  });
  const room = await feature.rooms.create({
    workshopId: workshop.id, title: '测试房间', participantSeatIds: [seat.id],
  });
  const prepared = await feature.roomRounds.prepare({
    workshopId: workshop.id, roomId: room.id, message: '开始',
  });
  const current = prepared.execution;
  await assert.rejects(() => router.invoke({
    feature: 'cyclone', method: 'abortExecution', input: {
      operationId: current.operationId, runId: 'cyclone-run-stale',
    },
  }, context), (error: any) => error?.data?.code === 'CYCLONE_EXECUTION_CHANGED');

  const stopped = await router.invoke({
    feature: 'cyclone', method: 'abortExecution', input: {
      operationId: current.operationId, runId: current.runId,
    },
  }, context);
  assert.deepEqual(stopped, {
    stopped: true, operationId: current.operationId, runId: current.runId,
  });

  const removedEndpoint = await app.inject({
    method: 'POST', url: '/workshop/workshop-1/seat/seat-1/abort', payload: current,
  });
  assert.equal(removedEndpoint.statusCode, 400);

  await prepared.run();
  assert.equal((await router.inspectOperation('cyclone', current, context)).status, 'aborted');
});

test('气旋执行在前置检查失败时保存 failed 而非伪装完成', async t => {
  const { app, feature } = await setup(t);
  const response = await app.inject({
    method: 'POST', url: '/workshop/missing-workshop/seat/missing-seat/compact',
  });
  assert.equal(response.statusCode, 404);
  const run = await feature.runs.latest('seat:missing-workshop:missing-seat');
  assert.equal(run?.status, 'failed');
  assert.equal(run?.error, '工位不存在');
  assert.deepEqual(feature.executions.list(), []);
});
