import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../shared/types.js';
import type { LoadedAgent } from '../shared/agent-loader.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../shared/compaction/index.js';
import { callPreparedModel } from '../shared/react/model-call.js';
import { createWorkshop } from './workshop-store.js';
import { addSeat, loadSeat, saveSeat, updateSeatRole } from './seat-store.js';
import { createRoom, loadRoom, saveRoom } from './room-store.js';
import { createSeatCompactionCaller } from './conversation-compaction-caller.js';
import { createRoomCompactionCaller, cycloneMeetingContext } from './meeting-compaction-caller.js';
import { createChairCompactionCaller } from './chair-compaction-caller.js';
import { chatChairWithinExecution } from './chair-runner.js';
import { speakInRoom } from './room-runner.js';
import { withSeatContinuity } from './seat-continuity.js';

const agent: LoadedAgent = { id: 'worker', name: 'Worker', model: 'p:worker', rolePrompt: '',
  tools: [], skills: [], toolMode: 'selected', temperature: 0.7, workspace: '.', sandboxLevel: 'project' };
const usage = { promptTokens: 2_000, completionTokens: 2, totalTokens: 2_002 };

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-compact-owner-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: 'Chair', model: 'p:chair', config: { compactionPrompt: '保留异步任务编号与不同意见' } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://compact.test/v1', models: ['worker', 'chair'], nativeMode: 'text' },
  ] }));
  const workshop = await createWorkshop(dataDir, { title: '讨论组', chairAgentId: 'chair' });
  const policy = defaultCompactionPolicy();
  policy.enabled = true;
  policy.thresholds.cycloneConversation = policy.thresholds.cycloneMeeting = 1_000;
  await saveCompactionPolicy(dataDir, policy);
  return { dataDir, workshop, policy };
}

function summarizeFetch(t: test.TestContext, check: (body: Record<string, unknown>) => void) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); check(body);
    assert.ok(isCompactionRequest(body));
    assert.equal(body.stream, true);
    return summarySse('保留任务编号 task-1，继续核验。');
  };
  t.after(() => { globalThis.fetch = previous; });
}

function isCompactionRequest(body: { messages: Array<{ role: string; content: string }> }): boolean {
  return body.messages.some(message => message.role === 'user'
    && message.content.startsWith('[归档资料 JSON]\n'));
}

function summarySse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}`
    + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

test('工位下一次模型调用才压缩，热提高阈值取消旧触发，热降低后归档并提交', async t => {
  const { dataDir, workshop, policy } = await fixture(t);
  const seat = await addSeat(dataDir, workshop.id, { agentId: agent.id, title: '开发' });
  seat.messages = [
    { role: 'user', content: '第一轮'.repeat(1_000) }, { role: 'assistant', content: '已完成任务 task-1'.repeat(500) },
    { role: 'user', content: '第二轮'.repeat(500) }, { role: 'assistant', content: '继续核验' },
    { role: 'user', content: '下一步' },
  ];
  seat.tokenUsage = usage; await saveSeat(dataDir, workshop.id, seat);
  const messages: ContextMessage[] = [{ role: 'system', content: '稳定工位规则' }, ...seat.messages];
  let summaries = 0; summarizeFetch(t, () => { summaries++; });
  let modelCalls = 0;
  const requestSystems: string[] = [];
  const caller = createSeatCompactionCaller({ dataDir, workshopId: workshop.id, seat, agent, messages,
    llm: { call: async request => { modelCalls++; requestSystems.push(request[0].content);
      return { content: '答复', finishReason: 'stop', usage }; } } });
  assert.equal(summaries, 0);
  policy.thresholds.cycloneConversation = 20_000; await saveCompactionPolicy(dataDir, policy);
  await callPreparedModel(caller, messages, undefined, {}); assert.equal(summaries, 0);
  policy.thresholds.cycloneConversation = 1_000; await saveCompactionPolicy(dataDir, policy);
  await callPreparedModel(caller, messages, undefined, {});
  assert.equal(summaries, 1); assert.equal(modelCalls, 2);
  assert.doesNotMatch(requestSystems[0], /## 接续工作/);
  assert.match(requestSystems[1], /本工位私聊上下文于/);
  assert.equal(seat.historySeen?.compactedAt, seat.compactState?.lastCompactAt);
  assert.doesNotMatch(messages[0].content, /## 接续工作/);
  assert.match(messages[1].content, /历史压缩记录/);
  assert.equal(messages.at(-1)?.content, '下一步');
  assert.deepEqual((await loadSeat(dataDir, workshop.id, seat.id))?.messages, messages.slice(1));
  assert.equal((await fs.readdir(path.join(dataDir, 'cyclone', workshop.id, 'bak'))).length, 1);
  policy.thresholds.cycloneConversation = 20_000; await saveCompactionPolicy(dataDir, policy);
  await callPreparedModel(caller, messages, undefined, {});
  assert.doesNotMatch(requestSystems[2], /## 接续工作/);
});

test('岗位提醒仅成功请求消费一次，保持原始消息和 native 工具配对', async t => {
  const { dataDir, workshop, policy } = await fixture(t);
  policy.enabled = false; await saveCompactionPolicy(dataDir, policy);
  const created = await addSeat(dataDir, workshop.id, { agentId: agent.id, title: '开发' });
  const seat = await updateSeatRole(dataDir, workshop.id, created.id,
    { agentId: 'replacement', duty: '当前职责正文', rolePrompt: '完整岗位提示词正文' }, 'human');
  assert.ok(seat);
  const messages: ContextMessage[] = [{ role: 'system', content: '当前岗位配置' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{}' }] },
    { role: 'tool', content: '读取结果', toolCallId: 'call-1' }];
  const original = structuredClone(messages);
  const systems: string[] = [];
  let fail = true;
  const caller = createSeatCompactionCaller({ dataDir, workshopId: workshop.id, seat, agent, messages,
    llm: { call: async request => {
      systems.push(request[0].content);
      assert.deepEqual(request.slice(1), original.slice(1));
      if (fail) throw new Error('request rejected');
      return { content: '完成', finishReason: 'stop' };
    } } });
  await assert.rejects(callPreparedModel(caller, messages, undefined, {}), /request rejected/);
  assert.equal(seat.historySeen, undefined);
  fail = false;
  await callPreparedModel(caller, messages, undefined, {});
  assert.match(systems[1], /岗位配置于.*更新：岗位提示词、职责、绑定 Agent/);
  assert.doesNotMatch(systems[1], /当前职责正文|完整岗位提示词正文/);
  assert.deepEqual(messages, original);
  const saved = await loadSeat(dataDir, workshop.id, seat.id); assert.ok(saved);
  assert.equal(saved.historySeen?.configurationId, seat.history?.at(-1)?.id);
  assert.deepEqual(saved.messages, original.slice(1));
  const resumed = createSeatCompactionCaller({ dataDir, workshopId: workshop.id, seat: saved, agent, messages,
    llm: { call: async request => {
      assert.doesNotMatch(request[0].content, /## 接续工作/);
      return { content: '继续', finishReason: 'stop' };
    } } });
  await callPreparedModel(resumed, messages, undefined, {});
});

test('压缩阶段被中止时不发送工作请求，也不消费岗位提醒或替换原始上下文', async t => {
  const { dataDir, workshop } = await fixture(t);
  const created = await addSeat(dataDir, workshop.id, { agentId: agent.id, title: '开发' });
  const seat = await updateSeatRole(dataDir, workshop.id, created.id, { duty: '新职责' }, 'human');
  assert.ok(seat);
  const messages: ContextMessage[] = [{ role: 'system', content: '岗位规则' },
    { role: 'user', content: '历史内容'.repeat(1500) }, { role: 'assistant', content: '旧回复'.repeat(500) },
    { role: 'user', content: '继续' }];
  const original = structuredClone(messages);
  const abort = new AbortController(); abort.abort();
  let modelCalls = 0; let summaryCalls = 0;
  summarizeFetch(t, () => { summaryCalls++; });
  const caller = createSeatCompactionCaller({ dataDir, workshopId: workshop.id, seat, agent, messages,
    llm: { call: async () => { modelCalls++; return { content: '不应执行', finishReason: 'stop' }; } } });
  await assert.rejects(callPreparedModel(caller, messages, abort.signal, {}), { name: 'AbortError' });
  assert.equal(modelCalls, 0); assert.equal(summaryCalls, 0);
  assert.equal(seat.historySeen, undefined);
  assert.deepEqual(messages, original);
  assert.equal((await loadSeat(dataDir, workshop.id, seat.id))?.historySeen, undefined);
});

test('中止或未包含 system 的联络请求不消费提醒，后续实际请求仍可接续', async t => {
  const { dataDir, workshop } = await fixture(t);
  const seat = await addSeat(dataDir, workshop.id, { agentId: agent.id, title: '接续' });
  seat.compactState = { disabled: false, archiveSeq: 1, lastCompactAt: '2026-10-01T00:00:00.000Z' };
  const abort = new AbortController();
  let abortRequest = true;
  const systems: string[] = [];
  const caller = withSeatContinuity({ call: async request => {
    systems.push(request[0].content);
    if (abortRequest) abort.abort();
    return { content: '已返回', finishReason: 'stop' };
  } }, seat, 'contact');
  const messages: ContextMessage[] = [{ role: 'system', content: '联络规则' }];
  await caller.call(messages, undefined, undefined, abort.signal);
  assert.equal(seat.historySeen, undefined);
  abortRequest = false;
  await caller.call([{ role: 'user', content: '没有系统规则' }]);
  assert.equal(seat.historySeen, undefined);
  await caller.call(messages);
  assert.match(systems[2], /本工位私聊上下文于/);
  assert.equal(seat.historySeen?.compactedAt, seat.compactState.lastCompactAt);
  await caller.call(messages);
  assert.doesNotMatch(systems[3], /## 接续工作/);
});

test('真实群聊接线只消费岗位变更，保留私聊整理提醒给后续私聊', async t => {
  const { dataDir, workshop, policy } = await fixture(t);
  policy.enabled = false; await saveCompactionPolicy(dataDir, policy);
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { name: 'Worker', model: 'p:worker', config: { toolMode: 'selected', tools: [] } },
  }));
  const created = await addSeat(dataDir, workshop.id, { agentId: agent.id, title: '开发' });
  const seat = await updateSeatRole(dataDir, workshop.id, created.id, { duty: '更新职责' }, 'human');
  assert.ok(seat);
  seat.messages = [{ role: 'user', content: 'private-content' }];
  seat.compactState = { disabled: false, archiveSeq: 1, lastCompactAt: '2026-10-01T00:00:00.000Z' };
  await saveSeat(dataDir, workshop.id, seat);
  const room = await createRoom(dataDir, workshop.id, { title: '公开', participantSeatIds: [seat.id] });
  const previous = globalThis.fetch; const systems: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    systems.push(body.messages[0].content);
    assert.doesNotMatch(JSON.stringify(body.messages), /private-content|本工位私聊上下文于/);
    return summarySse('<answer>公开简报</answer>');
  };
  t.after(() => { globalThis.fetch = previous; });
  await speakInRoom(dataDir, workshop.id, room, '同步进展', () => {});
  await speakInRoom(dataDir, workshop.id, room, '继续', () => {});
  assert.match(systems[0], /岗位配置于/);
  assert.doesNotMatch(systems[1], /## 接续工作/);
  const saved = await loadSeat(dataDir, workshop.id, seat.id); assert.ok(saved);
  assert.equal(saved.historySeen?.roomConfigurationId, seat.history?.at(-1)?.id);
  assert.equal(saved.historySeen?.configurationId, undefined);
  assert.equal(saved.historySeen?.compactedAt, undefined);
  assert.deepEqual(saved.messages, seat.messages);
  let privateCalls = 0;
  const privateCaller = withSeatContinuity({ call: async request => {
    if (privateCalls++ === 0) {
      assert.match(request[0].content, /本工位私聊上下文于/);
      assert.match(request[0].content, /岗位配置于/);
    } else assert.doesNotMatch(request[0].content, /## 接续工作/);
    return { content: '接续', finishReason: 'stop' };
  } }, saved, 'solo');
  const privateMessages: ContextMessage[] = [{ role: 'system', content: '私聊规则' }, ...saved.messages];
  await privateCaller.call(privateMessages);
  await privateCaller.call(privateMessages);
});

test('群聊压缩固定会长模型和压缩提示词，完整轮次留尾且派发版本保持', async t => {
  const { dataDir, workshop } = await fixture(t);
  const room = await createRoom(dataDir, workshop.id, { title: '评审' });
  room.publicMessages = [
    { speaker: '人类', content: '第一轮'.repeat(1_000), timestamp: 1 },
    { speaker: '研究员', content: '任务 task-1 已验证'.repeat(500), timestamp: 2 },
    { speaker: '人类', content: '第二轮'.repeat(500), timestamp: 3 },
    { speaker: '研究员', content: '有一个待确认点', timestamp: 4 },
    { speaker: '人类', content: '继续讨论', timestamp: 5 },
  ];
  room.tokenUsage = usage; room.dispatchContextVersion = 7;
  await saveRoom(dataDir, workshop.id, room);
  let summaries = 0;
  summarizeFetch(t, body => { summaries++; assert.equal(body.model, 'chair');
    assert.match(JSON.stringify(body.messages), /保留异步任务编号与不同意见/); });
  const messages: ContextMessage[] = [{ role: 'system', content: '会议规则' }, ...cycloneMeetingContext(room.publicMessages)];
  const caller = await createRoomCompactionCaller({ dataDir, workshopId: workshop.id, room, agent, messages,
    llm: { call: async () => ({ content: '新意见', finishReason: 'stop', usage }) } });
  await callPreparedModel(caller, messages, undefined, {});
  assert.equal(summaries, 1);
  assert.equal(room.publicMessages.at(-1)?.content, '继续讨论');
  assert.equal(room.publicMessages[0].speaker, '系统');
  assert.equal((await loadRoom(dataDir, workshop.id, room.id))?.dispatchContextVersion, 7);
});

test('会长真实请求能看到十二条前的公共发言和长发言后半段，不裁剪进静态身份', async t => {
  const { dataDir, workshop, policy } = await fixture(t);
  policy.enabled = false; await saveCompactionPolicy(dataDir, policy);
  const room = await createRoom(dataDir, workshop.id, { title: '完整观察' });
  room.publicMessages = Array.from({ length: 14 }, (_, index) => ({ speaker: index % 2 ? '工位' : '人类',
    content: index === 0 ? '最早的任务边界' : `${'连续发言'.repeat(100)}后半段证据-${index}`, timestamp: index }));
  await saveRoom(dataDir, workshop.id, room);
  const previous = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.doesNotMatch(body.messages[0].content, /最早的任务边界|后半段证据/);
    assert.match(JSON.stringify(body.messages), /最早的任务边界/);
    assert.match(JSON.stringify(body.messages), /后半段证据-13/);
    const stream = 'data: {"choices":[{"delta":{"content":"观察完整"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  await chatChairWithinExecution(dataDir, workshop.id, room.id, '帮我判断', () => {});
  const saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.deepEqual(saved?.publicMessages, room.publicMessages);
  assert.equal(saved?.chairMessages?.at(-1)?.content, '观察完整');
});

test('会长私聊压缩始终优先会长模型与其提示词，固定全局模型仅作备用', async t => {
  const { dataDir, workshop, policy } = await fixture(t);
  policy.modelMode = 'fixed'; policy.fixedModel = 'p:worker'; await saveCompactionPolicy(dataDir, policy);
  const room = await createRoom(dataDir, workshop.id, { title: '会长压缩' });
  room.chairMessages = [{ role: 'user', content: '旧问题'.repeat(1000) },
    { role: 'assistant', content: '旧答复'.repeat(500) }, { role: 'user', content: '继续分析' }];
  await saveRoom(dataDir, workshop.id, room);
  const messages: ContextMessage[] = [{ role: 'system', content: '静态身份' }, ...room.chairMessages];
  const summaryModels: unknown[] = [];
  summarizeFetch(t, body => {
    summaryModels.push(body.model);
    assert.match(JSON.stringify(body.messages), /会长压缩要求/);
  });
  const caller = createChairCompactionCaller({ dataDir, workshopId: workshop.id, room,
    agent: { ...agent, model: 'p:chair', compactionPrompt: '会长压缩要求' }, messages,
    initialPromptTokens: 2000, llm: { call: async () => ({ content: '答复', finishReason: 'stop' }) } });
  await callPreparedModel(caller, messages, undefined, {});
  assert.deepEqual(summaryModels, ['chair']);
  assert.match(messages[1].content, /历史压缩记录/);
});

test('公共会议继续增长后会长下一次私聊使用上次请求基线触发压缩', async t => {
  const { dataDir, workshop, policy } = await fixture(t);
  policy.enabled = false; await saveCompactionPolicy(dataDir, policy);
  const room = await createRoom(dataDir, workshop.id, { title: '增量观察' });
  room.publicMessages = [{ speaker: '人类', content: '简短目标', timestamp: 1 }];
  await saveRoom(dataDir, workshop.id, room);
  const previous = globalThis.fetch; let summaries = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (isCompactionRequest(body)) {
      summaries++;
      return summarySse('新增公共证据已核验。');
    }
    const stream = 'data: {"choices":[{"delta":{"content":"分析结果"},"finish_reason":"stop"}],"usage":{"prompt_tokens":500,"completion_tokens":4,"total_tokens":504}}\n\ndata: [DONE]\n\n';
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  await chatChairWithinExecution(dataDir, workshop.id, room.id, '先分析', () => {});
  const saved = await loadRoom(dataDir, workshop.id, room.id); assert.ok(saved);
  assert.equal(saved.chairTokenUsage?.promptTokens, 500);
  saved.publicMessages.push({ speaker: '人类', content: '新增需求'.repeat(1000), timestamp: 2 },
    { speaker: '工位', content: '新增证据'.repeat(1000), timestamp: 3 });
  await saveRoom(dataDir, workshop.id, saved);
  policy.enabled = true; await saveCompactionPolicy(dataDir, policy);
  await chatChairWithinExecution(dataDir, workshop.id, room.id, '再分析', () => {});
  assert.equal(summaries, 1);
});
