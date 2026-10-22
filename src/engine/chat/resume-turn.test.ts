import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import { resumeMonsoonTurn, type ResumeTurnPorts } from './resume-turn';

const agent: Agent = {
  id: 'agent-a', name: '季风', role: '', status: 'idle', model: 'model-a', description: '',
  createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', tasksCompleted: 0,
};
const ask: ChatMessage = {
  id: 'ask-a', role: 'assistant', content: '继续？', timestamp: '2026-09-30T00:00:00.000Z',
  agentId: agent.id, ask: { question: '继续？', answered: false,
    sourceRunId: 'run-before-ask' },
};
const session: ChatSession = {
  id: 'session-a', agentId: agent.id, agentName: agent.name, title: '测试', messages: [ask],
  model: agent.model, systemPrompt: '', createdAt: ask.timestamp, updatedAt: ask.timestamp,
};

function sse(...events: object[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n`).join(''), {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  });
}

const accepted = { type: 'reply-accepted', waitingRunId: 'run-before-ask', answer: '继续' };

function harness(request: typeof fetch) {
  let current = [ask];
  let finalized: boolean | undefined;
  let replyAbort: (() => void) | undefined;
  const saved: ChatSession[] = [];
  let begins = 0;
  let rejected = '';
  let refreshes = 0;
  const ports: ResumeTurnPorts = {
    request,
    loadSession: async () => ({ ...session, messages: [...session.messages] }),
    begin: (abort, messages) => { begins++; replyAbort = abort; current = messages; },
    emit: messages => { current = messages; },
    bufferedMessages: () => current,
    isAbandoned: () => false,
    saveSession: async value => {
      saved.push(structuredClone(value));
      return { ...value, revision: (value.revision ?? 0) + 1 };
    },
    refreshSessions: () => { refreshes++; },
    applyTaskboard: () => undefined,
    generateMessageId: (() => { let index = 0; return () => `generated-${++index}`; })(),
    nameSession: async () => undefined,
    errorMessage: detail => `错误：${detail}`,
    saveFailureMessage: detail => `保存失败：${detail}`,
    persistenceError: () => undefined,
    rejected: detail => { rejected = detail; },
    finalize: completed => { finalized = completed; },
  };
  return { ports, current: () => current, saved, begins: () => begins,
    refreshes: () => refreshes,
    rejected: () => rejected, finalized: () => finalized, abort: () => replyAbort?.() };
}

test('resume turn marks the ask, streams one reply request and persists the answer', async () => {
  let replyCalls = 0;
  const h = harness(async (input, init) => {
    assert.equal(String(input), '/api/conversation/reply');
    assert.equal(JSON.parse(String(init?.body)).expectedWaitingRunId, 'run-before-ask');
    replyCalls++;
    return sse(accepted, { type: 'answer', content: '已继续', rawContent: '已继续' }, { type: 'done' });
  });

  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);

  assert.equal(replyCalls, 1);
  assert.equal(h.current()[0]?.ask?.answered, true);
  assert.equal(h.current()[0]?.ask?.reply, '继续');
  assert.equal(h.current().at(-1)?.content, '已继续');
  assert.equal(h.saved.at(-1)?.messages.at(-1)?.content, '已继续');
  assert.equal(h.saved.at(-1)?.messages.at(-1)?.runCommitted, true);
  assert.equal(h.finalized(), true);
});

test('resumed turn retains current context facts and defers usage refresh until completion', async () => {
  const h = harness(async () => sse(accepted,
    { type: 'usage', usage: { promptTokens: 20, completionTokens: 2, totalTokens: 22 } },
    { type: 'usage', usage: null },
    { type: 'answer', content: '已继续', rawContent: '已继续' }, { type: 'done' }));
  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);
  assert.equal(h.refreshes(), 2); // final save and the separate title update
  assert.equal(h.saved.at(-1)?.tokenUsage, undefined);
});

test('reply stays unconfirmed until the server accepts it', async () => {
  let accept!: (response: Response) => void;
  const h = harness(async () => new Promise<Response>(resolve => { accept = resolve; }));
  const pending = resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.current()[0]?.ask?.answered, false);
  assert.equal(h.saved.length, 0);
  accept(sse(accepted, { type: 'answer', content: '已继续' }, { type: 'done' }));
  await pending;
  assert.equal(h.current()[0]?.ask?.answered, true);
});

test('an explicitly rejected reply restores the unanswered card for correction', async () => {
  const h = harness(async () => new Response('会话未处于挂起状态', { status: 409 }));
  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);
  assert.equal(h.current()[0]?.ask?.answered, false);
  assert.equal(h.saved.length, 0);
  assert.match(h.rejected(), /会话未处于挂起状态/);
  assert.equal(h.finalized(), false);
});

test('a stale ask never writes over a newer session or sends a reply', async () => {
  let requests = 0;
  const h = harness(async () => { requests++; return sse(accepted, { type: 'done' }); });
  const newer = { ...ask, ask: { ...ask.ask!, answered: true, reply: '已回答' } };
  h.ports.loadSession = async () => ({ ...session, messages: [newer,
    { id: 'new-reply', role: 'assistant', content: '新回复', timestamp: 'now' }] });
  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);
  assert.equal(requests, 0);
  assert.equal(h.begins(), 0);
  assert.equal(h.saved.length, 0);
  assert.match(h.rejected(), /提问/);
});

test('a missing session ends the submitting state without writing or sending', async () => {
  const h = harness(async () => assert.fail('request must not run'));
  h.ports.loadSession = async () => null;
  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);
  assert.equal(h.saved.length, 0);
  assert.match(h.rejected(), /会话不存在/);
});

test('HTTP 200 without a durable acceptance event does not mark or save the ask as answered', async () => {
  const h = harness(async () => sse({ type: 'error', message: '运行状态未能落盘' }));
  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);
  assert.equal(h.current()[0]?.ask?.answered, false);
  assert.equal(h.saved.length, 0);
  assert.match(h.rejected(), /运行状态未能落盘/);
});

test('disconnect before done queries the run record without resending the reply', async () => {
  let replyCalls = 0;
  let probeCalls = 0;
  const h = harness(async input => {
    const url = String(input);
    if (url === '/api/conversation/reply') {
      replyCalls++;
      return sse(accepted, { type: 'token', content: '部分' });
    }
    probeCalls++;
    return new Response(JSON.stringify({
      operationId: session.id, runId: 'generated-1', title: session.title, status: 'completed',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);

  assert.equal(replyCalls, 1);
  assert.equal(probeCalls, 1);
  assert.match(h.current().at(-1)?.content ?? '', /执行已完成，但回复未完整送达/);
  assert.equal(h.saved.at(-1)?.messages.find(message => message.inputRunId === 'generated-1')?.runCommitted,
    false);
  assert.equal(h.finalized(), false);
});

test('an explicit stop keeps the partial turn without fabricating an error reply', async () => {
  const h = harness(async () => {
    h.abort();
    throw new Error('Failed to fetch');
  });

  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);

  assert.equal(h.current()[0]?.ask?.answered, false);
  assert.doesNotMatch(h.current().at(-1)?.content ?? '', /Failed to fetch/);
  assert.equal(h.saved.length, 0);
  assert.equal(h.finalized(), false);
});

test('a stop after a completed reply saves from the acknowledged revision', async () => {
  const h = harness(async () => sse(accepted, { type: 'answer', content: '已继续' }, { type: 'done' }));
  h.ports.loadSession = async () => ({ ...session, revision: 3 });
  const save = h.ports.saveSession;
  h.ports.saveSession = async value => {
    const saved = await save(value);
    if (h.saved.length === 1) h.abort();
    return saved;
  };
  await resumeMonsoonTurn({ sessionId: session.id, agent, model: agent.model,
    askMessageId: ask.id, waitingRunId: 'run-before-ask', answer: '继续' }, h.ports);

  assert.deepEqual(h.saved.map(value => value.revision), [3, 4]);
});
