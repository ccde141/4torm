import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { loadSeat, saveSeat, tryAcquireSeatLock } from '../../../engine/cyclone/seat-store.js';
import { listWorkshopContactCommunications } from '../../../engine/cyclone/contact-communication-store.js';
import { mutateSupervisor } from '../../../engine/cyclone/supervisor-store.js';
import { workshopBakDir } from '../../../engine/cyclone/paths.js';
import { createCycloneFeature } from '../api/factory.js';
import { createSupervisorToolAdapter } from './supervisor-tool-adapter.js';
import { readSeatHistory } from '../../../engine/cyclone/seat-history.js';

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-supervisor-tools-'));
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ 'agent-a': { name: '统筹' }, 'agent-b': { name: '核验' } }));
  const feature = createCycloneFeature({ dataDir, summarizer: { summarize: async () => '保留的项目摘要' } });
  t.after(async () => {
    feature.dispose(); await feature.supervisor.shutdown();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const workshop = await feature.workshops.create({ title: '当前项目' });
  const other = await feature.workshops.create({ title: '其他项目' });
  const seat = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-a', title: '整理' });
  const otherSeat = await feature.workshops.addSeat({ workshopId: other.id, agentId: 'agent-b', title: '其他工位' });
  await mutateSupervisor(dataDir, workshop.id, current => { current.agentId = 'agent-a'; });
  const adapter = createSupervisorToolAdapter(dataDir, feature.module, async () => ({ result: '已送达', ok: true }));
  adapter.connect(new CollaborationRouter([feature.module]));
  return { dataDir, feature, workshop, seat, other, otherSeat, port: adapter.port };
}

test('主管作用域工具从 manifest 派生并拒绝跨工作室和未知工具', async t => {
  const { dataDir, workshop, seat, other, otherSeat, port } = await fixture(t);
  const names = port.definitions.map(tool => tool.name);
  assert.ok(names.includes('list_collaboration_agents'));
  assert.ok(names.includes('read_collaboration_console'));
  assert.ok(names.includes('retire_collaboration_seat'));
  assert.ok(names.includes('dispatch') && names.includes('contact_read'));
  assert.ok(!names.includes('list_collaboration_workshops') && !names.includes('create_collaboration_group'));
  assert.ok(port.definitions.every(tool => !Object.hasOwn(tool.parameters?.properties ?? {}, 'workshopId')));
  assert.equal((await port.call(workshop.id, 'update_collaboration_seat', {
    workshopId: other.id, seatId: otherSeat.id, duty: '不可注入',
  })).ok, false);
  assert.equal((await port.call(workshop.id, 'update_collaboration_seat', {
    seatId: otherSeat.id, duty: '不可跨项目',
  })).ok, false);
  assert.equal((await port.call(workshop.id, 'deleteWorkshop', {})).ok, false);
  assert.equal((await loadSeat(dataDir, other.id, otherSeat.id))?.duty, undefined);
  assert.equal((await loadSeat(dataDir, workshop.id, seat.id))?.duty, undefined);
});

test('主管管理使用原保存和变更通知，实际主体绑定所选 Agent', async t => {
  const { dataDir, feature, workshop, seat, port } = await fixture(t);
  const changes: string[] = [];
  const stop = feature.changes.subscribe(signal => changes.push(signal.scope));
  t.after(stop);
  const update = await port.call(workshop.id, 'update_collaboration_seat', {
    seatId: seat.id, agentId: 'agent-b', duty: '独立核验', overrideAgentRole: 'true',
  });
  assert.equal(update.ok, true, update.result);
  const saved = await loadSeat(dataDir, workshop.id, seat.id);
  assert.equal(saved?.agentId, 'agent-b'); assert.equal(saved?.duty, '独立核验');
  assert.equal(saved?.overrideAgentRole, true);
  const post = await port.call(workshop.id, 'post_collaboration_bulletin', { text: '已安排核验' });
  assert.equal(post.ok, true, post.result);
  const board = await port.call(workshop.id, 'read_collaboration_bulletin', {});
  assert.match(board.result, /工作室主管/);
  const posted = JSON.parse(post.result) as { entry: { id: string } };
  const modified = await port.call(workshop.id, 'update_collaboration_bulletin', { operations: JSON.stringify([
    { op: 'update', id: posted.entry.id, text: '主管更新', author: '人类' },
  ]) });
  assert.equal(modified.ok, true, modified.result);
  const bulletin = await feature.workshops.bulletin(workshop.id);
  assert.equal(bulletin.entries[0].author, '工作室主管');
  assert.ok((await feature.workshops.bulletinHistory(workshop.id)).every(item => item.actor === '工作室主管'));
  assert.ok(changes.includes('workshop') && changes.includes('bulletin'));
  const policy = await port.call(workshop.id, 'set_collaboration_permissions', {
    seatId: seat.id, contact: 'true', dispatch: 'false', bulletin: 'true',
  });
  assert.equal(policy.ok, true, policy.result);
  assert.deepEqual((await loadSeat(dataDir, workshop.id, seat.id))?.collaboration,
    { contact: true, dispatch: false, bulletin: true });
  const history = await readSeatHistory(dataDir, workshop.id, seat.id);
  assert.equal(history.length, 2);
  assert.ok(history.every(item => item.source === 'supervisor'));
  assert.ok(history.some(item => item.kind === 'binding' && item.previousAgentId === 'agent-a' && item.agentId === 'agent-b'));
  assert.ok(history.some(item => item.changedFields?.includes('collaboration')));
});

test('可信上下文区分人类、普通Agent和主管来源，输入字段不能伪造审计主体', async t => {
  const { dataDir, feature, workshop, seat } = await fixture(t);
  const router = new CollaborationRouter([feature.module]);
  const human: CollaborationContext = { actor: { type: 'human', id: 'viewer', actingAs: 'human' },
    audience: 'human', enabledFeatures: new Set(['cyclone']), permissions: new Set(['observe', 'design']),
    requestId: 'supervisor:human-prefix-is-not-a-role' };
  const invoke = (method: string, input: unknown, context = human) => router.invoke({ feature: 'cyclone', method, input }, context);
  const identity = { workshopId: workshop.id, seatId: seat.id };
  await invoke('updateSeatRole', { ...identity, duty: '人类调整' });
  await invoke('updateSeatCollaboration', { ...identity, contact: false, dispatch: true, bulletin: true });
  assert.ok((await readSeatHistory(dataDir, workshop.id, seat.id)).every(item => item.source === 'human'));
  await assert.rejects(invoke('updateSeatRole', { ...identity, duty: '不得写入', source: 'supervisor' }));
  const posted = await invoke('mutateWorkshopBulletin', { workshopId: workshop.id,
    operations: [{ op: 'add', text: '人类公告', author: '项目编辑' }] }) as { entries: Array<{ author: string }> };
  assert.equal(posted.entries[0].author, '项目编辑');
  assert.equal((await feature.workshops.bulletinHistory(workshop.id))[0].actor, '人类');
  const ordinary: CollaborationContext = { ...human, actor: { type: 'agent', id: 'agent-b', actingAs: 'human' },
    audience: 'agent', requestId: 'supervisor:prefix-cannot-override-audience' };
  const agentPost = await invoke('postCollaborationBulletin', { workshopId: workshop.id, text: '普通Agent公告' }, ordinary) as { entry: { author: string } };
  assert.equal(agentPost.entry.author, 'Agent:agent-b');
  await invoke('updateSeatRole', { ...identity, duty: '普通内部调用' }, {
    ...ordinary, audience: 'internal', requestId: 'internal:ordinary-agent',
  });
  assert.ok((await readSeatHistory(dataDir, workshop.id, seat.id)).some(item => item.source === 'unknown'));
});

test('主管压缩和移除工位复用原接口，历史归档可恢复', async t => {
  const { dataDir, feature, workshop, seat, port } = await fixture(t);
  seat.messages.push({ role: 'user', content: '原始需求保留' }, { role: 'assistant', content: '已收到' });
  await saveSeat(dataDir, workshop.id, seat);
  const compact = await port.call(workshop.id, 'compact_collaboration_seat', { seatId: seat.id });
  assert.equal(compact.ok, true, compact.result);
  assert.match((await loadSeat(dataDir, workshop.id, seat.id))?.messages[0].content ?? '', /保留的项目摘要/);
  const retired = await port.call(workshop.id, 'retire_collaboration_seat', { seatId: seat.id });
  assert.equal(retired.ok, true, retired.result);
  assert.equal(await loadSeat(dataDir, workshop.id, seat.id), null);
  assert.ok(!(await feature.workshops.require(workshop.id)).seatIds.includes(seat.id));
  const archived = JSON.parse(await fs.readFile(path.join(workshopBakDir(dataDir, workshop.id),
    'retired-seats', seat.id, `${seat.id}.json`), 'utf8'));
  assert.match(archived.messages[0].content, /保留的项目摘要/);
  const backups = await fs.readdir(workshopBakDir(dataDir, workshop.id));
  assert.ok(backups.some(name => name.endsWith('.json')));
});

test('主管联络只寻址活动工位且不读取其他岗位的联络票据', async t => {
  const { dataDir, feature, workshop, seat, otherSeat, port } = await fixture(t);
  const missing = await port.call(workshop.id, 'contact', { target: '其他工位', message: '不应送达' });
  assert.equal(missing.ok, false); assert.match(missing.result, /不属于当前工作室/);
  const record = await port.call(workshop.id, 'contact_read', { contactId: 'nonexistent' });
  assert.equal(record.ok, false); assert.match(record.result, /找不到/);
  const foreign = await port.call(workshop.id, 'contact', { target: otherSeat.id, message: '不可跨工作室' });
  assert.equal(foreign.ok, false); assert.match(foreign.result, /不属于当前工作室/);
  const duplicate = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-a', title: '临时' });
  duplicate.title = seat.title;
  await saveSeat(dataDir, workshop.id, duplicate);
  const ambiguous = await port.call(workshop.id, 'contact', { target: seat.title, message: '不可猜测同名目标' });
  assert.equal(ambiguous.ok, false); assert.match(ambiguous.result, /名称存在歧义/);
  await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-a', title: seat.id });
  // Occupy the receiver, then cancel admission: address resolution is real, no model runs.
  const release = tryAcquireSeatLock(workshop.id, seat.id)!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await port.call(workshop.id, 'contact', { target: seat.id, message: 'ID 优先且取消后不投递' }, controller.signal);
  } finally { clearTimeout(timer); release(); }
  const communications = await listWorkshopContactCommunications(dataDir, workshop.id);
  assert.equal(communications.length, 1);
  assert.equal(communications[0].targetId, seat.id);
  assert.equal(communications[0].sourceKind, 'supervisor');
  assert.equal(communications[0].delivered, false);
  assert.deepEqual((await loadSeat(dataDir, workshop.id, seat.id))?.messages, []);
});
