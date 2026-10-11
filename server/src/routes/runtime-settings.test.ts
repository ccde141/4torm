import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
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
    assert.deepEqual(calls, []);
    assert.throws(() => router.globalSettings('writeCompaction', {}, {
      actor: { type: 'agent', id: 'agent-a', actingAs: 'human' }, audience: 'agent',
      enabledFeatures: new Set(), permissions: new Set(['administer']), requestId: 'r',
    }), /全局设置/);
  } finally { await app.close(); }
});
