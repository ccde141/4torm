import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { agentRegistryFile, skillDir } from '../../../services/data-paths.js';
import { loadSeat, saveSeat } from '../../../engine/cyclone/seat-store.js';
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

test('统筹 Agent 分页读取项目概况和工位继承能力，持续资料与原始会话分离', async t => {
  const { dataDir, feature, gateway, workshop, seat, identity } = await observationFixture(t);
  for (let index = 0; index < 12; index++) await feature.workshops.addSeat({
    workshopId: workshop.id, agentId: 'agent-a', title: `工位 ${index}`,
  });
  const other = await feature.workshops.create({ title: '其他项目' });
  const otherSeat = await feature.workshops.addSeat({ workshopId: other.id, agentId: 'agent-a', title: '其他项目工位' });
  for (const [workshopId, seatId, runId] of [[workshop.id, seat.id, 'project-run'],
    [other.id, otherSeat.id, 'other-project-run']]) {
    const operationId = `seat:${workshopId}:${seatId}`;
    await feature.runs.start({ workshopId, targetKind: 'seat', targetId: seatId,
      agentId: 'agent-a', phase: 'seat-chat', operationId, runId, startedAt: new Date().toISOString() });
    await feature.runs.finish(operationId, runId, 'completed');
  }
  const raw = (await loadSeat(dataDir, workshop.id, seat.id))!;
  raw.messages.push({ role: 'user', content: 'private-transcript', images: ['data:image/png;base64,private-image'] });
  await saveSeat(dataDir, workshop.id, raw);
  await feature.seatMemory.save(workshop.id, seat.id, 0, { title: '项目经验', content: 'private-memory-body' });
  await feature.seats.updateCollaboration(workshop.id, seat.id, { contact: false, dispatch: true, bulletin: true });
  const input = { workshopId: workshop.id, limit: 5 };
  const first = await gateway.invokeTool('read_collaboration_console', input, identity) as ConsolePage;
  assert.equal(first.stats.seatCount, 13);
  assert.equal(first.stats.memoryCount, 1);
  assert.equal(first.stats.executionCount, 1);
  const projectRun = first.recent?.find(item => item.runId === 'project-run');
  assert.ok(projectRun?.startedAt);
  assert.equal(projectRun?.status, 'completed');
  const recordedChanges = first.recent?.filter(item => item.kind === 'memory' || item.kind === 'configuration');
  assert.equal(recordedChanges?.length, 2);
  assert.ok(recordedChanges?.every(item => item.source));
  assert.equal(first.items.length, 5);
  const again = await gateway.invokeTool('read_collaboration_console', input, identity) as ConsolePage;
  assert.equal(again.revision, first.revision);
  const ids = first.items.map(item => item.seatId);
  let cursor = first.nextCursor;
  while (cursor) {
    const next = await gateway.invokeTool('read_collaboration_console', { ...input, cursor }, identity) as ConsolePage;
    ids.push(...next.items.map(item => item.seatId)); cursor = next.nextCursor;
  }
  assert.equal(new Set(ids).size, 13);
  const detailInput = { workshopId: workshop.id, seatId: seat.id, limit: 5 };
  const detail = await gateway.invokeTool('read_collaboration_console', detailInput, identity) as ConsolePage;
  assert.equal(detail.seat?.collaboration.contact, false);
  assert.equal(detail.seat?.rolePrompt, '核验资料并保留交付索引');
  assert.equal(detail.seat?.capabilities.model, 'local:test-model');
  const capabilities = [...detail.items]; cursor = detail.nextCursor;
  while (cursor) {
    const next = await gateway.invokeTool('read_collaboration_console', { ...detailInput, cursor }, identity) as ConsolePage;
    capabilities.push(...next.items); cursor = next.nextCursor;
  }
  assert.equal(capabilities.filter(item => item.kind === 'skill').length, 20);
  assert.ok(capabilities.every(item => !('parameters' in item) && !('content' in item)));
  assert.ok(JSON.stringify(detail).length <= 24_000);
  assert.doesNotMatch(JSON.stringify([first, detail]), /private-transcript|private-image|private-memory-body|private-api-key|private-skill-body/);
  await feature.seats.updateRole(workshop.id, seat.id, { duty: '新的职责范围' });
  await assert.rejects(gateway.invokeTool('read_collaboration_console', {
    ...input, cursor: first.nextCursor,
  }, identity), isConflict);
  await assert.rejects(gateway.invokeTool('read_collaboration_console', {
    workshopId: other.id, seatId: seat.id,
  }, identity), /工位不属于/);
});

test('统筹 Agent 以记忆版本分页定位并分段续读，更新后旧索引明确冲突', async t => {
  const { feature, gateway, workshop, seat, identity } = await observationFixture(t);
  const source = `需要保留的正文${'\u0000'.repeat(20_000)}`;
  for (let index = 0; index < 25; index++) await feature.seatMemory.save(workshop.id, seat.id, index,
    { title: `记录 ${index}${'\u0000'.repeat(180)}`, content: index ? '其他内容' : source });
  const input = { workshopId: workshop.id, seatId: seat.id };
  const list = await gateway.invokeTool('read_collaboration_seat_memory', { ...input, limit: 24 }, identity) as MemoryPage;
  assert.equal(list.revision, 25);
  assert.equal(list.total, 25);
  assert.ok(list.items.length < 24, 'JSON 转义后仍执行总响应预算');
  assert.ok(JSON.stringify(list).length <= 24_000);
  assert.equal('content' in list.items[0], false);
  const entryId = list.items[0].entryId;
  let offset = 0; let restored = '';
  do {
    const result = await gateway.invokeTool('read_collaboration_seat_memory', {
      ...input, entryId, revision: list.revision, offset,
    }, identity) as { content: string; nextOffset?: number };
    assert.ok(result.content.length <= 6_000);
    assert.ok(JSON.stringify(result).length <= 24_000);
    restored += result.content; offset = result.nextOffset ?? -1;
  } while (offset >= 0);
  assert.equal(restored, source);
  await feature.seatMemory.save(workshop.id, seat.id, list.revision, {
    id: entryId, title: '更新资料', content: '新正文',
  });
  await assert.rejects(gateway.invokeTool('read_collaboration_seat_memory', {
    ...input, entryId, revision: list.revision,
  }, identity), isConflict);
  await assert.rejects(gateway.invokeTool('read_collaboration_seat_memory', {
    ...input, cursor: list.nextCursor,
  }, identity), isConflict);
  await assert.rejects(gateway.invokeTool('read_collaboration_seat_memory', {
    ...input, entryId: 'missing-entry', revision: 26,
  }, identity), /记忆条目不存在/);
});

test('新只读能力受中心实时门控与严格参数约束，不能借人类接口维护工位', async t => {
  const { feature, gateway, workshop, seat, identity, setEnabled } = await observationFixture(t);
  const names = (await gateway.tools(identity)).map(tool => tool.name);
  assert.ok(names.includes('read_collaboration_console'));
  assert.ok(names.includes('read_collaboration_seat_memory'));
  for (const method of ['readWorkshopConsole', 'readSeatMemory', 'saveSeatMemory',
    'updateSeatCollaboration', 'updateSeatRole', 'resetSeatContext', 'compactSeatContext', 'deleteSeat']) {
    await assert.rejects(gateway.invoke({ feature: 'cyclone', method,
      input: { workshopId: workshop.id, seatId: seat.id } }, identity), error =>
      (error as { data?: { code?: string } }).data?.code === 'FEATURE_AGENT_METHOD_UNAVAILABLE');
  }
  const input = { workshopId: workshop.id, seatId: seat.id };
  await assert.rejects(gateway.invokeTool('read_collaboration_seat_memory', { seatId: seat.id }, identity), /workshopId/);
  await assert.rejects(gateway.invokeTool('read_collaboration_console', { seatId: seat.id }, identity), /workshopId/);
  await assert.rejects(gateway.invokeTool('read_collaboration_seat_memory', { workshopId: workshop.id }, identity), /seatId/);
  await assert.rejects(gateway.invokeTool('read_collaboration_seat_memory', { ...input, entryId: 'x' }, identity), /revision/);
  for (const extra of [{ limit: 0 }, { limit: 25 }, { offset: 0 }, { entryId: 'missing-revision' },
    { entryId: 'x', revision: 0, cursor: 'not-valid' }, { content: '不允许写入' }]) {
    await assert.rejects(gateway.invokeTool('read_collaboration_seat_memory', { ...input, ...extra }, identity));
  }
  await assert.rejects(gateway.invokeTool('read_collaboration_console', { ...input, limit: 13 }, identity));
  assert.deepEqual(await feature.seatMemory.read(workshop.id, seat.id), { revision: 0, entries: [] });
  setEnabled(false);
  assert.deepEqual(await gateway.tools(identity), []);
  for (const tool of ['read_collaboration_console', 'read_collaboration_seat_memory']) {
    await assert.rejects(gateway.invokeTool(tool, input, identity), error =>
      (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
  }
});

interface ConsolePage {
  revision: string; nextCursor?: string;
  stats: { seatCount: number; memoryCount: number; executionCount: number };
  recent?: Array<{ runId?: string; kind: string; source?: string; status: string; startedAt: string }>;
  items: Array<{ seatId?: string; kind?: string }>;
  seat?: { collaboration: { contact: boolean }; rolePrompt: string; capabilities: { model: string } };
}
interface MemoryPage {
  revision: number; nextCursor?: string; total: number; items: Array<{ entryId: string }>;
}

async function observationFixture(t: import('node:test').TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-observation-gateway-'));
  const feature = createCycloneFeature({ dataDir });
  t.after(async () => { feature.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const skills = Array.from({ length: 20 }, (_, index) => `skill-${index}`);
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ 'agent-a': { name: '资料员', model: 'local:test-model',
    apiKey: 'private-api-key', config: { toolMode: 'selected', tools: [], skills } } }));
  await Promise.all(skills.map(async id => {
    const directory = skillDir(dataDir, id);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ name: id, description: '核验资料' }));
    await fs.writeFile(path.join(directory, 'SKILL.md'), 'private-skill-body');
  }));
  const workshop = await feature.workshops.create({ title: '发布项目' });
  const seat = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-a',
    title: '资料整理', rolePrompt: '核验资料并保留交付索引' });
  let enabled = true;
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([feature.module]),
    async () => ({ toolMode: 'selected', tools: enabled ? ['framework_capability_cyclone'] : [] }));
  return { dataDir, feature, gateway, workshop, seat, identity: { agentId: 'agent-a' },
    setEnabled: (value: boolean) => { enabled = value; } };
}

function isConflict(error: unknown): boolean {
  return (error as { data?: { kind?: string } }).data?.kind === 'conflict';
}
