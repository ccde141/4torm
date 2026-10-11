import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { createWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { workshopIndexFile, dispatchFile } from '../../../engine/cyclone/paths.js';
import { createDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { addSeat } from '../../../engine/cyclone/seat-store.js';
import { createCycloneFeature } from './factory.js';

test('气旋索引损坏时探针持续报错且不覆盖原始文件', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-corrupt-index-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await createWorkshop(dataDir, { title: '保留索引' });
  const indexFile = workshopIndexFile(dataDir);
  await fs.writeFile(indexFile, '{broken', 'utf8');
  const router = new CollaborationRouter([createCycloneFeature({ dataDir }).module]);
  const context = { actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const },
    audience: 'human' as const, enabledFeatures: new Set(['cyclone']),
    permissions: new Set(['observe' as const]), requestId: 'corrupt-index' };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(router.observe('cyclone', {}, context), error =>
      (error as { data?: { code?: string } }).data?.code === 'CYCLONE_STORE_CORRUPT');
  }
  assert.equal(await fs.readFile(indexFile, 'utf8'), '{broken');
  await fs.writeFile(indexFile, '"cyc-missing"', 'utf8');
  await assert.rejects(router.observe('cyclone', {}, context), error =>
    (error as { data?: { code?: string } }).data?.code === 'CYCLONE_STORE_CORRUPT');
  assert.equal(await fs.readFile(indexFile, 'utf8'), '"cyc-missing"');
  await fs.rename(indexFile, `${indexFile}.corrupt-legacy`);
  await assert.rejects(router.observe('cyclone', {}, context), error =>
    (error as { data?: { code?: string } }).data?.code === 'CYCLONE_STORE_CORRUPT');
});

test('气旋派发记录损坏时探针不将工作室误报为空闲', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-corrupt-dispatch-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '派发中' });
  const dispatch = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '发起方', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '目标', task: '执行任务',
  });
  const file = dispatchFile(dataDir, workshop.id, dispatch.id);
  await fs.writeFile(file, '{broken', 'utf8');
  const router = new CollaborationRouter([createCycloneFeature({ dataDir }).module]);
  const context = { actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const },
    audience: 'human' as const, enabledFeatures: new Set(['cyclone']),
    permissions: new Set(['observe' as const]), requestId: 'corrupt-dispatch' };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(router.observe('cyclone', {}, context), error =>
      (error as { data?: { code?: string } }).data?.code === 'CYCLONE_STORE_CORRUPT');
  }
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.rename(file, `${file}.corrupt-legacy`);
  await assert.rejects(router.observe('cyclone', {}, context), error =>
    (error as { data?: { code?: string } }).data?.code === 'CYCLONE_STORE_CORRUPT');
});

test('气旋目的级执行身份立即进入统一探针并由端口写入终态', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-feature-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '并行工作室' });
  const seat = await addSeat(dataDir, workshop.id,
    { title: '测试成员', agentId: 'agent-test' });
  const feature = createCycloneFeature({ dataDir });
  const room = await feature.rooms.create({
    workshopId: workshop.id, title: '测试房间', topic: '验证生命周期', participantSeatIds: [seat.id],
  });
  const router = new CollaborationRouter([feature.module]);
  const context = {
    actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const },
    audience: 'human' as const,
    enabledFeatures: new Set(['cyclone']),
    permissions: new Set(['observe' as const, 'execute' as const]),
    requestId: 'factory-test',
  };

  const prepared = await feature.roomRounds.prepare({
    workshopId: workshop.id, roomId: room.id, message: '开始',
  });
  const run = prepared.execution;
  const observed = await router.observe('cyclone', { view: 'summary' }, context);
  assert.deepEqual(observed.items.map(item => ({
    operationId: item.operationId, parentOperationId: item.parentOperationId,
    status: item.status, phase: item.phase,
  })), [{
    operationId: workshop.id, parentOperationId: undefined, status: 'running', phase: undefined,
  }, {
    operationId: `room:${workshop.id}:${room.id}`, parentOperationId: workshop.id,
    status: 'running', phase: 'room-speak',
  }]);

  const waiting = router.waitOperation('cyclone', run, context, 1_000);
  await router.invoke({
    feature: 'cyclone', method: 'abortExecution', input: {
      operationId: run.operationId, runId: run.runId,
    },
  }, { ...context, permissions: new Set(['observe', 'intervene']) });
  await prepared.run();
  assert.equal((await waiting).fact.status, 'aborted');
  const terminal = await router.inspectOperation('cyclone', run, context);
  assert.equal(terminal.status, 'aborted');
  assert.equal(feature.executions.list().length, 0);
  const settled = await router.observe('cyclone', { view: 'summary' }, context);
  assert.deepEqual(settled.items.map(item => [item.operationId, item.status]), [
    [workshop.id, 'idle'],
    [`room:${workshop.id}:${room.id}`, 'aborted'],
  ]);
});

test('气旋下一轮开始后旧运行句柄仍能由中心精确检查', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-old-run-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '重复运行' });
  const seat = await addSeat(dataDir, workshop.id,
    { title: '测试成员', agentId: 'agent-test' });
  const feature = createCycloneFeature({ dataDir });
  const room = await feature.rooms.create({
    workshopId: workshop.id, title: '测试房间', topic: '检查旧句柄', participantSeatIds: [seat.id],
  });
  const router = new CollaborationRouter([feature.module]);
  const context = {
    actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const },
    audience: 'human' as const, enabledFeatures: new Set(['cyclone']),
    permissions: new Set(['observe' as const]), requestId: 'old-run-test',
  };
  const first = await feature.roomRounds.prepare({
    workshopId: workshop.id, roomId: room.id, message: '第一轮',
  });
  await router.invoke({ feature: 'cyclone', method: 'abortExecution', input: {
    operationId: first.execution.operationId, runId: first.execution.runId,
  } },
    { ...context, permissions: new Set(['observe', 'intervene']) });
  await first.run();
  const second = await feature.roomRounds.prepare({
    workshopId: workshop.id, roomId: room.id, message: '第二轮',
  });
  assert.equal((await router.inspectOperation('cyclone', first.execution, context)).status, 'aborted');
  assert.equal((await router.inspectOperation('cyclone', second.execution, context)).status, 'running');
  await router.invoke({ feature: 'cyclone', method: 'abortExecution', input: {
    operationId: second.execution.operationId, runId: second.execution.runId,
  } },
    { ...context, permissions: new Set(['observe', 'intervene']) });
  await second.run();
});

test('气旋旧运行进入中心记录索引且只返回真实保存的事实', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-record-port-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createCycloneFeature({ dataDir });
  await feature.runs.start({ operationId: 'seat:workshop-a:seat-a',
    runId: 'cyclone-run-a', workshopId: 'workshop-a',
    targetKind: 'seat', targetId: 'seat-a', phase: 'seat-chat',
    startedAt: '2026-09-30T00:00:00.000Z' });
  await feature.runs.finish('seat:workshop-a:seat-a', 'cyclone-run-a', 'failed', '执行失败');
  const router = new CollaborationRouter([feature.module]);
  const context = { actor: { type: 'agent' as const, id: 'main', actingAs: 'human' as const },
    audience: 'agent' as const, enabledFeatures: new Set(['cyclone' as const]),
    permissions: new Set(['observe' as const]), requestId: 'session-a' };
  const found = await router.listOperationRecords('cyclone', {}, context);
  assert.deepEqual(found.items.map(item => item.runId), ['cyclone-run-a']);
  const page = await router.readOperationRecord('cyclone', {
    operationId: 'seat:workshop-a:seat-a', runId: 'cyclone-run-a',
  }, {}, context);
  assert.match(page.text, /执行失败/);
  assert.match(page.text, /"detailAvailable": false/);
});

test('气旋工位运行索引指向绑定 Agent 和所属工作室', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-agent-index-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const seat = await addSeat(dataDir, workshop.id,
    { title: '编写', agentId: 'agent-writer' });
  const feature = createCycloneFeature({ dataDir });
  const operationId = `seat:${workshop.id}:${seat.id}`;
  await feature.runs.start({ operationId, runId: 'run-a',
    workshopId: workshop.id, targetKind: 'seat', targetId: seat.id,
    agentId: seat.agentId,
    phase: 'seat-chat', startedAt: '2026-09-30T00:00:00.000Z' });
  await feature.runs.finish(operationId, 'run-a', 'completed');
  const router = new CollaborationRouter([feature.module]);
  const context = { actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const },
    audience: 'human' as const, enabledFeatures: new Set(['cyclone' as const]),
    permissions: new Set(['observe' as const]), requestId: 'index-a' };
  const records = await router.listOperationRecords('cyclone',
    { agentId: 'agent-writer' }, context);
  assert.equal(records.items[0]?.operationId, operationId);
  assert.equal(records.items[0]?.sessionId, seat.id);
});

test('气旋房间运行索引保留会话 ID 和实际参与成员', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-room-index-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createCycloneFeature({ dataDir });
  await feature.runs.start({ operationId: 'room:workshop-a:room-a', runId: 'run-a',
    workshopId: 'workshop-a', targetKind: 'room', targetId: 'room-a',
    phase: 'room-speak', startedAt: '2026-09-30T00:00:00.000Z' });
  await feature.runs.finish('room:workshop-a:room-a', 'run-a', 'completed',
    undefined, ['agent-a']);
  const router = new CollaborationRouter([feature.module]);
  const context = { actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const },
    audience: 'human' as const, enabledFeatures: new Set(['cyclone' as const]),
    permissions: new Set(['observe' as const]), requestId: 'room-index' };
  const records = await router.listOperationRecords('cyclone', { agentId: 'agent-a' }, context);
  assert.equal(records.items[0]?.sessionId, 'room-a');
});

test('Agent 用单一高层工具原子创建气旋协作组', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-group-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(agentRegistryFile(dataDir)), { recursive: true });
  await fs.writeFile(agentRegistryFile(dataDir), JSON.stringify({
    architect: { id: 'architect', name: '架构师', model: 'test' },
    reviewer: { id: 'reviewer', name: '复核员', model: 'test' },
  }));
  const feature = createCycloneFeature({ dataDir });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]),
    async () => ({ toolMode: 'selected', tools: [
      'create_collaboration_group', 'read_collaboration_group',
    ] }),
  );
  assert.ok(gateway.catalog().some(tool => tool.name === 'start_collaboration_round'));
  const result = await gateway.invokeTool('create_collaboration_group', {
    title: '发布协作组', chairAgentId: 'architect',
    members: [
      { agentId: 'architect', title: '架构', duty: '设计模块边界' },
      { agentId: 'reviewer', title: '复核', duty: '独立检查结果' },
    ],
    room: { title: '协作大厅', topic: '完成发布准备', mode: 'build' },
  }, { agentId: 'architect', sessionId: 'session-a' }) as {
    workshopId: string; seats: Array<{ seatId: string }>; room: { roomId: string };
  };

  const summary = await feature.workshops.summary(result.workshopId);
  assert.equal(summary.seats.length, 2);
  assert.equal(summary.rooms.length, 1);
  assert.deepEqual((await feature.rooms.require(result.workshopId, result.room.roomId))
    .participantSeatIds, result.seats.map(seat => seat.seatId));
  const view = await gateway.invokeTool('read_collaboration_group', {
    workshopId: result.workshopId,
  }, { agentId: 'architect', sessionId: 'session-a' }) as { workshopId: string };
  assert.equal(view.workshopId, result.workshopId);
});

test('气旋协作组在 Agent 预检失败时不留下半成品', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-group-fail-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(agentRegistryFile(dataDir)), { recursive: true });
  await fs.writeFile(agentRegistryFile(dataDir), '{}');
  const feature = createCycloneFeature({ dataDir });
  const gateway = new AgentCollaborationGateway(
    new CollaborationRouter([feature.module]),
    async () => ({ toolMode: 'all', tools: [] }),
  );
  await assert.rejects(() => gateway.invokeTool('create_collaboration_group', {
    title: '无效协作组', members: [{ agentId: 'missing', title: '不存在' }],
    room: { title: '大厅', topic: '测试' },
  }, { agentId: 'caller' }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CYCLONE_GROUP_AGENT_NOT_FOUND');
  assert.deepEqual(await feature.workshops.list(), []);
});
