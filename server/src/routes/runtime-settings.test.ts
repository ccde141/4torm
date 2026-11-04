import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import http from 'node:http';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { installHumanIdentityPort } from './collaboration-context.js';
import { runtimeSettingsRoutes } from './runtime-settings.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('global settings use central trusted identity and cannot be enabled by an Agent', async () => {
  const calls: string[] = [];
  const router = new CollaborationRouter([], undefined, { invoke: async method => {
    calls.push(method); return { ok: true };
  } });
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app, { resolve: () => ({ id: 'reader',
    enabledFeatures: [], permissions: ['observe'] }) });
  await app.register(runtimeSettingsRoutes, { router });
  try {
    const denied = await app.inject({ method: 'PUT', url: '/compaction', payload: {} });
    assert.equal(denied.statusCode, 403);
    for (const [method, url] of [['GET', '/memory-recall'], ['PUT', '/memory-recall'],
      ['POST', '/memory-recall/test-model']] as const) {
      assert.equal((await app.inject({ method, url, ...(method === 'GET' ? {} : { payload: {} }) })).statusCode, 403);
    }
    assert.deepEqual(calls, []);
    assert.throws(() => router.globalSettings('writeCompaction', {}, {
      actor: { type: 'agent', id: 'agent-a', actingAs: 'human' }, audience: 'agent',
      enabledFeatures: new Set(), permissions: new Set(['administer']), requestId: 'r',
    }), /全局设置/);
  } finally { await app.close(); }
});

test('memory model routes dispatch through the host port with trusted authority', async () => {
  const calls: Array<{ method: string; input: unknown; signal?: AbortSignal }> = [];
  const router = new CollaborationRouter([], undefined, { invoke: async (method, input, context) => {
    calls.push({ method, input, signal: context.signal }); return { version: 1, model: null };
  } });
  const app = Fastify(); installFrameworkErrorHandler(app);
  installHumanIdentityPort(app, { resolve: () => ({ id: 'admin', enabledFeatures: [], permissions: ['administer'] }) });
  await app.register(runtimeSettingsRoutes, { router });
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/memory-recall' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: '/memory-recall', payload: { version: 1, model: 'a:model' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/memory-recall/test-model', payload: { model: 'a:model' } })).statusCode, 200);
    assert.deepEqual(calls.map(call => call.method), ['readMemoryRecall', 'writeMemoryRecall', 'testMemoryRecallModel']);
    assert.deepEqual(calls[1].input, { version: 1, model: 'a:model' });
    assert.equal(calls[2].signal?.aborted, false);
  } finally { await app.close(); }
});

test('disconnecting manual recall verification aborts the provider signal', { timeout: 5000 }, async () => {
  let started!: () => void;
  let cancelled!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const router = new CollaborationRouter([], undefined, { invoke: async (_method, _input, context) => {
    assert.ok(context.signal);
    const stopped = new Promise<void>(resolve => context.signal!.addEventListener('abort', () => {
      cancelled(); resolve();
    }, { once: true }));
    started(); await stopped;
    return { cancelled: true };
  } });
  const app = Fastify(); installFrameworkErrorHandler(app);
  installHumanIdentityPort(app, { resolve: () => ({ id: 'admin', enabledFeatures: [], permissions: ['administer'] }) });
  await app.register(runtimeSettingsRoutes, { router });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = http.request(`${address}/memory-recall/test-model`, { method: 'POST',
    headers: { 'content-type': 'application/json' } });
  client.on('error', () => {});
  try {
    client.end(JSON.stringify({ model: 'fixture:recall' }));
    await entered;
    client.destroy();
    await aborted;
  } finally { client.destroy(); await app.close(); }
});
