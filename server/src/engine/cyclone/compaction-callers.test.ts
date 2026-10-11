import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../shared/types.js';
import type { LoadedAgent } from '../shared/agent-loader.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../shared/compaction/index.js';
import { createWorkshop } from './workshop-store.js';
import { addSeat, loadSeat, saveSeat } from './seat-store.js';
import { createRoom, loadRoom, saveRoom } from './room-store.js';
import { createSeatCompactionCaller } from './conversation-compaction-caller.js';
import { createRoomCompactionCaller, cycloneMeetingContext } from './meeting-compaction-caller.js';
import { createChairCompactionCaller } from './chair-compaction-caller.js';
import { chatChairWithinExecution } from './chair-runner.js';

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
  const caller = createSeatCompactionCaller({ dataDir, workshopId: workshop.id, seat, agent, messages,
    llm: { call: async () => { modelCalls++; return { content: '答复', finishReason: 'stop', usage }; } } });
  assert.equal(summaries, 0);
  policy.thresholds.cycloneConversation = 20_000; await saveCompactionPolicy(dataDir, policy);
  await caller.call(messages); assert.equal(summaries, 0);
  policy.thresholds.cycloneConversation = 1_000; await saveCompactionPolicy(dataDir, policy);
  await caller.call(messages);
  assert.equal(summaries, 1); assert.equal(modelCalls, 2);
  assert.match(messages[1].content, /历史压缩记录/);
  assert.equal(messages.at(-1)?.content, '下一步');
  assert.deepEqual((await loadSeat(dataDir, workshop.id, seat.id))?.messages, messages.slice(1));
  assert.equal((await fs.readdir(path.join(dataDir, 'cyclone', workshop.id, 'bak'))).length, 1);
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
  await caller.call(messages);
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
  await caller.call(messages);
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
