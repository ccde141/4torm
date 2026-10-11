import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { collaborationRoutes } from './collaboration.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { installHumanIdentityPort } from './collaboration-context.js';

test('中心 Presence 口返回完整活动快照，未列出的 Agent 才可判空闲', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app);
  const router = new CollaborationRouter([], {
    read: () => new Map([['agent-a', { busy: true as const, surfaces: ['tide' as const] }]]),
  });
  await app.register(collaborationRoutes, { router });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/presence' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().agents, {
    'agent-a': { busy: true, surfaces: ['tide'] },
  });
  assert.equal(response.json().schemaVersion, 1);
  assert.equal(response.json().completeness, 'complete');
  assert.ok(Date.parse(response.json().observedAt));
});

test('Presence 源缺失时真实失败，不伪装为空闲', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app);
  await app.register(collaborationRoutes, { router: new CollaborationRouter() });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/presence' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().errorCode, 'AGENT_PRESENCE_UNAVAILABLE');
});

test('Presence 需要观察权限', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app, { resolve: () => ({
    id: 'limited-human', enabledFeatures: ['monsoon'], permissions: [],
  }) });
  await app.register(collaborationRoutes, { router: new CollaborationRouter([], {
    read: () => new Map([['agent-a', { busy: false, surfaces: ['tide'] }]]),
  }) });
  t.after(() => app.close());
  const denied = await app.inject({ method: 'GET', url: '/presence' });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().errorCode, 'AGENT_PRESENCE_DENIED');
});

test('Presence 拒绝 busy 与实际活动面不一致的事实', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app);
  await app.register(collaborationRoutes, { router: new CollaborationRouter([], {
    read: () => new Map([['agent-a', { busy: false, surfaces: ['tide'] }]]),
  }) });
  t.after(() => app.close());
  const invalid = await app.inject({ method: 'GET', url: '/presence' });
  assert.equal(invalid.statusCode, 500);
  assert.equal(invalid.json().errorCode, 'AGENT_PRESENCE_INVALID');
});
