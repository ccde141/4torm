import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteSession, getSession, getSessionSnapshot, getSessionsByAgent,
  markSessionRead, saveSession, type ChatSession } from './chat.js';

const value: ChatSession = {
  id: 'session-a', agentId: 'agent-a', agentName: 'A', title: 'New', messages: [],
  model: 'model-a', systemPrompt: '', createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', revision: 1,
};

test('chat store uses the Monsoon session API instead of generic storage paths', async t => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = String(input);
    calls.push({ path, method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (path === '/api/conversation/sessions/agent-a') return Response.json([value]);
    if (path === '/api/conversation/sessions/agent-a/session-a' && init?.method === 'PUT') {
      return Response.json({ ...value, revision: 2 });
    }
    if (path === '/api/conversation/sessions/agent-a/session-a' && init?.method === 'DELETE') {
      return Response.json({ ok: true });
    }
    if (path === '/api/conversation/sessions/agent-a/session-a') return Response.json(value);
    return new Response('', { status: 404 });
  });

  assert.equal((await getSessionsByAgent('agent-a')).length, 1);
  assert.equal((await getSession('session-a', 'agent-a'))?.revision, 1);
  await saveSession(value);
  await deleteSession('session-a', 'agent-a');
  assert.equal(calls.some(call => call.path.startsWith('/api/storage/')), false);
  assert.equal((calls.find(call => call.method === 'PUT')?.body as {
    expectedRevision: number;
  }).expectedRevision, 1);
});

test('chat store exposes revision conflicts without retrying', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ error: '会话已被其他操作更新', current: { ...value, revision: 2 } },
      { status: 409 });
  });
  await assert.rejects(saveSession(value), /会话已被其他操作更新/);
  assert.equal(calls, 1);
});

test('an ask status snapshot does not regress the session write revision', async t => {
  const id = 'session-snapshot-a';
  const current = { ...value, id, revision: 2 };
  let reads = 0;
  let writtenRevision: number | undefined;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    if (init?.method === 'PUT') {
      writtenRevision = JSON.parse(String(init.body)).expectedRevision;
      return Response.json({ ...current, revision: 3 });
    }
    reads++;
    return Response.json({ ...current, revision: reads === 1 ? 2 : 1 });
  });
  await getSession(id, 'agent-a');
  assert.equal((await getSessionSnapshot(id, 'agent-a'))?.revision, 1);
  await saveSession(current);
  assert.equal(writtenRevision, 2);
});

test('a cached newer revision cannot authorize an older message payload', async t => {
  const stale = { ...value, id: 'session-stale-payload', revision: 3,
    messages: [{ id: 'old', role: 'user' as const, content: 'old', timestamp: value.createdAt }] };
  const newer = { ...stale, revision: 4, messages: [...stale.messages,
    { id: 'external', role: 'assistant' as const, content: 'append', timestamp: value.createdAt }] };
  let body: { expectedRevision: number; session: ChatSession } | undefined;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    if (init?.method === 'PUT') {
      body = JSON.parse(String(init.body));
      return Response.json({ error: '会话已被其他操作更新' }, { status: 409 });
    }
    return Response.json(newer);
  });

  await getSession(stale.id, stale.agentId);
  await assert.rejects(saveSession(stale), /会话已被其他操作更新/);
  assert.equal(body?.expectedRevision, 3);
  assert.deepEqual(body?.session.messages.map(message => message.id), ['old']);
});

test('marking a recovered conversation read sends metadata without saving the journal projection', async t => {
  const current = { ...value, id: 'session-read-only', messageRevision: 4,
    messages: [{ id: 'run-a', inputRunId: 'run-a', role: 'assistant' as const, content: '',
      timestamp: value.createdAt, runCommitted: false }] };
  let written: { mode: string; session: ChatSession } | undefined;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    if (init?.method === 'PUT') {
      written = JSON.parse(String(init.body));
      return Response.json({ ...current, revision: 2, lastReadAt: written?.session.lastReadAt });
    }
    return Response.json({ ...current, pendingRuns: [{ runId: 'run-a', truncated: false,
      events: [{ type: 'reasoning', content: 'recovered reasoning' }] }] });
  });
  await getSession(current.id, current.agentId);
  await markSessionRead(current.id);
  assert.equal(written?.mode, 'read');
  assert.deepEqual(written?.session.messages, []);
  assert.ok(written?.session.lastReadAt);
});
