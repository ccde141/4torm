import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { Agent } from '../../types';
import type { ChatSession } from '../../store/chat';
import { LocaleProvider } from '../../i18n/LocaleContext';
import { runStreamLoop } from '../../engine/chat/streamLoop';
import { useSessionList } from './useSessionList';
import {
  createSessionListRefresher, ensureSessionListRefresher, shouldApplySessionRefresh,
  projectSessionUsage,
} from './session-list-state';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('display usage stays known through reply and compaction, without changing the session facts', () => {
  const known = { promptTokens: 12000, completionTokens: 30, totalTokens: 12030 };
  const updated = { promptTokens: 500, completionTokens: 20, totalTokens: 520 };
  const base = { agentId: 'agent-a', id: 'session-a', tokenUsage: known };
  const initial = projectSessionUsage({}, [base], () => false);
  const active = projectSessionUsage(initial, [{ ...base, tokenUsage: updated }], () => true);
  assert.deepEqual(active['agent-a/session-a'], updated);
  const compacted = { ...base, tokenUsage: undefined };
  assert.deepEqual(projectSessionUsage(active, [compacted], () => false)['agent-a/session-a'], updated);
  assert.equal(compacted.tokenUsage, undefined);
  const completed = projectSessionUsage(active, [{ ...base, tokenUsage: updated }], () => false);
  assert.deepEqual(completed['agent-a/session-a'], updated);
  const otherAgent = projectSessionUsage(active, [{ ...base, agentId: 'agent-b', tokenUsage: undefined }], () => false);
  assert.equal(otherAgent['agent-b/session-a'], undefined);
  assert.deepEqual(projectSessionUsage({}, [base], () => true)['agent-a/session-a'], known);
  assert.equal(projectSessionUsage({}, [compacted], () => true)['agent-a/session-a'], undefined);
});

test('background agent refresh cannot replace the visible agent session list', () => {
  assert.equal(shouldApplySessionRefresh('agent-2', 'agent-1'), false);
  assert.equal(shouldApplySessionRefresh('agent-1', 'agent-1'), true);
  assert.equal(shouldApplySessionRefresh('agent-1', null), false);
});

test('background A usage cannot invalidate a pending visible B list request', async () => {
  const visible = 'agent-b';
  const pendingB = deferred<string[]>();
  const requested: string[] = [];
  const applied: string[][] = [];
  const refresh = createSessionListRefresher(async agentId => {
    requested.push(agentId);
    return pendingB.promise;
  }, () => visible, sessions => applied.push(sessions));

  const loadingB = refresh('agent-b');
  await refresh('agent-a');
  pendingB.resolve(['session-b']);
  await loadingB;
  assert.deepEqual(requested, ['agent-b']);
  assert.deepEqual(applied, [['session-b']]);
});

test('only the newest visible Agent request may apply after responses arrive out of order', async () => {
  const first = deferred<string[]>();
  const second = deferred<string[]>();
  let calls = 0;
  const applied: string[][] = [];
  const refresh = createSessionListRefresher(async () => (++calls === 1 ? first.promise : second.promise),
    () => 'agent-b', sessions => applied.push(sessions));
  const oldRequest = refresh('agent-b');
  const newRequest = refresh('agent-b');
  second.resolve(['new']);
  await newRequest;
  first.resolve(['old']);
  await oldRequest;
  assert.deepEqual(applied, [['new']]);
});

test('a stale numeric Hook ref is repaired before two real refresh calls', async () => {
  const ref = { current: 0 as unknown as ((agentId: string) => Promise<void>) | null };
  const requested: string[] = [];
  const applied: string[][] = [];
  const load = async (agentId: string) => { requested.push(agentId); return [agentId]; };
  for (let turn = 0; turn < 2; turn++) {
    await ensureSessionListRefresher(ref, load, () => 'agent-b', sessions => applied.push(sessions))('agent-b');
  }
  assert.deepEqual(requested, ['agent-b', 'agent-b']);
  assert.deepEqual(applied, [['agent-b'], ['agent-b']]);
});

test('the useSessionList refresh callback invokes the live list request path', async () => {
  const agent = { id: 'agent-b' } as Agent;
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  let refresh: ((agent: Agent) => Promise<void>) | undefined;
  globalThis.fetch = async input => {
    requested.push(String(input));
    return Response.json([]);
  };
  try {
    function Probe() {
      refresh = useSessionList(agent, '', [], () => {}, () => {}, () => {}, () => {}).refreshSessions;
      return null;
    }
    renderToString(createElement(LocaleProvider, null, createElement(Probe)));
    await refresh?.(agent);
    await refresh?.(agent);
    assert.equal(requested.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('selecting both a historical and a live session marks metadata without saving recovered output', async t => {
  for (const live of [false, true]) {
    const id = `agent-a-read-${live}`;
    const stored: ChatSession = { id, agentId: 'agent-a', agentName: 'A', title: 'History',
      model: 'model-a', systemPrompt: '', revision: 1, messageRevision: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [{ id: 'run-a', inputRunId: 'run-a', role: 'assistant', content: '',
        timestamp: '2026-01-01T00:00:00.000Z', runCommitted: false, reasoningContent: 'partial' }] };
    const written = deferred<{ mode: string; session: ChatSession }>();
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        written.resolve(body);
        return Response.json({ ...stored, lastReadAt: body.session.lastReadAt });
      }
      return Response.json({ ...stored, pendingRuns: [{ runId: 'run-a', truncated: false,
        events: [{ type: 'reasoning', content: 'complete reasoning' }] }] });
    });
    let select: ((id: string) => Promise<void>) | undefined;
    function Probe() {
      select = useSessionList({ id: 'agent-a' } as Agent, '', [], () => {}, () => {}, () => {}, () => {},
        { background: () => {}, reconnect: () => live, kill: () => {} }).selectSession;
      return null;
    }
    renderToString(createElement(LocaleProvider, null, createElement(Probe)));
    await select?.(id);
    const body = await written.promise;
    assert.equal(body.mode, 'read', live ? 'live branch' : 'historical branch');
    assert.deepEqual(body.session.messages, []);
    assert.ok(body.session.lastReadAt);
  }
});

test('a stream usage event refreshes the visible Hook list after HMR shifts its ref slots', async () => {
  const agent = { id: 'agent-a', name: 'A', model: 'model-a' } as Agent;
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  let refresh: ((agent: Agent) => Promise<void>) | undefined;
  let refSlot = 0;
  globalThis.fetch = async input => {
    requested.push(String(input));
    return Response.json([]);
  };
  try {
    function Probe() {
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const dispatcher = internals.H!;
      const originalUseRef = dispatcher.useRef;
      // Replay the two ref slots retained from the previous Fast Refresh version.
      dispatcher.useRef = (initial: unknown) => {
        const ref = originalUseRef(initial);
        if (++refSlot === 3) ref.current = 0;
        if (refSlot === 4) ref.current = 'agent-a';
        return ref;
      };
      try {
        refresh = useSessionList(agent, '', [], () => {}, () => {}, () => {}, () => {}).refreshSessions;
      } finally { dispatcher.useRef = originalUseRef; }
      return null;
    }
    renderToString(createElement(LocaleProvider, null, createElement(Probe)));
    assert.equal(refSlot, 7);
    const session = { id: 'session-a', agentId: agent.id, agentName: agent.name,
      title: '测试', model: agent.model, systemPrompt: '', messages: [],
      createdAt: 'now', updatedAt: 'now', revision: 1 } satisfies ChatSession;
    await runStreamLoop({ session, allMessages: [], chatMessages: [{ role: 'user', content: 'go' }],
      agent, selectedModel: agent.model, abortController: new AbortController(),
      request: async () => new Response('data: {"type":"usage","usage":{"promptTokens":9348,"completionTokens":1,"totalTokens":9349}}\n\ndata: {"type":"done"}\n\n'),
      setMessages: () => {}, saveSessionFn: async value => ({ ...value, revision: (value.revision ?? 0) + 1 }),
      refreshSessions: value => { void refresh?.(value); }, generateMessageIdFn: () => 'run-a' });
    assert.ok(requested.some(url => url.includes('/api/conversation/sessions/agent-a')));
  } finally { globalThis.fetch = originalFetch; }
});
