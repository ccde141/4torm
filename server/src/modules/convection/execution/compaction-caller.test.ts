import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../../engine/shared/compaction/index.js';
import { createSession, loadSession, saveSession, sessionWorkspace } from '../infrastructure/session-store.js';
import { handleSpeak } from './public-round.js';
import { handleChair } from './chair-round.js';
import { executeConvectionMemoryTool } from './convection-memory.js';
import { listMemory } from '../../../engine/shared/agent-memory.js';
const LLM_RESPONSE_WAIT_MS = 30 * 60_000;

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-compact-owner-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: 'Chair', model: 'p:chair', config: { compactionPrompt: '保留会议任务编号' } },
    member: { name: 'Member', model: 'p:member', config: { tools: [], toolMode: 'selected' } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://compact.test/v1', models: ['chair', 'member'], nativeMode: 'text' },
  ] }));
  const session = await createSession(dataDir, { chairAgentId: 'chair', participantAgentIds: ['member'], topic: '计划' });
  session.publicMessages = [
    { speaker: '人类', content: '旧背景', timestamp: -3 },
    { speaker: 'Member', content: '早期资料'.repeat(500), timestamp: -2 },
    { speaker: '人类', content: '旧约束', timestamp: -1 },
    { speaker: 'Member', content: '早期核验'.repeat(500), timestamp: 0 },
    { speaker: '人类', content: '第一轮'.repeat(1_000), timestamp: 1 },
    { speaker: 'Member', content: '已验证 task-1'.repeat(500), timestamp: 2 },
    { speaker: '人类', content: '第二轮'.repeat(500), timestamp: 3 },
    { speaker: 'Member', content: '待确认下一步', timestamp: 4 },
  ];
  session.tokenUsage = { promptTokens: 2_000, completionTokens: 10, totalTokens: 2_010 };
  await saveSession(dataDir, session);
  const policy = defaultCompactionPolicy(); policy.enabled = true; policy.thresholds.convection = 1_000;
  await saveCompactionPolicy(dataDir, policy);
  return { dataDir, session };
}

function isCompactionRequest(body: { messages: Array<{ role: string; content: string }> }): boolean {
  const last = body.messages.at(-1);
  return last?.role === 'user' && last.content.includes('你负责把已有会话整理');
}

function summarySse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}`
    + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

test('公共会议同一入口在下一轮压缩，先归档再调用会长模型，成员收到保留最近轮次的上下文', async t => {
  const { dataDir, session } = await fixture(t);
  session.publicMessages[1].toolCalls = [{ tool: 'read_file', args: { path: 'early-evidence.md' }, result: '早期已核实证据' }];
  await saveSession(dataDir, session);
  const originalHuman = structuredClone(session.publicMessages.filter(message => message.speaker === '人类'));
  const previous = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body.model);
    if (isCompactionRequest(body)) {
      assert.equal(body.model, 'chair');
      assert.match(JSON.stringify(body.messages), /保留会议任务编号/);
      assert.match(JSON.stringify(body.messages), /早期已核实证据/);
      assert.equal(JSON.stringify(body.messages).match(/early-evidence\.md/g)?.length, 1);
      assert.equal((await fs.readdir(path.join(sessionWorkspace(dataDir, session.id), 'bak'))).length, 1);
      return summarySse('task-1 已验证，继续确认计划。');
    }
    assert.match(JSON.stringify(body.messages), /历史压缩记录/);
    assert.match(JSON.stringify(body.messages), /继续工作/);
    const stream = 'data: {"choices":[{"delta":{"content":"<answer>新意见</answer>"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const events: string[] = [];
  await handleSpeak(dataDir, session, '继续工作', event => events.push(event.type));
  assert.deepEqual(calls, ['chair', 'member']);
  assert.ok(events.includes('compact-start')); assert.ok(events.includes('compact-done'));
  const saved = await loadSession(dataDir, session.id);
  assert.equal(saved?.publicMessages[0].speaker, '系统');
  assert.deepEqual(saved?.publicMessages.filter(message => message.speaker === '人类').slice(0, 2)
    .map(({ recordId: _id, ...record }) => record),
    originalHuman.slice(-2));
  assert.match(saved?.publicMessages.at(-1)?.content || '', /新意见/);
});

test('公共自动压缩持久化稀疏保留的近期人类议题，不恢复被归纳的长发言', async t => {
  const { dataDir, session } = await fixture(t);
  session.publicMessages = Array.from({ length: 3 }, (_, index) => [
    { speaker: '人类', content: `保留议题-${index}`, timestamp: index * 2 },
    { speaker: 'Member', content: `执行记录-${index}:${'原'.repeat(20_000)}`, timestamp: index * 2 + 1,
      toolCalls: [{ tool: 'read_file', args: {}, result: `工具证据-${index}` }] },
  ]).flat();
  session.tokenUsage = undefined;
  await saveSession(dataDir, session);
  let summaries = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (isCompactionRequest(body)) { summaries++; return summarySse('此前证据已核验，继续当前议题。'); }
    assert.match(JSON.stringify(body.messages), /保留议题-1/);
    assert.doesNotMatch(JSON.stringify(body.messages), /工具证据-1/);
    return summarySse('<answer>继续交付</answer>');
  });
  await handleSpeak(dataDir, session, '继续当前议题');
  assert.equal(summaries, 1);
  const saved = await loadSession(dataDir, session.id);
  assert.ok(saved?.publicMessages.some(record => record.content === '保留议题-1'));
  assert.ok(!saved?.publicMessages.some(record => record.toolCalls?.some(tool => tool.result === '工具证据-1')));
  assert.ok(saved?.publicMessages.some(record => record.toolCalls?.some(tool => tool.result === '工具证据-2')));
});

for (const failed of [false, true]) test(`compacted public tools stay archived after ${failed ? 'failure' : 'completion'}, reload and another participant`, async t => {
  const { dataDir, session } = await fixture(t);
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: 'Chair', model: 'p:chair' },
    member: { name: 'Member', model: 'p:member', config: { tools: [], toolMode: 'selected' } },
    observer: { name: 'Observer', model: 'p:observer', config: { tools: [], toolMode: 'selected' } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://compact.test/v1', models: ['chair', 'member', 'observer'], nativeMode: 'native' },
  ] }));
  session.participantAgentIds = ['member', 'observer'];
  session.publicMessages = [{ speaker: '人类', content: '核验资料', timestamp: 1 },
    { speaker: 'Member', content: `OLD_PUBLIC:${'旧'.repeat(20_000)}`, timestamp: 2 }];
  session.tokenUsage = undefined;
  await saveSession(dataDir, session);
  const policy = defaultCompactionPolicy();
  policy.enabled = true; policy.thresholds.convection = 60_000;
  await saveCompactionPolicy(dataDir, policy);
  for (const [summary, detail] of [['old-evidence', `OLD_TOOL:${'旧'.repeat(70_000)}`],
    ['recent-evidence', `RECENT_TOOL:${'近'.repeat(2_000)}`]]) {
    await executeConvectionMemoryTool(dataDir, 'member', 'memory_write', { summary, detail, category: 'fact', tags: 'audit' });
  }
  const entries = await listMemory(dataDir, 'member');
  let calls = 0, observations = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (isCompactionRequest(body)) return summarySse('早期资料已核验。');
    if (body.model === 'observer') {
      observations++;
      const context = JSON.stringify(body.messages);
      assert.doesNotMatch(context, /OLD_TOOL|OLD_PUBLIC|PRECOMPACT_TEXT/);
      assert.match(context, /RECENT_TOOL/);
      if (!failed) assert.equal(context.match(/FINAL-ONCE/g)?.length, 1);
      return summarySse('观察完成');
    }
    if (++calls <= 2) {
      if (calls === 2) {
        const draft = (await loadSession(dataDir, session.id))?.publicExecutionDraft;
        assert.equal(typeof draft?.modelContent, 'string');
        assert.doesNotMatch(draft!.modelContent!, /OLD_TOOL|PRECOMPACT_TEXT/);
      }
      const slug = entries.find(entry => entry.summary === (calls === 1 ? 'old-evidence' : 'recent-evidence'))!.slug;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: {
        content: calls === 1 ? 'PRECOMPACT_TEXT' : 'POSTCOMPACT_TEXT', tool_calls: [{ index: 0,
          id: `memory-${calls}`, type: 'function', function: { name: 'memory_read', arguments: JSON.stringify({ slug }) } }],
      }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return failed ? new Response('{"error":{"message":"fixture rejected"}}', { status: 400 }) : summarySse('FINAL-ONCE');
  });
  await handleSpeak(dataDir, session, '继续核验');
  const saved = await loadSession(dataDir, session.id);
  assert.ok(saved);
  const record = saved.publicMessages.find(message => message.speaker === 'Member');
  assert.match(record?.toolCalls?.[0].result ?? '', /OLD_TOOL/);
  assert.doesNotMatch(record?.modelContent ?? '', /OLD_TOOL|PRECOMPACT_TEXT/);
  assert.match(record?.modelContent ?? '', /RECENT_TOOL/);
  saved.participantAgentIds = ['observer'];
  await saveCompactionPolicy(dataDir, defaultCompactionPolicy());
  await handleSpeak(dataDir, saved, '下一轮复核');
  assert.equal(observations, 2);
});

for (const failed of [false, true]) test(`native public work preserves its internal compaction boundary on ${failed ? 'failure' : 'completion'}`, async t => {
  const { dataDir, session } = await fixture(t);
  session.publicMessages = [{ speaker: '人类', content: '请核验资料', timestamp: 1 },
    ...Array.from({ length: 20 }, (_, index) => ({ speaker: 'Member', content: `记录${index}${'原'.repeat(2_000)}`, timestamp: index + 2 }))];
  session.tokenUsage = undefined;
  await saveSession(dataDir, session);
  const policy = defaultCompactionPolicy();
  policy.enabled = true; policy.thresholds.convection = 100_000;
  await saveCompactionPolicy(dataDir, policy);
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://compact.test/v1', models: ['chair', 'member'], nativeMode: 'native' },
  ] }));
  await executeConvectionMemoryTool(dataDir, 'member', 'memory_write', {
    summary: 'verification evidence', detail: '已核实的详细证据'.repeat(10_000), category: 'fact', tags: 'audit',
  });
  const [entry] = await listMemory(dataDir, 'member');
  let memberCalls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (isCompactionRequest(body)) return summarySse('已核实证据，继续交付。');
    memberCalls++;
    if (memberCalls === 1) return new Response(`data: ${JSON.stringify({ choices: [{ delta: {
      content: '先查证据。', tool_calls: [{ index: 0, id: 'memory-call', type: 'function',
        function: { name: 'memory_read', arguments: JSON.stringify({ slug: entry.slug }) } }],
    }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } });
    const checkpoint = await loadSession(dataDir, session.id);
    assert.equal(checkpoint?.publicExecutionDraft?.toolCalls?.length, 1);
    assert.equal(checkpoint?.publicExecutionDraft?.content, '先查证据。');
    assert.ok(checkpoint?.publicExecutionDraft?.compactions?.some(item => item.toolOffset === 1));
    return failed ? new Response('{"error":{"message":"fixture rejected"}}', { status: 400 }) : summarySse('新的答复');
  };
  t.after(() => { globalThis.fetch = previous; });
  const events: import('./stream-events.js').ConvectionStreamEvent[] = [];
  await handleSpeak(dataDir, session, '请核验后交付', event => events.push(event));
  if (failed) {
    assert.equal(events.some(event => event.type === 'agent-done'), false);
    assert.equal(events.some(event => event.type === 'agent-failed'), true);
    const saved = await loadSession(dataDir, session.id);
    assert.equal(saved?.publicExecutionDraft, undefined);
    const partial = saved?.publicMessages.find(message => message.execution?.status === 'failed');
    assert.equal(partial?.content, '先查证据。');
    assert.equal(partial?.toolCalls?.length, 1);
    assert.equal(partial?.compactions?.find(item => item.toolOffset === 1)?.textOffset, '先查证据。'.length);
    assert.equal(saved?.publicMessages.filter(message => message.execution).length, 1);
    return;
  }
  const done = events.find(event => event.type === 'agent-done');
  assert.ok(done?.type === 'agent-done');
  const boundary = done.compactions?.find(item => item.toolOffset === 1);
  assert.ok(boundary, 'compaction must retain the tool position inside the same running participant');
  assert.equal(boundary.textOffset, '先查证据。'.length);
  assert.equal(done.toolCalls.length, 1);
  assert.match(done.displayContent ?? '', /先查证据。/);
  const saved = await loadSession(dataDir, session.id);
  assert.deepEqual(saved?.publicMessages.at(-1)?.compactions, done.compactions);
  assert.equal(saved?.publicExecutionDraft, undefined);
});

test('压缩模型失效保留旧会议与已接受输入，失败通知落盘而不伪装完成', async t => {
  const { dataDir, session } = await fixture(t);
  const original = structuredClone(session.publicMessages);
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":{"message":"offline"}}', { status: 503 });
  t.after(() => { globalThis.fetch = previous; });
  const failures: string[] = [];
  await handleSpeak(dataDir, session, '保留这个问题', event => {
    if (event.type === 'agent-failed') failures.push(event.message);
  });
  assert.equal(failures.length, 1);
  const saved = await loadSession(dataDir, session.id);
  assert.deepEqual(saved?.publicMessages.slice(0, original.length), original);
  assert.equal(saved?.publicMessages.at(-1)?.content, '保留这个问题');
  assert.match(saved?.compactionNotice?.message || '', /原始记录已保留/);
  assert.equal((await fs.readdir(path.join(sessionWorkspace(dataDir, session.id), 'bak'))).length, 1);
});

test('公共会议自动压缩被停止时原始历史仍在，进度不会停留在 running', async t => {
  const { dataDir, session } = await fixture(t);
  const original = structuredClone(session.publicMessages);
  const controller = new AbortController();
  const previous = globalThis.fetch;
  const events: import('./stream-events.js').ConvectionStreamEvent[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.ok(isCompactionRequest(JSON.parse(String(init?.body))));
    controller.abort();
    throw new DOMException('Stopped', 'AbortError');
  };
  t.after(() => { globalThis.fetch = previous; });
  await handleSpeak(dataDir, session, '保留当前问题', event => events.push(event), controller.signal);
  const saved = await loadSession(dataDir, session.id);
  assert.equal(calls, 1);
  assert.deepEqual(saved?.publicMessages.slice(0, original.length), original);
  assert.equal(saved?.publicMessages.at(-1)?.content, '保留当前问题');
  assert.equal(saved?.compactionProgress?.type, 'compact-failed');
  assert.equal(saved?.compactionProgress?.aborted, true);
  assert.ok(events.some(event => event.type === 'compact-start'));
  assert.ok(events.some(event => event.type === 'compact-failed' && event.aborted));
  assert.ok(!events.some(event => event.type === 'compact-done'));
});

test('助理压缩公共快照后保留两类原文，后续私聊只追加新记录且不重复历史', async t => {
  const { dataDir, session } = await fixture(t);
  session.chairMessages = [{ role: 'user', content: '先前私聊' }, { role: 'assistant', content: '私人判断' }];
  await saveSession(dataDir, session);
  const publicBefore = structuredClone(session.publicMessages);
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); calls++;
    assert.equal(body.model, 'chair');
    if (isCompactionRequest(body)) {
      assert.match(JSON.stringify(body.messages), /保留会议任务编号/);
      assert.match(JSON.stringify(body.messages), /旧背景/);
      const files = await fs.readdir(path.join(sessionWorkspace(dataDir, session.id), 'bak'));
      const archive = JSON.parse(await fs.readFile(path.join(sessionWorkspace(dataDir, session.id), 'bak', files[0]), 'utf8'));
      assert.deepEqual(archive.publicMessages, publicBefore);
      assert.equal(archive.chairMessages[0].content, '先前私聊');
      return summarySse('task-1 的公共讨论已验证；私人判断保留。');
    }
    assert.doesNotMatch(body.messages[0].content, /第一轮/);
    assert.match(JSON.stringify(body.messages), /历史压缩记录/);
    assert.equal(body.messages.filter((message: { content: string }) =>
      message.content === `[公共会议：人类] ${publicBefore[4].content}`).length, 1);
    assert.match(JSON.stringify(body.messages), /已验证 task-1/);
    if (calls === 3) {
      assert.equal(body.messages.filter((message: { content: string }) => message.content === '私人答复').length, 1);
      assert.equal(body.messages.filter((message: { content: string }) => message.content.includes('新增公共答复')).length, 1);
    }
    const stream = 'data: {"choices":[{"delta":{"content":"私人答复"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  await handleChair(dataDir, session, '帮我分析');
  assert.deepEqual(session.publicMessages, publicBefore);
  assert.deepEqual(session.chairMessages.slice(0, 2), [{ role: 'user', content: '先前私聊' }, { role: 'assistant', content: '私人判断' }]);
  const policy = defaultCompactionPolicy(); await saveCompactionPolicy(dataDir, policy);
  session.publicMessages.push({ speaker: 'Member', content: '新增公共答复', timestamp: 5 });
  await saveSession(dataDir, session);
  await handleChair(dataDir, session, '继续分析');
  assert.equal(calls, 3);
  const saved = await loadSession(dataDir, session.id);
  assert.equal(saved?.chairMessages.length, 6);
  assert.equal(saved?.publicMessages.at(-1)?.content, '新增公共答复');
});

test('两次助理私聊之间新增的公共记录计入下一次真实阈值比较', async t => {
  const { dataDir, session } = await fixture(t);
  session.publicMessages = [{ speaker: '人类', content: '简短目标', timestamp: 1 }];
  const policy = defaultCompactionPolicy(); await saveCompactionPolicy(dataDir, policy);
  await saveSession(dataDir, session);
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
  await handleChair(dataDir, session, '先分析');
  assert.equal(session.chairTokenUsage?.promptTokens, 500);
  for (let index = 0; index < 20; index++) session.publicMessages.push({
    speaker: 'Member', content: `新增公共证据${index}${'原'.repeat(2_000)}`, timestamp: index + 2,
  });
  await saveSession(dataDir, session);
  policy.enabled = true; policy.thresholds.convection = 1000; await saveCompactionPolicy(dataDir, policy);
  await handleChair(dataDir, session, '再分析');
  assert.ok(summaries >= 1);
  assert.equal((await fs.readdir(path.join(sessionWorkspace(dataDir, session.id), 'bak'))).length, 1);
});

test('助理压缩和业务推理都只使用模型无响应等待', async t => {
  const { dataDir, session } = await fixture(t);
  session.chairMessages = [{ role: 'user', content: '先前私聊'.repeat(300) }];
  await saveSession(dataDir, session);
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalFetch = globalThis.fetch;
  const inferenceTimers = new Set<ReturnType<typeof setTimeout>>();
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => {
    const timer = originalSetTimeout(callback, milliseconds, ...args);
    if (milliseconds === LLM_RESPONSE_WAIT_MS) inferenceTimers.add(timer);
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    inferenceTimers.delete(timer);
    return originalClearTimeout(timer);
  }) as typeof clearTimeout;
  let summaries = 0;
  let replies = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (isCompactionRequest(body)) {
      summaries++;
      assert.equal(inferenceTimers.size, 1);
      return summarySse('先前讨论与 task-1 已验证，继续分析。');
    }
    replies++;
    assert.equal(inferenceTimers.size, 1);
    return summarySse('正常答复');
  };
  try {
    await handleChair(dataDir, session, '继续分析');
    assert.ok(summaries > 0);
    assert.equal(replies, 1);
    assert.equal(inferenceTimers.size, 0);
    assert.equal(session.chairMessages.at(-1)?.content, '正常答复');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    for (const timer of inferenceTimers) originalClearTimeout(timer);
  }
});
