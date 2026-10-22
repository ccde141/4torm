import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { beginSeatContact } from '../../../engine/cyclone/seat-event-journal.js';
import { createDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { loadSeat, saveSeat } from '../../../engine/cyclone/seat-store.js';
import { seatMemoryFile } from '../../../engine/cyclone/seat-memory.js';
import { seatFile } from '../../../engine/cyclone/paths.js';
import { createCycloneFeature } from '../api/factory.js';

const human: CollaborationContext = { actor: { type: 'human', id: 'human', actingAs: 'human' },
  audience: 'human', enabledFeatures: new Set(['cyclone']),
  permissions: new Set(['observe', 'design']), requestId: 'console-test' };

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-console-'));
  const feature = createCycloneFeature({ dataDir });
  t.after(async () => { feature.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-a': { name: '研究员', model: 'provider:model', config: { toolMode: 'selected', tools: [] } },
  }));
  const workshop = await feature.workshops.create({ title: '项目甲' });
  const seat = await feature.workshops.addSeat({ workshopId: workshop.id,
    agentId: 'agent-a', title: '资料整理', rolePrompt: '核验项目资料' });
  return { dataDir, feature, workshop, seat };
}

test('工位概览按项目隔离实际执行事实且不复制私聊、派发正文或提供商凭据', async t => {
  const { dataDir, feature, workshop, seat } = await fixture(t);
  const other = await feature.workshops.create({ title: '项目乙' });
  const otherSeat = await feature.workshops.addSeat({ workshopId: other.id,
    agentId: 'agent-a', title: '另一项目工位' });
  const history = await loadSeat(dataDir, workshop.id, seat.id);
  history!.messages.push({ role: 'user', content: `private-history-${'x'.repeat(800_000)}` });
  await saveSeat(dataDir, workshop.id, history!);
  await feature.seatMemory.save(workshop.id, seat.id, 0, { title: '项目口径', content: 'private-memory' });
  const execution = { workshopId: workshop.id, targetKind: 'seat' as const,
    targetId: seat.id, agentId: 'agent-a', phase: 'seat-chat' as const,
    operationId: `seat:${workshop.id}:${seat.id}`, runId: 'run-a',
    startedAt: '2026-10-17T01:00:00.000Z' };
  await feature.runs.start(execution);
  await feature.runs.finish(execution.operationId, execution.runId, 'completed');
  await feature.runs.start({ ...execution, workshopId: other.id, targetId: otherSeat.id,
    operationId: `seat:${other.id}:${otherSeat.id}`, runId: 'run-other' });
  await feature.runs.finish(`seat:${other.id}:${otherSeat.id}`, 'run-other', 'completed');
  const contact = await beginSeatContact(dataDir, { workshopId: workshop.id, seatId: seat.id,
    agentId: 'agent-a', sourceSeatId: seat.id, sourceTitle: '资料整理', title: '同事联络' });
  await contact.finish('completed');
  await createDispatch(dataDir, { workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '',
    sourceSeatId: seat.id, sourceSeatTitle: seat.title, sourceTurnId: 'turn-a',
    sourceRoundSeq: 0, dispatchOrder: 0, targetSeatId: seat.id, targetSeatTitle: seat.title,
    task: 'private-dispatch-task' });
  const router = new CollaborationRouter([feature.module]);
  const result = await router.invoke({ feature: 'cyclone', method: 'readWorkshopConsole',
    input: { workshopId: workshop.id } }, human) as Awaited<ReturnType<typeof feature.console.read>>;
  assert.deepEqual(result.stats, { seatCount: 1, executionCount: 2, dispatchCount: 1, memoryCount: 1 });
  assert.equal(result.seats[0].agentId, 'agent-a');
  assert.equal(result.seats[0].capabilities.model, 'provider:model');
  assert.equal(result.seats[0].recent.length, 4);
  const memoryEvent = result.seats[0].recent.find(item => item.kind === 'memory');
  assert.equal(memoryEvent?.memoryTitle, '项目口径');
  assert.equal(memoryEvent?.memoryRevision, 1);
  assert.ok(memoryEvent?.memoryId);
  assert.equal(result.recent.some(item => item.runId === 'run-other'), false);
  const encoded = JSON.stringify(result);
  assert.equal(/private-history|private-memory|private-dispatch-task|apiKey/.test(encoded), false);
  assert.ok(encoded.length < 15_000);
  const again = await feature.console.read(workshop.id);
  assert.deepEqual(again.stats, result.stats);
  await feature.seats.updateRole(workshop.id, seat.id, { duty: '核验资料', rolePrompt: 'private-role-change' });
  await feature.seats.updateCollaboration(workshop.id, seat.id, { contact: false, dispatch: true, bulletin: true });
  const registry = path.join(dataDir, 'agents', 'registry.json');
  const agents = JSON.parse(await fs.readFile(registry, 'utf8'));
  agents['agent-b'] = { name: '检查员', model: 'provider:other', config: { toolMode: 'selected', tools: [] } };
  await fs.writeFile(registry, JSON.stringify(agents));
  await feature.seats.updateRole(workshop.id, seat.id, { agentId: 'agent-b' });
  const changed = await feature.console.read(workshop.id);
  assert.deepEqual(changed.stats, result.stats, '配置与记忆变更不计为执行或派发');
  const configuration = changed.recent.filter(item => item.kind === 'configuration');
  assert.equal(configuration.length, 2);
  assert.ok(configuration.some(item => item.changedFields?.includes('collaboration')));
  const binding = changed.recent.find(item => item.kind === 'binding');
  assert.equal(binding?.previousAgentId, 'agent-a');
  assert.equal(binding?.agentId, 'agent-b');
  assert.equal(changed.seats[0].capabilities.model, 'provider:other');
  assert.doesNotMatch(JSON.stringify(changed.recent), /private-role-change|private-memory|private-history/);
});

test('工位记忆损坏持续呈现未知统计并保留其余概览，不把失败伪装为零', async t => {
  const { dataDir, feature, workshop, seat } = await fixture(t);
  assert.equal((await feature.console.read(workshop.id)).stats.memoryCount, 0);
  const file = seatMemoryFile(dataDir, workshop.id, seat.id);
  await fs.writeFile(file, '{broken');
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await feature.console.read(workshop.id);
    assert.equal(result.stats.memoryCount, null);
    assert.equal(result.seats[0].stats.memoryCount, null);
    assert.match(result.seats[0].error ?? '', /损坏/);
    assert.equal(result.seats[0].capabilities.available, true);
  }
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('工作台查询沿中心校验受众和身份，记忆保存与同一变更通知衔接', async t => {
  const { feature, workshop, seat } = await fixture(t);
  const router = new CollaborationRouter([feature.module]);
  const changes: string[] = [];
  const stop = feature.changes.subscribe(change => changes.push(`${change.workshopId}:${change.id}`));
  t.after(stop);
  await router.invoke({ feature: 'cyclone', method: 'saveSeatMemory', input: {
    workshopId: workshop.id, seatId: seat.id, expectedRevision: 0,
    entry: { title: '验收口径', content: '仅本项目使用' },
  } }, human);
  assert.deepEqual(changes, [`${workshop.id}:${seat.id}`]);
  await assert.rejects(router.invoke({ feature: 'cyclone', method: 'readWorkshopConsole',
    input: { workshopId: workshop.id, agentId: 'agent-a' } }, human));
  await assert.rejects(router.invoke({ feature: 'cyclone', method: 'readWorkshopConsole',
    input: { workshopId: workshop.id } }, { ...human, audience: 'agent' }));
  await assert.rejects(feature.console.read('missing-workshop'), /工作室不存在/);
});

test('工位履历从完整事实分页和筛选，摘要截断不丢旧事件且游标绑定范围与快照', async t => {
  const { dataDir, feature, workshop, seat } = await fixture(t);
  for (let index = 0; index < 31; index++) {
    await feature.seats.updateRole(workshop.id, seat.id, { duty: `职责修订-${index}` });
  }
  for (let index = 0; index < 7; index++) {
    const execution = { workshopId: workshop.id, targetKind: 'seat' as const,
      targetId: seat.id, agentId: 'agent-a', phase: 'seat-chat' as const,
      operationId: `seat:${workshop.id}:${seat.id}`, runId: `run-${index}`,
      startedAt: `2026-10-17T01:00:0${index}.000Z` };
    await feature.runs.start(execution);
    await feature.runs.finish(execution.operationId, execution.runId, 'completed');
  }
  const summary = await feature.console.read(workshop.id);
  assert.equal(summary.seats[0].recent.length, 12);
  const router = new CollaborationRouter([feature.module]);
  const input = { workshopId: workshop.id, seatId: seat.id, limit: 20 };
  const first = await router.invoke({ feature: 'cyclone', method: 'readSeatHistory', input }, human) as
    Awaited<ReturnType<typeof feature.console.readSeatHistory>>;
  assert.equal(first.total, 38);
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  const second = await feature.console.readSeatHistory({ ...input, cursor: first.nextCursor });
  assert.equal(second.items.length, 18);
  assert.equal(second.nextCursor, undefined);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 38);
  assert.equal((await feature.console.readSeatHistory({ ...input, filter: 'work' })).total, 7);
  assert.equal((await feature.console.readSeatHistory({ ...input, filter: 'changes' })).total, 31);
  for (const changed of [{ limit: 10 }, { filter: 'changes' as const }]) {
    await assert.rejects(feature.console.readSeatHistory({ ...input, ...changed, cursor: first.nextCursor }), /状态已变化/);
  }
  const another = await feature.workshops.addSeat({ workshopId: workshop.id,
    agentId: 'agent-a', title: '无关岗位' });
  await assert.rejects(feature.console.readSeatHistory({ ...input, seatId: another.id,
    cursor: first.nextCursor }), /状态已变化/);
  // An unrelated malformed seat must not force a targeted read through the full console.
  await fs.writeFile(seatFile(dataDir, workshop.id, another.id), '{invalid');
  assert.equal((await feature.console.readSeatHistory(input)).total, 38);
  await feature.seats.updateRole(workshop.id, seat.id, { duty: '新的事实' });
  await assert.rejects(feature.console.readSeatHistory({ ...input, cursor: first.nextCursor }), /状态已变化/);
  for (const patch of [{ limit: 51 }, { filter: 'bad' }, { filter: ['all'] }, { cursor: '' }, { extra: true }]) {
    await assert.rejects(router.invoke({ feature: 'cyclone', method: 'readSeatHistory',
      input: { ...input, ...patch } }, human));
  }
  await assert.rejects(router.invoke({ feature: 'cyclone', method: 'readSeatHistory', input },
    { ...human, audience: 'agent' }));
});

test('本工位发出的联络在概览与完整履历使用相同目标名称', async t => {
  const { dataDir, feature, workshop, seat } = await fixture(t);
  const target = await feature.workshops.addSeat({ workshopId: workshop.id,
    agentId: 'agent-a', title: '资料核验' });
  const contact = await beginSeatContact(dataDir, { workshopId: workshop.id, seatId: target.id,
    agentId: 'agent-a', sourceSeatId: seat.id, sourceTitle: seat.title, title: '核验资料' });
  await contact.finish('completed');
  const console = await feature.console.read(workshop.id);
  const expected = console.seats.find(item => item.id === seat.id)!.recent.find(item => item.kind === 'contact');
  const page = await feature.console.readSeatHistory({ workshopId: workshop.id, seatId: seat.id });
  assert.deepEqual(page.items.find(item => item.kind === 'contact'), expected);
  assert.equal(expected?.title, '联络资料核验');
});
