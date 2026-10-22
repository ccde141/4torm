import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { COLLABORATION_PERMISSIONS, type CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { resolveToolTransportContract } from '../../../model-runtime/config/tool-transport-contract.js';
import { enqueueSupervisorInformation, isSupervisorBusy, readSupervisorInbox, readPendingSupervisorInformation,
  mutateSupervisor } from '../../../engine/cyclone/supervisor-store.js';
import { createContactCommunication } from '../../../engine/cyclone/contact-communication-store.js';
import { createDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { dispatchFile, workshopDir } from '../../../engine/cyclone/paths.js';
import { reportToSupervisor, supervisorTools } from '../../../engine/cyclone/supervisor-tools.js';
import { loadWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { hasSupervisorReceiptEvidence } from '../../../engine/cyclone/supervisor-information.js';
import type { SupervisorMessage } from '../../../engine/cyclone/supervisor-store.js';
import { createCycloneFeature } from '../api/factory.js';

interface CapturedRequest { messages: Array<{ role: string; content: string; tool_call_id?: string }>; tools?: unknown[] }
function response(content: string, tool?: { name: string; args: Record<string, unknown> }, native = true): Response {
  const delta = tool ? native ? { tool_calls: [{ index: 0, id: 'call-ask', type: 'function',
    function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }
    : { content: JSON.stringify({ type: 'tool_call', name: tool.name, arguments: tool.args }) } : { content };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: tool && native ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } });
}
async function fixture(t: TestContext, native = true) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-supervisor-'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({ agent: {
    id: 'agent', name: '测试主管', model: 'test:model', config: { tools: [], toolMode: 'selected', skills: [] },
  } }));
  const provider = { id: 'test', baseUrl: 'https://example.test/v1', models: ['model'],
    providerType: 'openai-compatible' as const, transport: 'openai-chat-completions' as const };
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
    ...(!native ? { toolTransports: { model: { status: 'text-required', checkedAt: 'now',
      fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } } } : {}),
  }] }));
  const requests: CapturedRequest[] = [];
  let respond = (_request: CapturedRequest, _init?: RequestInit): Response | Promise<Response> => {
    throw new Error('Unexpected model request in supervisor fixture');
  };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as CapturedRequest;
    requests.push(request); return respond(request, init);
  });
  const feature = createCycloneFeature({ dataDir, summarizer: { summarize: async () => '项目摘要' } });
  const router = new CollaborationRouter([feature.module]);
  feature.connectSupervisorRouter(router);
  const workshop = await feature.workshops.create({ title: '本项目' });
  const context: CollaborationContext = { actor: { type: 'human', id: 'fixture' }, audience: 'human',
    enabledFeatures: new Set(['cyclone']), permissions: new Set(COLLABORATION_PERMISSIONS), requestId: 'fixture' };
  t.after(async () => {
    feature.dispose(); await feature.supervisor.shutdown();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { dataDir, feature, router, workshop, context, requests,
    respond: (next: typeof respond) => { respond = next; } };
}

test('主管单会话独立于工位与群聊，准备阶段互斥且 dispose 幂等释放锁', async t => {
  const f = await fixture(t);
  assert.equal((await f.feature.supervisor.status(f.workshop.id)).configured, false);
  await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '统筹验收' });
  const seat = await f.feature.workshops.addSeat({ workshopId: f.workshop.id, agentId: 'agent', title: '执行工位' });
  const before = await loadWorkshop(f.dataDir, f.workshop.id);
  assert.deepEqual(before?.seatIds, [seat.id]);
  assert.equal(before?.roomIds.length, 0);
  const prepared = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '制定计划' });
  assert.equal(prepared.execution.operationId, `supervisor:${f.workshop.id}:supervisor`);
  assert.equal(isSupervisorBusy(f.dataDir, f.workshop.id), true);
  await assert.rejects(f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '不应覆盖' }), /正在处理|正在执行/);
  await assert.rejects(f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '重复执行' }), /正在处理|正在执行/);
  await prepared.dispose(new Error('SSE setup failed'));
  await prepared.dispose(new Error('重复清理'));
  assert.equal(isSupervisorBusy(f.dataDir, f.workshop.id), false);
  assert.equal(f.feature.executions.list().length, 0);
  assert.equal((await f.feature.runs.history())[0].status, 'failed');
  await assert.rejects(prepared.run(), /已经开始或结束/);
  assert.equal(f.requests.length, 0);
  assert.deepEqual((await loadWorkshop(f.dataDir, f.workshop.id))?.seatIds, [seat.id]);
});

test('主管与工位本地工具拒绝调用方改填工作室或目标身份', async t => {
  const f = await fixture(t);
  const other = await f.feature.workshops.create({ title: '其他项目' });
  await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '' });
  const outcome = await supervisorTools(f.dataDir).call(f.workshop.id,
    'read_collaboration_group', { workshopId: other.id });
  assert.equal(outcome.ok, false);
  assert.match(outcome.result, /工作室由框架绑定|不支持参数/);
  const report = await reportToSupervisor(f.dataDir, f.workshop.id, 'seat-a', {
    workshopId: other.id, message: '不能改目标',
  });
  assert.equal(report.ok, false);
  await assert.rejects(f.router.invoke({ feature: 'cyclone', method: 'readSupervisor',
    input: { workshopId: f.workshop.id, targetId: other.id } }, f.context), /参数无效/);
  assert.equal((await f.feature.supervisor.status(other.id)).configured, false);
  assert.equal(f.requests.length, 0);
});

for (const native of [true, false]) {
  test(`主管 ${native ? 'native' : 'text'} Ask 挂起后沿同一会话接续并保留最终正文`, async t => {
    const f = await fixture(t, native);
    await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '' });
    f.respond(() => f.requests.length === 1
      ? response('', { name: 'ask', args: { question: '选哪种方案？', options: ['方案A', '方案B'] } }, native)
      : response('已按方案A完成。'));
    const first = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '需要确认方案' });
    const events: Array<{ type: string }> = [];
    await first.run(event => events.push(event as never));
    const pending = await f.feature.supervisor.status(f.workshop.id);
    assert.equal(pending.pending?.question, '选哪种方案？');
    assert.equal(events.filter(event => event.type === 'ask').length, 1);
    assert.equal(f.requests.length, 1);
    const second = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'resume', text: '方案A' });
    await second.run();
    assert.equal(f.requests.length, 2);
    if (native) assert.ok(f.requests[1].messages.some(message => message.role === 'tool'
      && message.tool_call_id === 'call-ask' && message.content === '方案A'));
    else assert.ok(f.requests[1].messages.some(message => message.content.includes('方案A')));
    const saved = await f.feature.supervisor.status(f.workshop.id);
    assert.equal(saved.pending, undefined);
    assert.equal(saved.messages.filter(message => message.role === 'assistant' && message.content === '已按方案A完成。').length, 1);
    assert.equal(f.feature.executions.list().length, 0);
  });
}

test('工位来信保留来源而非人类目标，重复派发回报仅进同一收件箱一次', async t => {
  const f = await fixture(t);
  await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '' });
  const seat = await f.feature.workshops.addSeat({ workshopId: f.workshop.id, agentId: 'agent', title: '资料员' });
  const prepared = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '人类目标：检查证据' });
  const result = await f.feature.supervisor.report(f.workshop.id, seat.id, '资料信息，不是新的人类任务');
  assert.equal(JSON.parse(result.result).status, 'received');
  const item = { id: 'dispatch-fixture', workshopId: f.workshop.id, sourceKind: 'supervisor',
    status: 'completed', targetSeatTitle: seat.title, response: '核验完成' } as Parameters<typeof f.feature.supervisor.receiveDispatch>[0];
  await f.feature.supervisor.receiveDispatch(item);
  await f.feature.supervisor.receiveDispatch(item);
  const duplicate = { id: 'fixed-information', sourceKind: 'seat' as const, sourceId: seat.id,
    sourceTitle: seat.title, content: '幂等消息' };
  await enqueueSupervisorInformation(f.dataDir, f.workshop.id, duplicate);
  await enqueueSupervisorInformation(f.dataDir, f.workshop.id, duplicate);
  f.respond(() => response('已依人类目标核对。'));
  await prepared.run();
  const status = await f.feature.supervisor.status(f.workshop.id);
  const incoming = status.messages.filter(message => message.supervisorInboxId);
  assert.equal(incoming.length, 3);
  assert.equal(incoming.filter(message => message.supervisorInboxId === 'fixed-information').length, 1);
  assert.ok(incoming.every(message => message.content.startsWith('[协作信息：')));
  assert.equal(status.messages.filter(message => message.content === '人类目标：检查证据').length, 1);
  assert.ok((await readSupervisorInbox(f.dataDir, f.workshop.id)).every(message => message.consumedAt));
  const next = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '继续核对' });
  await next.run();
  assert.equal((await f.feature.supervisor.status(f.workshop.id)).messages.filter(message => message.supervisorInboxId).length, 3);
});

test('主管模型拒绝只发一次终态错误，记录 failed 而不假成功', async t => {
  const f = await fixture(t);
  await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '' });
  f.respond(() => new Response(JSON.stringify({ error: { message: 'fixture provider rejected' } }), { status: 400 }));
  const prepared = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '执行检查' });
  const events: Array<{ type: string }> = [];
  await assert.rejects(prepared.run(event => events.push(event as never)), /fixture provider rejected/);
  assert.equal(events.filter(event => event.type === 'error').length, 1);
  assert.ok(!events.some(event => event.type === 'answer' || event.type === 'done'));
  assert.equal((await f.feature.runs.history())[0].status, 'failed');
  assert.equal(f.requests.length, 1);
  assert.equal(f.feature.executions.list().length, 0);
});

test('主管提交前中止会取消原子替换，原会话与重置水位均保持不变', async t => {
  const f = await fixture(t);
  await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '' });
  await mutateSupervisor(f.dataDir, f.workshop.id, current => {
    current.messages.push({ role: 'user', content: '必须保留的会话' });
  });
  const primary = path.join(workshopDir(f.dataDir, f.workshop.id), 'supervisor.json');
  const original = await fs.readFile(primary, 'utf8');
  const controller = new AbortController();
  const writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (...args) => {
    await writeFile(...args);
    if (String(args[0]).startsWith(`${primary}.`) && String(args[0]).endsWith('.tmp')) controller.abort();
  });
  await assert.rejects(mutateSupervisor(f.dataDir, f.workshop.id, current => {
    current.messages = []; current.clearedInformationIds = ['must-not-commit'];
  }, controller.signal), /abort/i);
  assert.equal(await fs.readFile(primary, 'utf8'), original);
  assert.equal(f.requests.length, 0);
});

test('主管从终态事实修复丢失回执且不重跑模型，清屏后的旧回执不会再注入', async t => {
  const f = await fixture(t);
  await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '' });
  const dispatch = await createDispatch(f.dataDir, { workshopId: f.workshop.id, sourceKind: 'supervisor',
    sourceRoomId: '', sourceSeatId: 'supervisor', sourceSeatTitle: '工作室主管', sourceTurnId: 'turn-recovery',
    sourceRoundSeq: 0, dispatchOrder: 0, targetSeatId: 'seat-receiver', targetSeatTitle: '核验', task: '原任务' });
  const contact = await createContactCommunication(f.dataDir, { workshopId: f.workshop.id,
    sourceId: 'supervisor', sourceKind: 'supervisor', sourceTitle: '工作室主管', targetId: 'seat-receiver',
    targetKind: 'seat', targetTitle: '核验', admissionDeadlineAt: new Date().toISOString() });
  const now = new Date().toISOString();
  const finishedDispatch = { ...dispatch, status: 'completed' as const, delivered: true,
    acceptedAt: now, completedAt: now, updatedAt: now, response: 'receipt-should-stay-cleared-dispatch' };
  const finishedContact = { ...contact, status: 'completed' as const, delivered: true,
    acceptedAt: now, updatedAt: now, response: 'receipt-should-stay-cleared-contact' };
  // Equivalent interruption: terminal facts are durable, but their notification was never committed.
  await fs.writeFile(dispatchFile(f.dataDir, f.workshop.id, dispatch.id), JSON.stringify(finishedDispatch));
  await fs.writeFile(path.join(workshopDir(f.dataDir, f.workshop.id), 'contacts', `${contact.id}.json`), JSON.stringify(finishedContact));
  let blocked = true;
  const inboxFile = path.join(workshopDir(f.dataDir, f.workshop.id), 'supervisor-inbox.json');
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (blocked && String(to) === inboxFile) throw Object.assign(new Error('fixture inbox IO failed'), { code: 'EIO' });
    return rename(from, to);
  });
  await assert.rejects(f.feature.supervisor.receiveContact(finishedContact), /fixture inbox/);
  blocked = false;
  const prepared = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '核对已有回执' });
  assert.equal(f.requests.length, 0, '补齐事实不执行模型');
  assert.equal((await readSupervisorInbox(f.dataDir, f.workshop.id)).length, 2);
  await prepared.dispose();
  await f.feature.supervisor.reconcileCommunicationReceipts(f.workshop.id);
  assert.equal((await readSupervisorInbox(f.dataDir, f.workshop.id)).length, 2, '同一终态回执幂等补齐');
  await f.feature.supervisor.reset(f.workshop.id, 'clear');
  await f.feature.supervisor.reconcileCommunicationReceipts(f.workshop.id);
  assert.deepEqual(await readPendingSupervisorInformation(f.dataDir, f.workshop.id), []);
  await enqueueSupervisorInformation(f.dataDir, f.workshop.id, { id: 'new-after-clear', sourceKind: 'seat',
    sourceId: 'seat-receiver', sourceTitle: '核验', content: '清屏之后的新信息' });
  f.respond(() => response('已按新目标处理新信息。'));
  const next = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '新的目标' });
  await next.run();
  assert.equal(f.requests.length, 1);
  assert.ok(f.requests[0].messages.some(message => message.content.includes('清屏之后的新信息')));
  assert.ok(f.requests[0].messages.every(message => !message.content.includes('receipt-should-stay-cleared')));
});

test('主管显式停止保留人类输入并暂停自动跟进，不重放模型请求', async t => {
  const f = await fixture(t);
  await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '' });
  let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  f.respond((_request, init) => new Promise<Response>((_resolve, reject) => {
    started();
    init?.signal?.addEventListener('abort', () => reject(new Error('fixture aborted')), { once: true });
  }));
  const prepared = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '需要保留的目标' });
  const run = prepared.run();
  await requested;
  await f.router.invoke({ feature: 'cyclone', method: 'abortExecution', input: {
    operationId: prepared.execution.operationId, runId: prepared.execution.runId,
  } }, f.context);
  await run;
  const saved = await f.feature.supervisor.status(f.workshop.id);
  assert.equal(saved.followUpPaused, true);
  assert.ok(saved.messages.some(message => message.content === '需要保留的目标'));
  assert.equal((await f.feature.runs.history())[0].status, 'aborted');
  assert.equal(f.requests.length, 1);
  assert.equal(f.feature.executions.list().length, 0);
  await assert.rejects(f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'information', text: '' }), /没有可自动接续/);
  assert.equal(f.requests.length, 1);
});

test('主管只用成功且完整的已读工具事实去重回执，原生和文本模式一致', () => {
  const body = JSON.stringify({ items: [{ id: 'dispatch-a', status: 'completed', response: '13', responseChars: 2 }] });
  const receipt = { id: 'receipt-a', sourceKind: 'dispatch' as const, sourceId: 'dispatch-a',
    sourceTitle: '核验员', createdAt: 'now', content: JSON.stringify({ status: 'completed', response: '13' }) };
  const call = { id: 'call-a', name: 'list_collaboration_dispatches', arguments: '{}' };
  const native: SupervisorMessage[] = [{ role: 'assistant', content: '', toolCalls: [call] },
    { role: 'tool', toolCallId: call.id, toolOk: true, content: body }];
  const text: SupervisorMessage[] = [{ role: 'assistant', content: JSON.stringify({ type: 'tool_call', name: call.name, arguments: {} }) },
    { role: 'user', content: JSON.stringify({ type: 'tool_result', name: call.name, ok: true, content: body }) }];
  assert.equal(hasSupervisorReceiptEvidence(native, receipt), true);
  assert.equal(hasSupervisorReceiptEvidence(text, receipt), true);
  assert.equal(hasSupervisorReceiptEvidence([{ role: 'user', content: body }], receipt), false);
  assert.equal(hasSupervisorReceiptEvidence(native.map(message => ({ ...message, toolOk: false })), receipt), false);
  assert.equal(hasSupervisorReceiptEvidence(native, { ...receipt, content: JSON.stringify({ status: 'completed', response: '130' }) }), false);
});

for (const native of [true, false]) test(`主管 ${native ? 'native' : 'text'} 接续来信保留来源并标记内部续接提示`, async t => {
  const f = await fixture(t, native);
  await f.feature.supervisor.configure(f.workshop.id, { agentId: 'agent', rolePrompt: '' });
  const seat = await f.feature.workshops.addSeat({ workshopId: f.workshop.id, agentId: 'agent', title: '资料员' });
  f.respond(async () => {
    if (f.requests.length === 1) await f.feature.supervisor.report(f.workshop.id, seat.id, '已核验');
    return response('已核对来信。');
  });
  const prepared = await f.feature.supervisor.prepare({ workshopId: f.workshop.id, mode: 'chat', text: '核对来信' });
  await prepared.run();
  const saved = await f.feature.supervisor.status(f.workshop.id);
  assert.equal(f.requests.length, 2);
  assert.equal(saved.messages.filter(message => message.supervisorInboxId).length, 1);
  assert.equal(saved.messages.find(message => message.supervisorInboxId)?.supervisorSourceTitle, '资料员');
  assert.equal(saved.messages.filter(message => message.supervisorInternal).length, 1);
  assert.ok(saved.messages.some(message => message.role === 'user' && message.content === '核对来信' && !message.supervisorInternal));
});
