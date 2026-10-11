import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createWorkshop } from '../engine/cyclone/workshop-store.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { cycloneOrganizationRoutes } from './cyclone-organization.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { collaborationRoutes } from './collaboration.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-org-route-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  await app.register(cycloneOrganizationRoutes, { prefix: '/api/cyclone', feature, router });
  await app.register(collaborationRoutes, { prefix: '/api/collaboration', router });
  t.after(() => app.close());
  const workshop = await createWorkshop(dataDir, { title: '组织测试' });
  workshop.seatIds = ['seat-a', 'seat-b'];
  await fs.writeFile(
    path.join(dataDir, 'cyclone', workshop.id, 'meta.json'), JSON.stringify(workshop),
  );
  return { app, dataDir, workshop };
}

function saveCall(workshopId: string, body = organizationBody()) {
  return { method: 'POST' as const, url: '/api/collaboration/invoke', payload: {
    feature: 'cyclone', method: 'saveWorkshopOrganization',
    input: { workshopId, ...body },
  } };
}

function organizationBody(expectedRevision = 0) {
  return {
    expectedRevision,
    groups: [
      {
        id: 'group-a', title: '产品组', seatIds: ['seat-a'],
        position: { x: 20, y: 40 },
      },
      {
        id: 'group-b', title: '研发组', seatIds: ['seat-b'],
        position: { x: 420, y: 40 },
      },
    ],
    externalRelations: [
      {
        id: 'relation-a-b', sourceSeatId: 'seat-a', targetSeatId: 'seat-b',
        direction: 'forward',
      },
    ],
  };
}

test('组织读取保留资源接口且保存只经过中心', async (t) => {
  const { app, workshop } = await fixture(t);
  const url = `/api/cyclone/workshop/${workshop.id}/organization`;

  const legacy = await app.inject({ method: 'GET', url });
  assert.equal(legacy.statusCode, 200);
  assert.deepEqual(legacy.json(), { mode: 'legacy-full-mesh', organization: null });

  assert.equal((await app.inject({ method: 'PUT', url, payload: organizationBody() })).statusCode, 404);
  const saved = await app.inject(saveCall(workshop.id));
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().revision, 1);

  const explicit = await app.inject({ method: 'GET', url });
  assert.equal(explicit.statusCode, 200);
  assert.equal(explicit.json().mode, 'explicit');
  assert.equal(explicit.json().organization.revision, 1);
});

test('组织接口用统一错误契约报告版本冲突', async (t) => {
  const { app, workshop } = await fixture(t);
  const url = `/api/cyclone/workshop/${workshop.id}/organization`;
  assert.equal((await app.inject(saveCall(workshop.id))).statusCode, 200);

  const conflict = await app.inject(saveCall(workshop.id));

  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.json(), {
    error: '组织配置版本冲突：当前 revision=1，本次基于 revision=0',
    errorCode: 'CYCLONE_ORGANIZATION_REVISION_CONFLICT',
    errorKind: 'conflict',
  });
});

test('组织接口拒绝非数字 revision 且不写文件', async (t) => {
  const { app, workshop } = await fixture(t);
  const url = `/api/cyclone/workshop/${workshop.id}/organization`;
  const response = await app.inject(saveCall(
    workshop.id, organizationBody('0' as unknown as number),
  ));

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().errorCode, 'CYCLONE_ORGANIZATION_INVALID');
  assert.match(response.json().error, /expectedRevision/);
  assert.equal((await app.inject({ method: 'GET', url })).json().mode, 'legacy-full-mesh');
});

test('组织接口不把损坏文件伪装成自由协作', async (t) => {
  const { app, dataDir, workshop } = await fixture(t);
  const file = path.join(dataDir, 'cyclone', workshop.id, 'organization.json');
  await fs.writeFile(file, '{ broken json', 'utf8');

  const response = await app.inject({
    method: 'GET', url: `/api/cyclone/workshop/${workshop.id}/organization`,
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().errorCode, 'CYCLONE_ORGANIZATION_CORRUPT');
  assert.equal(response.json().errorKind, 'io');
  assert.equal(await fs.readFile(file, 'utf8'), '{ broken json');
});
