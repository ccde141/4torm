import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import { toolRoutes } from './tools.js';

test('browser tool cannot bypass its owning observation context through the generic executor route', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-browser-route-'));
  const app = Fastify();
  app.decorate('dataDir', path.join(root, 'data'));
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/tools/exec',
    payload: { tool: 'browser', agentId: 'agent-a', args: { action: 'inspect' } },
  });

  assert.equal(response.statusCode, 500);
  assert.match(response.json().error, /requires an owning conversation or cyclone context/);
});

test('browser execution close requires its owning observation context', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-browser-route-'));
  const app = Fastify();
  app.decorate('dataDir', path.join(root, 'data'));
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({ method: 'POST', url: '/api/tools/observations/browser-a/close' });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /missing browser close context/);
});
