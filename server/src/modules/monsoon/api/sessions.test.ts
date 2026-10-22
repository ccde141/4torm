import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerMonsoonSessions } from './sessions.js';
import { createMonsoonFeature } from './factory.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { installFrameworkErrorHandler } from '../../../routes/error-handler.js';

function session() {
  return {
    id: 'session-a', agentId: 'agent-a', agentName: 'A', title: 'New', messages: [],
    model: 'model-a', systemPrompt: '', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', revision: 0,
  };
}

test('session API creates, lists, updates and rejects stale writes', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-session-api-'));
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const feature = createMonsoonFeature({ dataDir });
  const journal = feature.journal;
  registerMonsoonSessions(app, new CollaborationRouter([feature.module]));
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const created = await app.inject({ method: 'POST', url: '/sessions', payload: session() });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().revision, 1);
  const listed = await app.inject('/sessions/agent-a');
  assert.equal(listed.json()[0].messages.length, 0);

  const saved = await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload: {
    expectedRevision: 1, mode: 'content', session: { ...created.json(), messages: [{
      id: 'message-a', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:01.000Z',
    }] },
  } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().revision, 2);

  const stale = await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload: {
    expectedRevision: 1, mode: 'content', session: saved.json(),
  } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().current.revision, 2);

  const writer = await journal.begin('agent-a', 'session-a', 'run-a', saved.json().messageRevision);
  await writer.append({ type: 'token', content: 'recoverable' });
  const recoverable = await app.inject('/sessions/agent-a/session-a');
  assert.equal(recoverable.json().pendingRuns[0].events[0].content, 'recoverable');
  const unrelated = await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload: {
    expectedRevision: 2, mode: 'content', session: saved.json(),
  } });
  assert.equal(unrelated.statusCode, 200);
  assert.equal((await app.inject('/sessions/agent-a/session-a')).json().pendingRuns[0].runId, 'run-a');
  const absorbed = await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload: {
    expectedRevision: 3, mode: 'content', session: { ...unrelated.json(), messages: [
      ...unrelated.json().messages, { id: 'run-a', role: 'assistant', content: 'recoverable',
        timestamp: '2026-01-01T00:00:02.000Z', runCommitted: true },
    ] },
  } });
  assert.equal(absorbed.statusCode, 200);
  assert.deepEqual((await app.inject('/sessions/agent-a/session-a')).json().pendingRuns, []);
});

test('session API deletion is idempotent at the HTTP boundary', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-session-api-'));
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const feature = createMonsoonFeature({ dataDir });
  registerMonsoonSessions(app, new CollaborationRouter([feature.module]));
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  await app.inject({ method: 'POST', url: '/sessions', payload: session() });

  assert.equal((await app.inject({ method: 'DELETE', url: '/sessions/agent-a/session-a' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: '/sessions/agent-a/session-a' })).statusCode, 200);
  assert.equal((await app.inject('/sessions/agent-a/session-a')).statusCode, 404);
});

test('read metadata uses the existing session gate and cannot replace messages or model state', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-session-read-'));
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const feature = createMonsoonFeature({ dataDir });
  registerMonsoonSessions(app, new CollaborationRouter([feature.module]));
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const created = await app.inject({ method: 'POST', url: '/sessions', payload: {
    ...session(), messages: [{ id: 'run-a', role: 'assistant', content: 'stored',
      timestamp: '2026-01-01T00:00:01.000Z', runCommitted: false }],
  } });
  const lastReadAt = '2026-01-01T00:00:02.000Z';
  const payload = { expectedRevision: 1, mode: 'read', session: {
    ...created.json(), messages: [], model: 'different-model', title: 'different-title', lastReadAt,
  } };
  const read = await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json().messages, created.json().messages);
  assert.equal(read.json().model, 'model-a');
  assert.equal(read.json().title, 'New');
  assert.equal(read.json().lastReadAt, lastReadAt);
  assert.equal(read.json().revision, 1);
  assert.equal(read.json().messageRevision, 1);
  assert.equal(read.json().updatedAt, created.json().updatedAt);
  const older = await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload: {
    ...payload, session: { ...payload.session, lastReadAt: '2026-01-01T01:00:01+01:00' },
  } });
  assert.equal(older.statusCode, 200);
  assert.equal(older.json().lastReadAt, lastReadAt);
  const invalid = { ...payload, session: { ...payload.session, lastReadAt: 'invalid' } };
  assert.equal((await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload: invalid })).statusCode, 400);
  assert.equal((await app.inject('/sessions/agent-a/session-a')).json().lastReadAt, lastReadAt);
  const completed = await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload: {
    expectedRevision: 1, mode: 'content', session: { ...created.json(), messages: [{
      ...created.json().messages[0], content: 'completed', runCommitted: true,
    }] },
  } });
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.json().lastReadAt, lastReadAt);
  assert.equal((await app.inject({ method: 'PUT', url: '/sessions/agent-a/session-a', payload })).statusCode, 409);
});
