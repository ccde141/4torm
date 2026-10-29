import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { AgentToolOutput } from '../../../engine/collaboration/contracts.js';
import { resolveToolTransportContract } from '../../../model-runtime/config/tool-transport-contract.js';
import { loadSupervisor, mutateSupervisor, readSupervisorInbox, hasEstablishedSupervisorGoal,
  enqueueSupervisorInformation } from '../../../engine/cyclone/supervisor-store.js';
import { clearDispatchAdmissionTimers, drainCycloneDispatches } from '../../../engine/cyclone/dispatch-queue.js';
import { listWorkshopDispatches } from '../../../engine/cyclone/dispatch-store.js';
import { withSupervisorReporting } from '../../../engine/cyclone/supervisor-tools.js';
import { createCycloneFeature } from './factory.js';

interface Request { messages: Array<{ role: string; content?: unknown; tool_calls?: unknown[] }> }
function response(content: string, tool?: { name: string; args: Record<string, unknown> }, native = true) {
  const delta = tool ? native ? { tool_calls: [{ index: 0, id: `call-${tool.name}`, type: 'function',
    function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }
    : { content: JSON.stringify({ type: 'tool_call', name: tool.name, arguments: tool.args }) } : { content };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta,
    finish_reason: tool && native ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
  { headers: { 'Content-Type': 'text/event-stream' } });
}
function toolCalled(request: Request, name: string) {
  return request.messages.some(message => message.role === 'assistant' && JSON.stringify(message).includes(name));
}
function value<T>(output: unknown): T { return (output instanceof AgentToolOutput ? output.value : output) as T; }

async function fixture(t: TestContext, native = true) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-agent-supervisor-'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify(Object.fromEntries(
    ['main', 'chief', 'worker'].map(id => [id, { id, name: id, model: 'test:model',
      config: { toolMode: 'selected', tools: [], skills: [] } }]))));
  const provider = { id: 'test', providerType: 'openai-compatible',
    transport: 'openai-chat-completions', baseUrl: 'https://mock.invalid/v1', models: ['model'] } as const;
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
    ...(!native ? { toolTransports: { model: { status: 'text-required', checkedAt: 'now',
      fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } } } : {}),
  }] }));
  let respond = (_request: Request, _init?: RequestInit): Response | Promise<Response> => response('已核验。');
  const requests: Request[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Request;
    requests.push(request); return respond(request, init);
  });
  const feature = createCycloneFeature({ dataDir, summarizer: { summarize: async () => ({ summary: '保留项目结论', retainedIndexes: [] }) } });
  const router = new CollaborationRouter([feature.module]);
  feature.connectSupervisorRouter(router);
  let tools = ['framework_capability_cyclone'];
  const gateway = new AgentCollaborationGateway(router, async () => ({ toolMode: 'selected', tools }));
  const identity = { agentId: 'main', sessionId: 'session-main' };
  const invoke = async <T = Record<string, unknown>>(tool: string, input: unknown) =>
    value<T>(await gateway.invokeTool(tool, input, identity));
  const create = (title: string, supervisor = false) => invoke<{
    workshopId: string; seats: Array<{ seatId: string }>; supervisor: { configured: boolean };
  }>('create_collaboration_group', { title, members: [{ agentId: 'worker', title: '核验员' }],
    room: { title: '大厅', topic: '核验结果' },
    ...(supervisor ? { supervisorAgentId: 'chief', supervisorRolePrompt: '跟进核验任务' } : {}) });
  t.after(async () => {
    await drainCycloneDispatches(); clearDispatchAdmissionTimers(dataDir);
    await feature.shutdown(); feature.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { dataDir, feature, gateway, router, invoke, create, identity, requests,
    respond(next: typeof respond) { respond = next; }, revoke() { tools = []; } };
}

test('框架Agent创建与首次绑定主管均经过岛内服务，已有绑定和伪造来源被拒绝', async t => {
  const f = await fixture(t);
  const plain = await f.create('无主管');
  assert.equal(plain.supervisor.configured, false);
  assert.deepEqual(await withSupervisorReporting(f.dataDir, plain.workshopId, []), []);
  const configured = await f.invoke<{ configured: boolean; agentId: string }>('configure_collaboration_supervisor', {
    workshopId: plain.workshopId, agentId: 'chief', rolePrompt: '统筹核验',
  });
  assert.equal(configured.agentId, 'chief');
  assert.equal(configured.configured, true);
  assert.equal((await withSupervisorReporting(f.dataDir, plain.workshopId, []))[0]?.name, 'supervisor_message');
  await assert.rejects(f.invoke('configure_collaboration_supervisor', {
    workshopId: plain.workshopId, agentId: 'main',
  }), /人类在工作台/);
  assert.equal((await loadSupervisor(f.dataDir, plain.workshopId)).agentId, 'chief');
  for (const extra of [{ source: 'human' }, { origin: { kind: 'human' } }, { mode: 'chat' }]) {
    await assert.rejects(f.invoke('start_collaboration_supervisor_chat', {
      workshopId: plain.workshopId, text: '不得伪造来源', ...extra,
    }), /参数无效/);
  }
  await assert.rejects(f.gateway.invoke({ feature: 'cyclone', method: 'configureSupervisor',
    input: { workshopId: plain.workshopId, agentId: 'main' } }, f.identity), /未向 Agent 开放/);
  const withChief = await f.create('有主管', true);
  const group = await f.invoke<{ supervisor: { agentId: string } }>('read_collaboration_group', { workshopId: withChief.workshopId });
  assert.equal(group.supervisor.agentId, 'chief');
  const console = await f.invoke<{ supervisor: { configured: boolean } }>('read_collaboration_console', { workshopId: withChief.workshopId });
  assert.equal(console.supervisor.configured, true);
  const before = (await f.feature.workshops.list()).length;
  await assert.rejects(f.invoke('create_collaboration_group', { title: '无效主管', supervisorAgentId: 'missing',
    members: [{ agentId: 'worker', title: '成员' }], room: { title: '大厅', topic: '测试' } }), /Agent 不存在/);
  assert.equal((await f.feature.workshops.list()).length, before);
  f.revoke();
  await assert.rejects(f.invoke('read_collaboration_supervisor', { workshopId: plain.workshopId }), /未启用/);
  assert.equal(f.requests.length, 0);
});

test('主管配置失败完整撤销未发布协作组，不留下无主管半成品', async t => {
  const f = await fixture(t);
  let draftId = '';
  t.mock.method(f.feature.supervisor, 'configureInitial', async (workshopId: string) => {
    draftId = workshopId;
    throw new Error('fixture supervisor write failed');
  });
  await assert.rejects(f.create('失败草稿', true), /supervisor write failed/);
  assert.deepEqual(await f.feature.workshops.list(), []);
  await assert.rejects(f.feature.workshops.require(draftId), /不存在/);
  assert.equal(f.requests.length, 0);
});

test('主管收件箱有界分页与正文续读，普通会话不包含系统和内部续接提示', async t => {
  const f = await fixture(t);
  const group = await f.create('读取项目', true);
  const workshopId = group.workshopId;
  const body = '\u0000'.repeat(12_000);
  for (let n = 0; n < 12; n++) await enqueueSupervisorInformation(f.dataDir, workshopId, {
    id: `report-${n}`, sourceKind: 'seat', sourceId: group.seats[0].seatId,
    sourceTitle: '核验员', content: body,
  });
  type InboxView = { revision: string; inbox: { total: number; pending: number;
    items: Array<{ informationId: string; contentTruncated: boolean }>; nextCursor?: string } };
  const page = await f.invoke<InboxView>('read_collaboration_supervisor', { workshopId, limit: 12 });
  assert.ok(JSON.stringify(page).length <= 24_000);
  assert.ok(page.inbox.items.length < 12);
  assert.equal(page.inbox.total, 12);
  assert.equal(page.inbox.pending, 12);
  assert.ok(page.inbox.items.every(item => item.contentTruncated));
  const ids = page.inbox.items.map(item => item.informationId);
  let cursor = page.inbox.nextCursor;
  while (cursor) {
    const next = await f.invoke<InboxView>('read_collaboration_supervisor', { workshopId, limit: 12, cursor });
    assert.ok(JSON.stringify(next).length <= 24_000);
    ids.push(...next.inbox.items.map(item => item.informationId)); cursor = next.inbox.nextCursor;
  }
  assert.equal(new Set(ids).size, 12);
  let restored = ''; let offset: number | undefined = 0;
  while (offset !== undefined) {
    const part = await f.invoke<{ content: string; nextOffset?: number }>('read_collaboration_supervisor', {
      workshopId, informationId: ids[0], revision: page.revision, offset,
    });
    assert.ok(JSON.stringify(part).length <= 24_000);
    restored += part.content; offset = part.nextOffset;
  }
  assert.equal(restored, body);
  await mutateSupervisor(f.dataDir, workshopId, state => {
    state.messages = [{ role: 'system', content: 'private-system' },
      { role: 'user', content: 'private-internal', supervisorInternal: true },
      { role: 'user', content: '普通需求' }, { role: 'assistant', content: '普通回复' }];
  });
  const thread = await f.invoke<{ revision: string; items: Array<{ index: number; content: string }> }>('read_collaboration_thread', {
    workshopId, target: 'supervisor', targetId: 'supervisor',
  });
  assert.deepEqual(thread.items.map(item => item.content), ['普通需求', '普通回复']);
  const message = await f.invoke<{ content: string }>('read_collaboration_message', {
    workshopId, target: 'supervisor', targetId: 'supervisor', revision: thread.revision, index: 1,
  });
  assert.equal(message.content, '普通回复');
  await assert.rejects(f.invoke('read_collaboration_thread', { workshopId, target: 'supervisor',
    targetId: group.seats[0].seatId }), /目标应为 supervisor/);
  const other = await f.create('另一项目', true);
  const otherView = await f.invoke<InboxView>('read_collaboration_supervisor', { workshopId: other.workshopId });
  await assert.rejects(f.invoke('read_collaboration_supervisor', { workshopId: other.workshopId,
    informationId: ids[0], revision: otherView.revision }), /不属于当前工作室/);
  await assert.rejects(f.invoke('read_collaboration_supervisor', { workshopId, informationId: ids[0],
    revision: page.revision }), /已变化/);
  assert.equal(f.requests.length, 0);
});

test('外部Agent工位履历默认8项，按游标读取更早事项且不可越工作室寻址', async t => {
  const f = await fixture(t);
  const group = await f.create('履历项目');
  const seatId = group.seats[0].seatId;
  for (let n = 0; n < 21; n++) await f.feature.seatMemory.save(group.workshopId, seatId, n, {
    title: `记忆 ${n}`, content: `项目事实 ${n}`,
  });
  const page = await f.invoke<{ items: unknown[]; total: number; nextCursor?: string }>('read_collaboration_seat_history', {
    workshopId: group.workshopId, seatId,
  });
  assert.equal(page.items.length, 8); assert.ok(page.total >= 21); assert.ok(page.nextCursor);
  const next = await f.invoke<{ items: unknown[] }>('read_collaboration_seat_history', {
    workshopId: group.workshopId, seatId, cursor: page.nextCursor,
  });
  assert.equal(next.items.length, 8);
  const other = await f.create('另一履历项目');
  await assert.rejects(f.invoke('read_collaboration_seat_history', { workshopId: other.workshopId, seatId }), /不属于/);
});

test('委托启动取消和模型失败均释放真实执行状态且不自动重放', async t => {
  const f = await fixture(t);
  const group = await f.create('失败与取消', true);
  const signal = AbortSignal.abort(new Error('fixture cancelled'));
  await assert.rejects(f.gateway.invokeTool('start_collaboration_supervisor_chat', {
    workshopId: group.workshopId, text: '不要执行',
  }, { ...f.identity, signal }), /cancelled/);
  assert.equal(f.feature.executions.list().length, 0);
  const original = f.feature.supervisor.prepare.bind(f.feature.supervisor);
  const controller = new AbortController();
  const prepareMock = t.mock.method(f.feature.supervisor, 'prepare', async input => {
    const prepared = await original(input);
    controller.abort(new Error('fixture cancelled after preparation'));
    return prepared;
  });
  await assert.rejects(f.gateway.invokeTool('start_collaboration_supervisor_chat', {
    workshopId: group.workshopId, text: '准备后取消',
  }, { ...f.identity, signal: controller.signal }), /cancelled after preparation/);
  prepareMock.mock.restore();
  assert.equal(f.feature.executions.list().length, 0);
  assert.equal((await f.feature.supervisor.status(group.workshopId)).busy, false);
  assert.equal(f.requests.length, 0);
  f.respond(() => new Response('{"error":{"message":"fixture rejected"}}', { status: 400 }));
  const run = await f.invoke<{ operationId: string; runId: string }>('start_collaboration_supervisor_chat', {
    workshopId: group.workshopId, text: '验证失败终态',
  });
  const result = await f.invoke<{ status: string }>('wait_operation', { feature: 'cyclone',
    operationId: run.operationId, runId: run.runId, timeoutMs: 5_000 });
  assert.equal(result.status, 'failed');
  assert.equal(f.feature.executions.list().length, 0);
  assert.equal((await f.feature.supervisor.status(group.workshopId)).busy, false);
  assert.equal(f.requests.length, 1);
});

test('主管单会话拒绝并发委托，首次绑定并发只提交一次', async t => {
  const f = await fixture(t);
  const group = await f.create('并发项目');
  const bindings = await Promise.allSettled(['chief', 'main'].map(agentId => f.invoke(
    'configure_collaboration_supervisor', { workshopId: group.workshopId, agentId })));
  assert.equal(bindings.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(bindings.filter(item => item.status === 'rejected').length, 1);
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  f.respond(async () => { await held; return response('已完成当前委托'); });
  const run = await f.invoke<{ operationId: string; runId: string }>('start_collaboration_supervisor_chat', {
    workshopId: group.workshopId, text: '第一项委托',
  });
  try {
    await eventually(async () => f.requests.length === 1);
    await assert.rejects(f.invoke('start_collaboration_supervisor_chat', {
      workshopId: group.workshopId, text: '不能穿插第二项委托',
    }), /正在/);
    const state = await f.invoke<{ busy: boolean }>('read_collaboration_supervisor', { workshopId: group.workshopId });
    assert.equal(state.busy, true);
  } finally { finish(); }
  const result = await f.invoke<{ status: string }>('wait_operation', { feature: 'cyclone',
    operationId: run.operationId, runId: run.runId, timeoutMs: 5_000 });
  assert.equal(result.status, 'completed');
  assert.equal(f.requests.length, 1);
});

test('委托目标与首条输入原子提交，落盘失败不会留下可自行接续的空目标', async t => {
  const f = await fixture(t);
  const group = await f.create('目标提交失败', true);
  const target = path.join(f.dataDir, 'cyclone', group.workshopId, 'supervisor.json');
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (from, to) => {
    if (String(to) === target) {
      const value = JSON.parse(await fs.readFile(from, 'utf8')) as { messages: Array<{ content: string }> };
      if (value.messages.some(message => message.content.includes('委托正文不得丢失'))) {
        throw Object.assign(new Error('fixture goal commit failed'), { code: 'EIO' });
      }
    }
    return rename(from, to);
  });
  const run = await f.invoke<{ operationId: string; runId: string }>('start_collaboration_supervisor_chat', {
    workshopId: group.workshopId, text: '委托正文不得丢失',
  });
  const result = await f.invoke<{ status: string }>('wait_operation', { feature: 'cyclone',
    operationId: run.operationId, runId: run.runId, timeoutMs: 5_000 });
  assert.equal(result.status, 'failed');
  const saved = await loadSupervisor(f.dataDir, group.workshopId);
  assert.equal(hasEstablishedSupervisorGoal(saved), false);
  assert.equal(saved.messages.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.feature.executions.list().length, 0);
});

for (const native of [true, false]) test(`真实网关贯通工位上报、主管委托派发和回执（${native ? 'native' : 'text'}）`, async t => {
  const f = await fixture(t, native);
  const group = await f.create('项目链路', true);
  const workshopId = group.workshopId;
  const seatId = group.seats[0].seatId;
  f.respond(request => {
    const chief = String(request.messages[0].content).includes('你是当前气旋工作室的主管');
    if (chief) return !toolCalled(request, 'dispatch')
      ? response('', { name: 'dispatch', args: { target: seatId, task: '复核资料并回报' } }, native)
      : response('已检查工位回报与结果。');
    const latestUser = [...request.messages].reverse().find(message => message.role === 'user');
    if (String(latestUser?.content).includes('报告阻塞') && !toolCalled(request, 'supervisor_message')) {
      return response('', { name: 'supervisor_message', args: { message: '资料已整理，需要主管安排核验。' } }, native);
    }
    return response('资料核验完成，证据位于报告。');
  });
  const seatRun = await f.invoke<{ operationId: string; runId: string }>('start_collaboration_seat_chat', {
    workshopId, seatId, text: '报告阻塞给主管，然后说明当前进展',
  });
  const seatResult = await f.invoke<{ status: string }>('wait_operation', { feature: 'cyclone',
    operationId: seatRun.operationId, runId: seatRun.runId, timeoutMs: 5_000 });
  assert.equal(seatResult.status, 'completed');
  const waiting = await loadSupervisor(f.dataDir, workshopId);
  assert.equal(hasEstablishedSupervisorGoal(waiting), false);
  assert.equal(waiting.messages.length, 0);
  assert.equal((await readSupervisorInbox(f.dataDir, workshopId)).length, 1);
  const chiefRun = await f.invoke<{ operationId: string; runId: string }>('start_collaboration_supervisor_chat', {
    workshopId, text: '请安排核验并跟进交付',
  });
  const chiefResult = await f.invoke<{ status: string }>('wait_operation', { feature: 'cyclone',
    operationId: chiefRun.operationId, runId: chiefRun.runId, timeoutMs: 5_000 });
  assert.equal(chiefResult.status, 'completed');
  await drainCycloneDispatches();
  await eventually(async () => {
    const inbox = await readSupervisorInbox(f.dataDir, workshopId);
    return inbox.some(item => item.sourceKind === 'dispatch' && Boolean(item.consumedAt));
  });
  const dispatches = await listWorkshopDispatches(f.dataDir, workshopId);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].sourceKind, 'supervisor');
  assert.equal(dispatches[0].sourceSeatId, 'supervisor');
  assert.equal(dispatches[0].status, 'completed');
  const saved = await loadSupervisor(f.dataDir, workshopId);
  assert.deepEqual(saved.goalOrigin, { kind: 'agent', agentId: 'main', sessionId: 'session-main' });
  assert.equal(saved.humanIntentEstablished, false);
  assert.ok(saved.messages.some(message => message.supervisorGoalOrigin?.kind === 'agent'));
  assert.ok(!f.feature.supervisorToolNames().includes('start_collaboration_supervisor_chat'));
  const thread = await f.invoke<{ items: Array<{ content: string }>; revision: string }>('read_collaboration_thread', {
    workshopId, target: 'supervisor', targetId: 'supervisor',
  });
  assert.ok(thread.items.some(item => item.content.includes('框架 Agent 的委托')));
  assert.ok(thread.items.some(item => item.content.includes('资料已整理')));
  assert.ok(thread.items.some(item => item.content.includes('证据位于报告')));
  await eventually(async () => !(await f.feature.supervisor.status(workshopId)).busy);
  await f.feature.supervisor.reset(workshopId, 'clear');
  const cleared = await loadSupervisor(f.dataDir, workshopId);
  assert.equal(cleared.goalOrigin, undefined);
  assert.equal(hasEstablishedSupervisorGoal(cleared), false);
  await f.feature.supervisor.report(workshopId, seatId, '普通上报不能重建目标');
  assert.equal(hasEstablishedSupervisorGoal(await loadSupervisor(f.dataDir, workshopId)), false);
});

async function eventually(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Fixture did not reach expected durable state');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
