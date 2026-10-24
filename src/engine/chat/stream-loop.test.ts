import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import { runStreamLoop } from './streamLoop';
import { hasNewCompactionCheckpoint, requestMonsoonCompaction } from './manual-compaction';

const agent = {
  id: 'agent-a', name: '季风', role: '', status: 'idle', model: 'model-a', description: '',
  createdAt: 'now', updatedAt: 'now', tasksCompleted: 0,
} satisfies Agent;
const userMessage = {
  id: 'user-a', role: 'user', content: '开始', timestamp: 'now', agentId: agent.id,
} satisfies ChatMessage;
const session = {
  id: 'session-a', agentId: agent.id, agentName: agent.name, title: '测试', messages: [userMessage],
  model: agent.model, systemPrompt: '', createdAt: 'now', updatedAt: 'now',
} satisfies ChatSession;

test('manual compaction consumes lifecycle facts without publishing summary chunks as conversation messages', async () => {
  const progress: string[] = [];
  const notice = await requestMonsoonCompaction(session, agent.model, new AbortController().signal, {
    request: async () => new Response([
      { type: 'start', compressedCount: 4 },
      { type: 'compact-start', id: 'compact-a', startedAt: 1, updatedAt: 1 },
      { type: 'token', content: '未提交摘要' },
      { type: 'compaction-notice', message: '已切换备用模型' },
      { type: 'compact-done', id: 'compact-a', startedAt: 1, updatedAt: 2 },
      { type: 'done', markerId: 'marker-a' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')),
    onProgress: event => progress.push(event.type),
  });
  assert.equal(notice, '已切换备用模型');
  assert.deepEqual(progress, ['compact-start', 'compact-done']);
  assert.equal(hasNewCompactionCheckpoint(session, session), false);
  const committed = { ...session, messages: [...session.messages,
    { ...userMessage, id: 'marker-a', role: 'system' as const, type: 'compact-marker' }] };
  assert.equal(hasNewCompactionCheckpoint(session, committed), true);
  assert.equal(hasNewCompactionCheckpoint(session, { ...committed, agentId: 'other' }), false);
});

test('a manual compaction stream without done never reports success', async () => {
  await assert.rejects(requestMonsoonCompaction(session, agent.model, new AbortController().signal, {
    request: async () => new Response('data: {"type":"token","content":"partial"}\n\n'),
    onProgress: () => {},
  }), /确认结果前中断/);
});

test('automatic compaction checkpoint revision reaches the final reply save', async () => {
  const writes: ChatSession[] = [];
  const marker = { id: 'compact-a', role: 'system', content: '摘要', timestamp: 'now',
    type: 'compact-marker', contextExact: true, nativeContext: [{ role: 'system', content: '摘要' }] };
  const request: typeof fetch = async () => new Response([
    { type: 'context-compacted', revision: 9, marker },
    { type: 'token', content: '回复' }, { type: 'done' },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  await runStreamLoop({ session: { ...session, revision: 7 }, allMessages: [userMessage],
    chatMessages: [{ role: 'user', content: '开始' }], agent, selectedModel: agent.model,
    abortController: new AbortController(), request, setMessages: () => undefined,
    saveSessionFn: async value => { writes.push(structuredClone(value));
      return { ...value, revision: (value.revision ?? 0) + 1 }; },
    refreshSessions: () => undefined, generateMessageIdFn: () => 'run-a',
  });
  assert.deepEqual(writes.map(write => write.revision), [7, 9]);
  assert.deepEqual(writes[1]?.messages.map(message => message.id), ['user-a', 'compact-a', 'run-a']);
});

test('a failed initial save neither starts nor probes a model run', async () => {
  let requests = 0;
  let saves = 0;
  let completed: boolean | undefined;
  const rendered: ChatMessage[][] = [];
  const request = async () => { requests++; throw new Error('request must not run'); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = request;
  try {
    await runStreamLoop({
      session, allMessages: [userMessage], chatMessages: [{ role: 'user', content: '开始' }],
      agent, selectedModel: agent.model, abortController: new AbortController(), request,
      setMessages: messages => rendered.push(messages),
      saveSessionFn: async value => { if (++saves === 1) throw new Error('disk full'); return value; },
      refreshSessions: () => undefined,
      generateMessageIdFn: () => 'run-a',
      onFinish: value => { completed = value; },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests, 0);
  assert.equal(saves, 1);
  assert.equal(completed, false);
  assert.match(rendered.at(-1)?.at(-1)?.content ?? '', /disk full/);
});

test('final stream save uses the revision returned by its own initial save', async () => {
  const writes: ChatSession[] = [];
  const request: typeof fetch = async () => new Response('data: {"type":"done"}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } });
  await runStreamLoop({
    session: { ...session, revision: 7 }, allMessages: [userMessage],
    chatMessages: [{ role: 'user', content: '开始' }], agent, selectedModel: agent.model,
    abortController: new AbortController(), request, setMessages: () => undefined,
    saveSessionFn: async value => {
      writes.push(structuredClone(value));
      return { ...value, revision: (value.revision ?? 0) + 1 };
    },
    refreshSessions: () => undefined, generateMessageIdFn: () => 'run-a',
  });

  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(write => write.revision), [7, 8]);
  assert.deepEqual(writes[1]?.messages.map(message => message.id), ['user-a', 'run-a']);
  assert.equal(writes[0]?.messages.at(-1)?.runCommitted, false);
  assert.equal(writes[1]?.messages.at(-1)?.runCommitted, true);
});

test('a disconnected stream keeps its journal recoverable after saving visible partial output', async () => {
  const writes: ChatSession[] = [];
  const request: typeof fetch = async (_input, init) => init?.body
    && JSON.parse(String(init.body)).sessionId
    ? new Response('data: {"type":"token","content":"partial"}\n\n')
    : new Response('', { status: 404 });
  await runStreamLoop({
    session: { ...session, revision: 2 }, allMessages: [userMessage],
    chatMessages: [{ role: 'user', content: '开始' }], agent, selectedModel: agent.model,
    abortController: new AbortController(), request, setMessages: () => undefined,
    saveSessionFn: async value => {
      writes.push(structuredClone(value));
      return { ...value, revision: (value.revision ?? 0) + 1 };
    },
    refreshSessions: () => undefined, generateMessageIdFn: () => 'run-a',
  });
  assert.equal(writes.length, 2);
  assert.equal(writes[1]?.messages.at(-1)?.runCommitted, false);
});

test('intermediate usage refreshes immediately while missing reports remain unknown facts', async () => {
  const order: string[] = [];
  const request: typeof fetch = async () => new Response([
    { type: 'usage', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } },
    { type: 'usage', usage: null },
    { type: 'done' },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
  { headers: { 'Content-Type': 'text/event-stream' } });
  let saves = 0;
  await runStreamLoop({
    session: { ...session, tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    allMessages: [userMessage], chatMessages: [{ role: 'user', content: '开始' }],
    agent, selectedModel: agent.model, abortController: new AbortController(), request,
    setMessages: () => undefined,
    saveSessionFn: async value => {
      order.push(`save:${++saves}:${value.tokenUsage?.totalTokens ?? 'unknown'}`);
      return { ...value, revision: saves };
    },
    refreshSessions: () => { order.push('refresh'); },
    generateMessageIdFn: () => 'run-a',
  });
  assert.deepEqual(order, ['save:1:2', 'refresh', 'refresh', 'save:2:unknown', 'refresh']);
});
