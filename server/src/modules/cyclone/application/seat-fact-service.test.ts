import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createCycloneFeature } from '../api/factory.js';
import { createDispatch, loadDispatch, updateDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { executeSeatFactTool } from '../../../engine/cyclone/seat-fact-tools.js';
import { buildContactToolCatalog, buildSeatToolCatalog } from '../../../engine/cyclone/seat-tool-catalog.js';
import { makeToolCaller } from '../../../engine/cyclone/seat-runner.js';
import { makeRoomToolCaller } from '../../../engine/cyclone/room-runner.js';
import { createDispatchStartBuffer } from '../../../engine/cyclone/dispatch-start-buffer.js';
import { runReActLoopNative } from '../../../engine/shared/react/native-loop.js';
import { runReActLoop } from '../../../engine/shared/react/text-loop.js';

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-seat-facts-'));
  const feature = createCycloneFeature({ dataDir });
  t.after(async () => { feature.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-a': { name: '共享能力', model: 'provider:model', config: { toolMode: 'selected', tools: [] } },
  }));
  const workshop = await feature.workshops.create({ title: '事实查询项目' });
  const seats = await Promise.all(['文案', '核验', '其他工位'].map(title =>
    feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'agent-a', title })));
  const scope = { workshopId: workshop.id, seatId: seats[0].id };
  const dispatch = async (source: number, target: number, order: number) => createDispatch(dataDir, {
    workshopId: workshop.id, sourceKind: 'seat', sourceRoomId: '',
    sourceSeatId: seats[source].id, sourceSeatTitle: seats[source].title,
    sourceTurnId: `turn-${order}`, sourceRoundSeq: 0, dispatchOrder: order,
    targetSeatId: seats[target].id, targetSeatTitle: seats[target].title,
    task: `核验-${order}`, receiptState: 'pending',
  });
  const read = async (args: Record<string, string> = {}) =>
    JSON.parse(await executeSeatFactTool(dataDir, scope, 'seat_dispatch_read', args));
  return { dataDir, feature, workshop, seats, scope, dispatch, read };
}

test('工位查询绑定岗位而非池Agent，拒绝身份字段且查询不消费或重放派发', async t => {
  const { dataDir, feature, workshop, seats, scope, dispatch, read } = await fixture(t);
  const mine = await dispatch(0, 1, 1);
  const hidden = await dispatch(1, 2, 2);
  const other = await feature.workshops.create({ title: '另一项目' });
  const own = await read();
  assert.deepEqual(own.items.map((item: { dispatchId: string }) => item.dispatchId), [mine.id]);
  await assert.rejects(read({ dispatchId: hidden.id }), /不属于本工位/);
  await assert.rejects(read({ seatId: seats[1].id }), /身份由框架绑定/);
  await assert.rejects(read({ workshopId: other.id }), /身份由框架绑定/);
  const before = await loadDispatch(dataDir, workshop.id, mine.id);
  await read({ dispatchId: mine.id, part: 'task' });
  assert.deepEqual(await loadDispatch(dataDir, workshop.id, mine.id), before);
  const incoming = JSON.parse(await executeSeatFactTool(dataDir,
    { ...scope, seatId: seats[1].id }, 'seat_dispatch_read', { direction: 'incoming' }));
  assert.deepEqual(incoming.items.map((item: { dispatchId: string }) => item.dispatchId), [mine.id]);
  await feature.seatMemory.save(workshop.id, scope.seatId, 0, { title: '口径', content: 'private-memory-body' });
  const activity = JSON.parse(await executeSeatFactTool(dataDir, scope, 'seat_activity_read', {}));
  assert.equal(activity.outgoingDispatches.open, 1);
  assert.equal(activity.stats.memoryCount, 1);
  assert.equal(activity.recent.some((item: { kind: string }) => item.kind === 'memory'), true);
  assert.equal(JSON.stringify(activity).includes('private-memory-body'), false);
  await feature.seats.updateRole(workshop.id, scope.seatId, { duty: '长职责'.repeat(6_000) });
  const bounded = JSON.parse(await executeSeatFactTool(dataDir, scope, 'seat_activity_read', {}));
  assert.equal(bounded.textTruncated, true);
  assert.ok(bounded.duty.length <= 240);
  assert.ok(JSON.stringify(bounded).length <= 18_000);
  feature.dispose();
  await assert.rejects(read(), /尚未就绪/);
});

test('派发按真实状态筛选，分页绑定工位与版本，长回报按实际JSON预算续读', async t => {
  const { dataDir, workshop, seats, scope, dispatch, read } = await fixture(t);
  const first = await dispatch(0, 1, 1);
  const second = await dispatch(0, 1, 2);
  const page = await read({ limit: '1' });
  assert.equal(page.total, 2);
  assert.ok(page.nextCursor);
  assert.equal((await read({ limit: '1', cursor: page.nextCursor })).items.length, 1);
  await assert.rejects(executeSeatFactTool(dataDir, { ...scope, seatId: seats[1].id },
    'seat_dispatch_read', { direction: 'incoming', cursor: page.nextCursor }), /状态已变化/);
  await updateDispatch(dataDir, workshop.id, second.id, { status: 'running' });
  await assert.rejects(read({ limit: '1', cursor: page.nextCursor }), /状态已变化/);
  const content = '\u0001'.repeat(7_000);
  await updateDispatch(dataDir, workshop.id, first.id, { status: 'completed', response: content });
  assert.equal((await read({ status: 'open' })).items[0].dispatchId, second.id);
  const part = await read({ dispatchId: first.id });
  assert.ok(JSON.stringify(part).length <= 18_000);
  assert.ok(part.nextOffset > 0 && part.nextOffset < content.length);
  const next = await read({ dispatchId: first.id, offset: String(part.nextOffset) });
  assert.equal(part.content + next.content, content.slice(0, part.content.length + next.content.length));
  assert.equal((await loadDispatch(dataDir, workshop.id, first.id))!.receiptState, 'pending');
  await assert.rejects(read({ dispatchId: first.id, status: 'all' }), /只填写/);
});

test('文本和原生执行共用绑定查询，群聊副本使用自身身份且未开放管理能力', async t => {
  const { dataDir, scope, dispatch } = await fixture(t);
  const item = await dispatch(0, 1, 1);
  const events: unknown[] = [];
  const tools = makeToolCaller({ dataDir, ...scope, seatTitle: '文案', agentId: 'agent-a',
    sandboxLevel: 'project', wsDir: 'workspace', signal: undefined,
    onEvent: event => events.push(event), onToolRegistration: () => {}, onExecution: () => {} });
  const catalog = buildSeatToolCatalog([], [], []);
  for (const mode of ['native', 'text']) {
    let step = 0;
    const llm = { call: async () => {
      if (++step === 1) return mode === 'native'
        ? { content: '', finishReason: 'tool_calls' as const,
          toolCalls: [{ id: 'facts-1', name: 'seat_dispatch_read', arguments: '{"status":"open"}' }] }
        : { content: '{"type":"tool_call","name":"seat_dispatch_read","arguments":{"status":"open"}}',
          finishReason: 'stop' as const };
      return { content: '文稿已完成；资料核验仍在排队，尚未收到最终结论。', finishReason: 'stop' as const };
    } };
    const options = { messages: [{ role: 'user' as const, content: '核对派发进展' }], llm, tools };
    const result = mode === 'native'
      ? await runReActLoopNative({ ...options, toolDefs: catalog })
      : await runReActLoop({ ...options, allowedTools: catalog.map(tool => tool.name) });
    assert.match(result.content, /仍在排队/);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(JSON.parse(result.toolCalls[0].result).items[0].dispatchId, item.id);
  }
  const room = makeRoomToolCaller({ dataDir, ...scope, seatTitle: '文案', agentId: 'agent-a',
    sandboxLevel: 'project', wsDir: 'workspace', speaker: '文案', signal: undefined,
    onEvent: () => {}, roomId: 'room-a', turnId: 'turn-a', roundSeq: 1, contextVersion: 0,
    dispatchStarts: createDispatchStartBuffer() });
  const observed = await room.call('seat_activity_read', {});
  assert.equal(JSON.parse(typeof observed === 'string' ? observed : observed.result).seatId, scope.seatId);
  for (const defs of [catalog, buildContactToolCatalog([], [])]) {
    for (const name of ['seat_activity_read', 'seat_dispatch_read']) assert.ok(defs.some(tool => tool.name === name));
    assert.equal(defs.some(tool => /delete|reset|compact/.test(tool.name)), false);
  }
  assert.ok(events.length > 0);
});

test('工位履历过滤与分页共享人类事实，JSON预算裁剪后游标不跳过未返回事件', async t => {
  const { dataDir, feature, workshop, scope } = await fixture(t);
  await feature.seats.updateRole(workshop.id, scope.seatId, { title: '\u0001'.repeat(120) });
  for (let index = 0; index < 26; index++) {
    await feature.seatMemory.save(workshop.id, scope.seatId, index, {
      title: `${index}-${'\u0001'.repeat(190)}`, content: '正文不进入履历',
    });
  }
  const read = async (args: Record<string, string> = {}) => JSON.parse(
    await executeSeatFactTool(dataDir, scope, 'seat_activity_read', { filter: 'changes', limit: '12', ...args }));
  const first = await read();
  assert.equal(first.total, 27);
  assert.ok(first.recent.length < 12, '实际JSON转义后的输出预算必须收窄本页');
  assert.ok(first.nextCursor);
  const all = [...first.recent];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await read({ cursor });
    assert.ok(JSON.stringify(page).length <= 18_000);
    assert.ok(page.recent.length > 0);
    all.push(...page.recent);
    cursor = page.nextCursor;
  }
  assert.equal(all.length, 27);
  assert.equal(new Set(all.map(item => item.id)).size, 27);
  const human = await feature.console.readSeatHistory({ ...scope, filter: 'changes', limit: 50 });
  assert.deepEqual(all.map(item => item.id), human.items.map(item => item.id));
  assert.equal((await read({ filter: 'work' })).total, 0);
  await assert.rejects(read({ limit: '11', cursor: first.nextCursor }), /状态已变化/);
  await feature.seats.updateRole(workshop.id, scope.seatId, { duty: '新职责' });
  await assert.rejects(read({ cursor: first.nextCursor }), /状态已变化/);
});
