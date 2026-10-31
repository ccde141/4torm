import assert from 'node:assert/strict';
import test from 'node:test';
import { getCachedMessages, getSession, getSessionSnapshot, getSessionsByAgent, type ChatSession } from './chat';

function session(id: string): ChatSession {
  return { id, agentId: 'agent-cache-owner', agentName: 'Fixture', title: 'Fixture',
    model: 'fixture:model', systemPrompt: '', revision: 1,
    messages: [{ id: 'message', role: 'assistant', content: `saved ${id}`, timestamp: 'now' }],
    createdAt: 'now', updatedAt: 'now' };
}

test('message eviction keeps the session owner and a cache miss reloads from the session API', async t => {
  const original = session('opaque-cache-identity');
  const reads: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = String(input);
    reads.push(url);
    const id = url.slice(url.lastIndexOf('/') + 1);
    return Response.json(id === original.id ? original : session(id));
  });
  await getSession(original.id, original.agentId);
  for (let index = 0; index < 8; index++) await getSession(`cache-extra-${index}`, original.agentId);
  assert.equal(getCachedMessages(original.id), undefined);
  assert.deepEqual((await getSession(original.id))?.messages, original.messages);
  assert.equal(reads.at(-1), `/api/conversation/sessions/${original.agentId}/${original.id}`);
});

test('metadata list refresh does not replace a loaded message snapshot with an empty list projection', async t => {
  const original = session('opaque-list-identity');
  t.mock.method(globalThis, 'fetch', async input => Response.json(
    String(input).endsWith(`/${original.agentId}`) ? [{ ...original, messages: [] }] : original));
  await getSession(original.id, original.agentId);
  await getSessionsByAgent(original.agentId);
  assert.deepEqual(getCachedMessages(original.id), original.messages);
});

test('a full empty session response clears previously cached content', async t => {
  const original = session('opaque-empty-identity');
  let empty = false;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...original,
    messages: empty ? [] : original.messages }));
  await getSession(original.id, original.agentId);
  empty = true;
  await getSession(original.id);
  assert.equal(getCachedMessages(original.id), undefined);
});

test('a fresh snapshot without pending runs does not clone the full parsed history', async t => {
  const original = session('opaque-fresh-snapshot');
  t.mock.method(globalThis, 'fetch', async () => Response.json(original));
  const clone = t.mock.method(globalThis, 'structuredClone');
  const saved = await getSessionSnapshot(original.id, original.agentId);
  assert.deepEqual(saved, original);
  assert.equal(clone.mock.callCount(), 0);
});
