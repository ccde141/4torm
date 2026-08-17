import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { agentAvatarRoutes } from './agent-avatar.js';

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]);

test('头像接口上传、缓存读取、删除并真实报告无效输入', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-avatar-route-'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({ 'agent-a': { id: 'agent-a' } }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(agentAvatarRoutes, { prefix: '/api/agents' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const invalid = await app.inject({ method: 'PUT', url: '/api/agents/agent-a/avatar', payload: { dataUrl: 'bad' } });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.json().error, /WebP/);

  const uploaded = await app.inject({
    method: 'PUT', url: '/api/agents/agent-a/avatar',
    payload: { dataUrl: `data:image/webp;base64,${WEBP.toString('base64')}` },
  });
  assert.equal(uploaded.statusCode, 200);
  assert.equal(uploaded.json().version > 0, true);

  const image = await app.inject({ method: 'GET', url: '/api/agents/agent-a/avatar?v=1' });
  assert.equal(image.statusCode, 200);
  assert.match(image.headers['content-type'] || '', /^image\/webp/);
  assert.match(image.headers['cache-control'] || '', /immutable/);
  assert.deepEqual(image.rawPayload, WEBP);

  assert.equal((await app.inject({ method: 'DELETE', url: '/api/agents/agent-a/avatar' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/agents/agent-a/avatar' })).statusCode, 404);
});
