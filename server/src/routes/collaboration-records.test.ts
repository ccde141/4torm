import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { createTradewindModule } from '../modules/tradewind/public.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { collaborationRoutes } from './collaboration.js';

test('人类前端按时间查找记录并按运行 ID 有界续读', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const module = createTradewindModule({ source: { snapshots: async () => [] },
    commands: {} as never });
  module.manifest.operation!.records = true;
  module.records = {
    list: async () => [
      { operationId: 'wf-a', runId: 'run-a', title: '发布',
        status: 'completed', timestamp: '2026-10-01T00:00:00.000Z',
        agentId: 'agent-a' },
    ],
    read: async (_context, identity) => identity.runId === 'run-a'
      ? { detail: 'A'.repeat(60) } : null,
  };
  await app.register(collaborationRoutes, { router: new CollaborationRouter([module]) });
  t.after(() => app.close());

  const found = await app.inject({ method: 'POST', url: '/records/find', payload: {
    feature: 'tradewind', operationId: 'wf-a', limit: 1,
  } });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json().items.map((item: { runId: string }) => item.runId), ['run-a']);
  const byAgent = await app.inject({ method: 'POST', url: '/records/find', payload: {
    feature: 'tradewind', agentId: 'agent-a', limit: 1,
  } });
  assert.equal(byAgent.statusCode, 200);
  assert.deepEqual(byAgent.json().items.map((item: { runId: string }) => item.runId), ['run-a']);
  const latest = await app.inject({ method: 'POST', url: '/records/agents/latest', payload: {
    agentIds: ['agent-a'],
  } });
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.json().items[0]?.record.runId, 'run-a');
  const first = await app.inject({ method: 'POST', url: '/records/read', payload: {
    feature: 'tradewind', operationId: 'wf-a', runId: 'run-a', maxTextChars: 20,
  } });
  assert.equal(first.statusCode, 200);
  assert.ok(first.json().text.length <= 20);
  assert.ok(first.json().nextCursor);
  const next = await app.inject({ method: 'POST', url: '/records/read', payload: {
    feature: 'tradewind', operationId: 'wf-a', runId: 'run-a',
    maxTextChars: 20, cursor: first.json().nextCursor,
  } });
  assert.equal(next.statusCode, 200);
  const spoofed = await app.inject({ method: 'POST', url: '/records/find', payload: {
    feature: 'tradewind', actor: { id: 'agent-a' },
  } });
  assert.equal(spoofed.statusCode, 400);
});
