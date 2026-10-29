import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { listAuthorizedTargets, resolveAuthorizedTarget } from '../../../engine/cyclone/organization/organization-authorization.js';
import { workshopOrganizationFile } from '../../../engine/cyclone/paths.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { mutateSupervisor } from '../../../engine/cyclone/supervisor-store.js';
import { createSupervisorToolAdapter } from '../runtime/supervisor-tool-adapter.js';
import type { WorkshopOrganization } from '../../../engine/cyclone/organization/organization-types.js';
import { createCycloneFeature } from './factory.js';

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-agent-structure-'));
  await fs.mkdir(path.dirname(agentRegistryFile(dataDir)), { recursive: true });
  await fs.writeFile(agentRegistryFile(dataDir), JSON.stringify({ 'agent-a': { name: '甲' } }));
  const feature = createCycloneFeature({ dataDir });
  t.after(async () => {
    feature.dispose(); await feature.supervisor.shutdown();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const workshop = await feature.workshops.create({ title: '项目' });
  const seats = [];
  for (const title of ['需求', '开发', '核验']) seats.push(await feature.workshops.addSeat({
    workshopId: workshop.id, agentId: 'agent-a', title,
  }));
  const router = new CollaborationRouter([feature.module]);
  const gateway = new AgentCollaborationGateway(router,
    async () => ({ toolMode: 'selected', tools: ['framework_capability_cyclone'] }));
  const call = (tool: string, input: object = {}) => gateway.invokeTool(tool,
    { workshopId: workshop.id, ...input }, { agentId: 'agent-a' });
  const read = (input: object = {}) => call('read_collaboration_structure', input) as Promise<Page>;
  const update = (input: object) => call('update_collaboration_structure', input) as Promise<{ revision: number }>;
  const group = (id: string, ids: string[]) => ({ id, title: id, seatIds: ids, position: { x: 50, y: 80 } });
  return { dataDir, feature, workshop, seats, router, gateway, call, read, update, group };
}
interface Page {
  mode: string; revision: number; view: string; items: Array<Record<string, unknown>>;
  total: number; nextCursor?: string;
}

test('Agent 配置分组与单向关系，实际联络和派发授权与人类协作图一致', async t => {
  const { dataDir, feature, workshop, seats: [a, b, c], group, read, update } = await fixture(t);
  const initial = await read();
  assert.equal(initial.mode, 'legacy-full-mesh'); assert.equal(initial.revision, 0);
  assert.equal((await listAuthorizedTargets(dataDir, workshop.id, a.id, 'contact')).length, 2);
  const signals: string[] = [];
  const stop = feature.changes.subscribe(event => signals.push(event.scope)); t.after(stop);
  const groups = [group('交付', [a.id, b.id]), group('核验', [c.id])];
  const relation = { id: '开发到核验', sourceSeatId: b.id, targetSeatId: c.id, direction: 'forward' };
  await update({ expectedRevision: 0, groups, externalRelations: [relation] });
  assert.ok(signals.includes('workshop'));
  const saved = await feature.workshops.organization(workshop.id);
  assert.equal(saved.mode, 'explicit'); assert.equal(JSON.stringify(saved.organization?.groups), JSON.stringify(groups));
  for (const capability of ['contact', 'dispatch'] as const) {
    assert.equal((await resolveAuthorizedTarget(dataDir, workshop.id, a.id, b.id, capability)).id, b.id);
    assert.equal((await resolveAuthorizedTarget(dataDir, workshop.id, b.id, c.id, capability)).id, c.id);
    await assert.rejects(resolveAuthorizedTarget(dataDir, workshop.id, c.id, b.id, capability), /不在当前/);
    await assert.rejects(resolveAuthorizedTarget(dataDir, workshop.id, a.id, c.id, capability), /不在当前/);
  }
  await update({ expectedRevision: 1, groups, externalRelations: [{ ...relation, direction: 'both' }] });
  assert.equal((await resolveAuthorizedTarget(dataDir, workshop.id, c.id, b.id, 'contact')).id, b.id);
  await update({ expectedRevision: 2, groups: [], externalRelations: [] });
  assert.deepEqual(await listAuthorizedTargets(dataDir, workshop.id, a.id, 'contact'), []);
  assert.equal((await listAuthorizedTargets(dataDir, workshop.id, a.id, 'dispatch', { includeSelf: true }))[0].id, a.id);
});

test('新工位、协作组与群聊成员独立；移动成员需一并清理同组连线', async t => {
  const { dataDir, feature, workshop, seats: [a, b, c], group, call, update } = await fixture(t);
  const groups = [group('交付', [a.id, b.id])];
  const relations = [{ id: '交接', sourceSeatId: b.id, targetSeatId: c.id, direction: 'both' }];
  await update({ expectedRevision: 0, groups, externalRelations: relations });
  const room = await feature.rooms.create({ workshopId: workshop.id, title: '讨论', topic: '需求',
    participantSeatIds: [a.id, c.id] });
  await assert.rejects(resolveAuthorizedTarget(dataDir, workshop.id, a.id, c.id, 'contact'), /不在当前/);
  const d = await call('add_collaboration_seat', { agentId: 'agent-a', title: '运维' }) as { seatId: string };
  assert.deepEqual(await listAuthorizedTargets(dataDir, workshop.id, d.seatId, 'contact'), []);
  const moved = [group('交付', [a.id, b.id, c.id, d.seatId])];
  await assert.rejects(update({ expectedRevision: 1, groups: moved, externalRelations: relations }), /同组/);
  assert.equal((await feature.workshops.organization(workshop.id)).organization?.revision, 1);
  await update({ expectedRevision: 1, groups: moved, externalRelations: [] });
  assert.equal((await listAuthorizedTargets(dataDir, workshop.id, d.seatId, 'contact')).length, 3);
  assert.deepEqual((await feature.rooms.require(workshop.id, room.id)).participantSeatIds, [a.id, c.id]);
});

test('Agent 保存保留人类布局，过期与并发写入不会覆盖结构', async t => {
  const { feature, workshop, seats: [a, b], group, update } = await fixture(t);
  const groups = [{ ...group('交付', [a.id, b.id]), size: { width: 800, height: 400 } }];
  const seatPositions = { [a.id]: { x: 123, y: 456 } };
  await feature.workshops.saveOrganization(workshop.id, { expectedRevision: 0, groups,
    externalRelations: [], seatPositions });
  await update({ expectedRevision: 1, groups, externalRelations: [] });
  assert.deepEqual((await feature.workshops.organization(workshop.id)).organization?.seatPositions, seatPositions);
  await assert.rejects(update({ expectedRevision: 1, groups: [], externalRelations: [] }), /版本/);
  const result = await Promise.allSettled([update({ expectedRevision: 2, groups, externalRelations: [] }),
    feature.workshops.saveOrganization(workshop.id, { expectedRevision: 2, groups: [], externalRelations: [] })]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await feature.workshops.organization(workshop.id)).organization?.revision, 3);
});

test('结构分页完整且有界，游标绑定项目、视图、版本及工位名单', async t => {
  const { feature, workshop, group, read, update } = await fixture(t);
  const groups = Array.from({ length: 25 }, (_, i) => group(`组${i}${'\u0000'.repeat(1900)}`, []));
  // Keep IDs short while testing escaped long titles.
  groups.forEach((item, i) => { item.title = item.id; item.id = `group-${i}`; });
  await update({ expectedRevision: 0, groups, externalRelations: [] });
  const first = await read({ view: 'groups', limit: 12 });
  assert.ok(first.items.length < 12); assert.ok(JSON.stringify(first).length <= 24_000);
  const ids = first.items.map(item => item.id); let cursor = first.nextCursor;
  while (cursor) {
    const next = await read({ view: 'groups', cursor, limit: 12 });
    ids.push(...next.items.map(item => item.id)); cursor = next.nextCursor;
  }
  assert.equal(new Set(ids).size, 25);
  await assert.rejects(read({ view: 'relations', cursor: first.nextCursor }), /游标/);
  const other = await feature.workshops.create({ title: '其他项目' });
  await assert.rejects(read({ workshopId: other.id, view: 'groups', cursor: first.nextCursor }), /变化/);
  await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-a', title: '新增' });
  await assert.rejects(read({ view: 'groups', cursor: first.nextCursor }), /变化/);
  await update({ expectedRevision: 1, groups: [], externalRelations: [] });
  await assert.rejects(read({ view: 'groups', cursor: first.nextCursor }), /变化/);
  await assert.rejects(read({ view: 'relations', revision: 1 }), /变化/);
  assert.equal((await read({ view: 'relations', revision: 2 })).revision, 2);
});

test('无效结构、跨项目工位、关闭能力与损坏文件均明确拒绝且不覆盖数据', async t => {
  const { dataDir, feature, workshop, seats: [a, b], group, read, update, router } = await fixture(t);
  const other = await feature.workshops.create({ title: '其他项目' });
  const foreign = await feature.workshops.addSeat({ workshopId: other.id, agentId: 'agent-a' });
  const valid = { expectedRevision: 0, groups: [group('交付', [a.id])], externalRelations: [] };
  const relation = { id: '关系', sourceSeatId: a.id, targetSeatId: b.id, direction: 'forward' };
  const cases = [
    { ...valid, groups: [group('跨项目', [foreign.id])] },
    { ...valid, groups: [group('甲', [a.id]), group('乙', [a.id])] },
    { ...valid, externalRelations: [{ ...relation, targetSeatId: a.id }] },
    { ...valid, externalRelations: [relation, { ...relation, id: '重复', sourceSeatId: b.id, targetSeatId: a.id }] },
    { ...valid, externalRelations: [{ ...relation, direction: 'sideways' }] },
    { ...valid, groups: [{ ...group('甲', [a.id]), unknown: true }] },
    { ...valid, groups: [{ ...group('甲', [a.id]), position: { x: Infinity, y: 0 } }] },
    { ...valid, extra: true }, { ...valid, expectedRevision: -1 },
    { ...valid, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const input of cases) await assert.rejects(update(input));
  assert.equal((await read()).revision, 0);
  for (const input of [{ view: null }, { limit: null }, { revision: -1 }, { cursor: '' }]) {
    await assert.rejects(read(input));
  }
  const closed = new AgentCollaborationGateway(router, async () => ({ toolMode: 'selected', tools: [] }));
  for (const name of ['read_collaboration_structure', 'update_collaboration_structure']) {
    await assert.rejects(closed.invokeTool(name, { workshopId: workshop.id }, { agentId: 'agent-a' }),
      /未启用此框架能力/);
  }
  const file = workshopOrganizationFile(dataDir, workshop.id);
  await fs.writeFile(file, '{broken');
  await assert.rejects(read(), /损坏/); await assert.rejects(update(valid), /损坏/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('按指南从创建到配置图完整接通，删除工位后组和连线同步清理', async t => {
  const { feature, gateway, group } = await fixture(t);
  const identity = { agentId: 'agent-a' };
  const created = await gateway.invokeTool('create_collaboration_group', {
    title: '新项目', members: [{ agentId: 'agent-a', title: '设计' },
      { agentId: 'agent-a', title: '实现' }, { agentId: 'agent-a', title: '核验' }],
    room: { title: '讨论', topic: '交付' },
  }, identity) as { workshopId: string; seats: Array<{ seatId: string }>; room: { roomId: string } };
  const [a, b, c] = created.seats.map(item => item.seatId);
  const read = (input = {}) => gateway.invokeTool('read_collaboration_structure', {
    workshopId: created.workshopId, ...input,
  }, identity) as Promise<Page>;
  const initial = await read();
  assert.deepEqual(initial.items.map(item => item.seatId), [a, b, c]);
  await gateway.invokeTool('update_collaboration_structure', { workshopId: created.workshopId,
    expectedRevision: initial.revision, groups: [group('交付', [a, b])],
    externalRelations: [{ id: '核验交接', sourceSeatId: b, targetSeatId: c, direction: 'both' }],
  }, identity);
  assert.equal((await read()).mode, 'explicit');
  await feature.seats.remove(created.workshopId, b);
  const state = await feature.workshops.organization(created.workshopId);
  assert.deepEqual(state.organization?.groups[0].seatIds, [a]);
  assert.deepEqual(state.organization?.externalRelations, []);
  assert.deepEqual((await feature.rooms.require(created.workshopId, created.room.roomId)).participantSeatIds, [a, c]);
  assert.equal((await read()).total, 2);
});

test('主管复用同一套结构工具，身份自动绑定且不存在重复定义', async t => {
  const { dataDir, feature, workshop, seats: [a, b], group, router } = await fixture(t);
  await mutateSupervisor(dataDir, workshop.id, value => { value.agentId = 'agent-a'; });
  const adapter = createSupervisorToolAdapter(dataDir, feature.module, async () => ({ ok: true, result: '' }));
  adapter.connect(router);
  const names = adapter.port.definitions.map(item => item.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of ['read_collaboration_structure', 'update_collaboration_structure']) {
    const tool = adapter.port.definitions.find(item => item.name === name)!;
    assert.ok(tool); assert.equal('workshopId' in tool.parameters!.properties!, false);
  }
  const saved = await adapter.port.call(workshop.id, 'update_collaboration_structure', {
    expectedRevision: 0, groups: [group('交付', [a.id, b.id])], externalRelations: [],
  });
  assert.equal(saved.ok, true);
  const read = await adapter.port.call(workshop.id, 'read_collaboration_structure', { view: 'groups' });
  assert.equal(read.ok, true); assert.equal(JSON.parse(read.result).items[0].id, '交付');
  const state = await feature.workshops.organization(workshop.id);
  assert.equal((state.organization as WorkshopOrganization).revision, 1);
  assert.equal((await adapter.port.call(workshop.id, 'read_collaboration_structure', {
    workshopId: 'other', view: 'groups',
  })).ok, false);
});
