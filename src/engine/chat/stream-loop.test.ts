import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import { runStreamLoop } from './streamLoop';

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

test('each usage event refreshes the session list before final message save', async () => {
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
