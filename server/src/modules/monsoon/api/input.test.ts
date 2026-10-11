import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { registerConversationInput } from './input.js';
import { ConversationInputRuntime } from '../../../engine/conversation/input-runtime.js';
import { FrameworkError, frameworkErrorToHttp } from '../../../engine/shared/framework-error.js';
import { MonsoonInputService } from '../application/input-service.js';
import { createMonsoonInputJournalPort } from '../runtime/input-journal-adapter.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { monsoonInputHandlers, monsoonInputManifests } from './input-methods.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';

test('HTTP input validates ownership, deduplicates receipts, and rejects stopped runs', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-route-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const owner = { agentId: 'agent-test', sessionId: 'session-test', runId: 'run-test' };
  const runtime = new ConversationInputRuntime(dataDir, owner, () => {});
  runtime.bind([]);
  let busy = true;
  const app = Fastify();
  t.after(() => app.close());
  app.setErrorHandler((error, _request, reply) => {
    if (!(error instanceof FrameworkError)) throw error;
    const response = frameworkErrorToHttp(error);
    return reply.code(response.statusCode).send(response.body);
  });
  const service = new MonsoonInputService(id => id === owner.sessionId ? {
    isBusy: () => busy, getAgentId: () => owner.agentId, getInputRuntime: () => runtime,
  } : undefined, createMonsoonInputJournalPort(dataDir));
  registerConversationInput(app, inputRouter(service));
  const payload = { ...owner, id: 'one', content: 'new plan' };
  for (const wrong of [{ agentId: 'other' }, { sessionId: 'other' }, { runId: 'old' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/input', payload: { ...payload, ...wrong } })).statusCode, 409);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/input', payload: { ...payload, tools: [] } })).statusCode, 400);
  const first = await app.inject({ method: 'POST', url: '/input', payload });
  assert.equal(first.statusCode, 200);
  assert.deepEqual((await app.inject({ method: 'POST', url: '/input', payload })).json(), first.json());
  assert.equal((await app.inject({ method: 'POST', url: '/input', payload: { ...payload, content: 'changed' } })).statusCode, 409);
  runtime.stop();
  const closing = await app.inject({ method: 'POST', url: '/input', payload: { ...payload, id: 'closing' } });
  assert.equal(closing.statusCode, 200);
  assert.deepEqual(closing.json(), { disposition: 'next-turn' });
  await runtime.finish();
  busy = false;
  assert.deepEqual((await app.inject({ method: 'POST', url: '/input', payload })).json(), first.json());
  assert.deepEqual((await app.inject({ method: 'POST', url: '/input', payload: { ...payload, id: 'late' } })).json(), { disposition: 'next-turn' });
  const restored = (await app.inject({ url: `/input?${new URLSearchParams(owner)}` })).json();
  assert.equal(restored.active, false);
  assert.equal(restored.entries.length, 1);
  assert.deepEqual(restored.checkpoint.includedIds, []);
});

test('an empty completed run can hand off late input, but an unknown run cannot', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-close-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const owner = { agentId: 'agent', sessionId: 'session', runId: 'run' };
  const runtime = new ConversationInputRuntime(dataDir, owner, () => {});
  runtime.bind([]);
  await runtime.finish();
  const app = Fastify();
  t.after(() => app.close());
  registerConversationInput(app, inputRouter(new MonsoonInputService(
    () => undefined, createMonsoonInputJournalPort(dataDir),
  )));
  const response = await app.inject({ method: 'POST', url: '/input', payload: { ...owner, id: 'late', content: 'continue' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { disposition: 'next-turn' });
  const unknown = await app.inject({ method: 'POST', url: '/input', payload: { ...owner, runId: 'unknown', id: 'late', content: 'continue' } });
  assert.notEqual(unknown.statusCode, 200);
});

function inputRouter(service: MonsoonInputService): CollaborationRouter {
  return new CollaborationRouter([{ manifest: {
    id: 'monsoon', version: 1, title: '季风', methods: monsoonInputManifests(),
  }, handlers: monsoonInputHandlers(service) }]);
}

test('插话提交与接收状态读取均须经过中心准入', async t => {
  const app = Fastify();
  t.after(() => app.close());
  app.setErrorHandler((error, _request, reply) => {
    if (!(error instanceof FrameworkError)) throw error;
    const response = frameworkErrorToHttp(error);
    return reply.code(response.statusCode).send(response.body);
  });
  const router = new CollaborationRouter([]);
  const calls: string[] = [];
  router.invoke = async call => {
    calls.push(call.method);
    throw frameworkError({ code: 'TEST_INPUT_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  registerConversationInput(app, router);
  const owner = { agentId: 'agent-a', sessionId: 'session-a', runId: 'run-a' };
  const submitted = await app.inject({ method: 'POST', url: '/input',
    payload: { ...owner, id: 'message-a', content: '继续' } });
  const inspected = await app.inject({ url: `/input?${new URLSearchParams(owner)}` });
  assert.equal(submitted.statusCode, 403);
  assert.equal(inspected.statusCode, 403);
  assert.deepEqual(calls, ['submitInput', 'inspectInput']);
});
