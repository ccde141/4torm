import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { humanContext, installHumanIdentityPort } from './collaboration-context.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { collaborationRoutes } from './collaboration.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';

test('HTTP human context comes from a replaceable identity port, not request body', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app, {
    resolve: request => {
      assert.equal(request.headers['x-actor-id'], 'forged-agent');
      return { id: 'account-human', enabledFeatures: ['tide'], permissions: ['observe'] };
    },
  });
  app.post('/who', async request => {
    const context = humanContext(request);
    return { ...context, enabledFeatures: [...context.enabledFeatures],
      permissions: [...context.permissions] };
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/who',
    headers: { 'x-actor-id': 'forged-agent' },
    payload: { actor: { type: 'agent', id: 'forged-agent' } },
  });
  assert.equal(response.statusCode, 200);
  const context = response.json();
  assert.deepEqual(context.actor, {
    type: 'human', id: 'account-human', actingAs: 'human',
  });
  assert.deepEqual(context.enabledFeatures, ['tide']);
  assert.deepEqual(context.permissions, ['observe']);
  assert.equal(context.requestId.length > 0, true);
});

test('identity port fails closed when no principal is resolved', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app, { resolve: () => null });
  app.get('/who', async request => humanContext(request));
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/who' });
  assert.equal(response.statusCode, 403);
});

test('the actual collaboration HTTP entry refuses an unresolved human principal', async t => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app, { resolve: () => null });
  await app.register(collaborationRoutes, { router: new CollaborationRouter() });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/modules' });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().errorCode, 'HUMAN_IDENTITY_UNAVAILABLE');
});
