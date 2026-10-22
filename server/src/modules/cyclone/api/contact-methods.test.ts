import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { createWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { createContactCommunication, mutateContactCommunication } from '../../../engine/cyclone/contact-communication-store.js';
import { registerCycloneContactRoutes } from '../../../routes/cyclone-contact-routes.js';
import { installHumanIdentityPort } from '../../../routes/collaboration-context.js';
import { createCycloneFeature } from './factory.js';
import { cycloneContactHandlers, cycloneContactManifests } from './contact-methods.js';

const human: CollaborationContext = { actor: { type: 'human', id: 'human', actingAs: 'human' },
  audience: 'human', enabledFeatures: new Set(['cyclone']), permissions: new Set(['observe']), requestId: 'contact-test' };

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-contact-api-'));
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([{ manifest: { id: 'cyclone', version: 1, title: '气旋',
    methods: cycloneContactManifests() }, handlers: cycloneContactHandlers(dataDir) }]);
  const workshop = await createWorkshop(dataDir);
  const other = await createWorkshop(dataDir);
  const ticket = await createContactCommunication(dataDir, { workshopId: workshop.id,
    sourceId: 'seat-source', sourceKind: 'seat', sourceTitle: '来源工位',
    targetId: 'seat-a', targetKind: 'seat', targetTitle: '资料核验', admissionDeadlineAt: new Date().toISOString() });
  t.after(async () => { feature.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const read = (input: unknown, context = human) => router.invoke({ feature: 'cyclone', method: 'readContactCommunication', input }, context);
  return { dataDir, feature, router, workshop, other, ticket, read };
}

test('人类联络查询沿中心门控并按实际工作室隔离，转义长回复可完整续读', async t => {
  const { dataDir, workshop, other, ticket, read } = await fixture(t);
  const input = { workshopId: workshop.id, contactId: ticket.id };
  for (const invalid of [{ ...input, sourceId: 'supervisor' }, { ...input, dataDir },
    { ...input, offset: -1 }, { ...input, offset: '0' }, { ...input, workshopId: '../escape' }]) {
    await assert.rejects(read(invalid));
  }
  await assert.rejects(read(input, { ...human, audience: 'agent' }));
  await assert.rejects(read(input, { ...human, permissions: new Set() }));
  await assert.rejects(read({ ...input, workshopId: other.id }), /当前工作室中不存在/);
  await assert.rejects(read({ ...input, workshopId: 'missing' }), /工作室不存在/);
  const reply = '\u0000'.repeat(7000);
  await mutateContactCommunication(dataDir, workshop.id, ticket.id, current => ({ ...current,
    status: 'completed', delivered: true, acceptedAt: new Date().toISOString(), response: reply }));
  let offset = 0; let result = '';
  do {
    const page = await read({ ...input, offset }) as { reply: string; status: string; delivered: boolean; nextOffset?: number };
    assert.equal(page.status, 'completed'); assert.equal(page.delivered, true);
    assert.ok(JSON.stringify(page).length <= 18_000); assert.equal('dataDir' in page, false);
    result += page.reply;
    if (page.nextOffset === undefined) break;
    assert.ok(page.nextOffset > offset); offset = page.nextOffset;
  } while (true);
  assert.equal(result, reply);
});

test('人类HTTP联络查询复用中心调用，能从running刷新终态且不能覆盖身份', async t => {
  const { dataDir, feature, router, workshop, ticket } = await fixture(t);
  const app = Fastify();
  installHumanIdentityPort(app, { resolve: () => ({ id: 'viewer', enabledFeatures: ['cyclone'], permissions: ['observe'] }) });
  await app.register(async child => registerCycloneContactRoutes(child, { router, feature }), { prefix: '/api/cyclone' });
  t.after(() => app.close());
  const url = `/api/cyclone/workshop/${workshop.id}/contact/${ticket.id}`;
  await mutateContactCommunication(dataDir, workshop.id, ticket.id, current => ({ ...current,
    status: 'running', delivered: true, acceptedAt: new Date().toISOString() }));
  assert.equal((await app.inject(url)).json().status, 'running');
  await mutateContactCommunication(dataDir, workshop.id, ticket.id, current => ({ ...current,
    status: 'failed', error: '实际模型失败' }));
  const response = await app.inject(url);
  assert.equal(response.statusCode, 200); assert.equal(response.json().status, 'failed');
  assert.equal(response.json().delivered, true); assert.equal(response.json().error, '实际模型失败');
  assert.notEqual((await app.inject(`${url}?sourceId=supervisor`)).statusCode, 200);
  assert.notEqual((await app.inject(`${url}?offset=-1`)).statusCode, 200);
});
