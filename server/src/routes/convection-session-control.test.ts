import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { createConvectionFeature } from '../modules/convection/public.js';
import { convectionRoutes } from './convection.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('对流 HTTP 只暴露会话读取，不再保留第二套写入口', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-http-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createConvectionFeature({ dataDir });
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'chair-a': { name: '会长' }, 'agent-a': { name: '成员' },
  }));
  await app.register(convectionRoutes, {
    feature, router: new CollaborationRouter([feature.module]),
  });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const created = await feature.sessions.create({
    chairAgentId: 'chair-a', participantAgentIds: ['agent-a'], title: '评审',
  });
  assert.equal((await app.inject('/list')).statusCode, 200);
  assert.equal((await app.inject(`/session/${created.id}/status`)).json().title, '评审');
  for (const url of [
    '/create', `/session/${created.id}/rename`, `/session/${created.id}/delete`,
    `/session/${created.id}/open-workspace`, `/session/${created.id}/abort`,
  ]) {
    assert.equal((await app.inject({ method: 'POST', url })).statusCode, 404, url);
  }
});
