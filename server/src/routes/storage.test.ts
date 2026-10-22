import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { storageRoutes } from './storage.js';

test('concurrent storage writes serialize replacement of the same file', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-storage-race-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(storageRoutes, { prefix: '/api/storage' });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const target = 'runtime/storage-race.json';
  const payloads = Array.from({ length: 40 }, (_, index) => [{ id: `session-${index}` }]);
  const responses = await Promise.all(payloads.map(payload => app.inject({
    method: 'PUT',
    url: `/api/storage/write?path=${encodeURIComponent(target)}`,
    payload,
  })));

  assert.deepEqual(responses.map(response => response.statusCode), Array(40).fill(200));
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, target), 'utf8'));
  assert.ok(payloads.some(payload => JSON.stringify(payload) === JSON.stringify(saved)));
  const files = await fs.readdir(path.join(dataDir, 'runtime'));
  assert.equal(files.filter(file => file.endsWith('.tmp')).length, 0);
});

test('generic storage cannot read, overwrite or delete Monsoon session ownership files', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-storage-boundary-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(storageRoutes, { prefix: '/api/storage' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  for (const target of [
    'agents/agent-a/sessions/_index.json',
    'agents/agent-a/sessions/session-a.json',
    'agents/agent-a/sessions/session-a.runs/run-a.ndjson',
  ]) {
    const encoded = encodeURIComponent(target);
    assert.equal((await app.inject(`/api/storage/read?path=${encoded}`)).statusCode, 403);
    assert.equal((await app.inject(`/api/storage/read?path=${encoded}`)).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/storage/write?path=${encoded}`,
      payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/storage/delete?path=${encoded}` }))
      .statusCode, 403);
  }

  const taskboard = encodeURIComponent('agents/agent-a/sessions/session-a.taskboard.json');
  assert.equal((await app.inject({ method: 'PUT', url: `/api/storage/write?path=${taskboard}`,
    payload: {} })).statusCode, 200);
});

test('generic storage cannot mutate Agent entity ownership files', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-agent-boundary-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(storageRoutes, { prefix: '/api/storage' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  for (const target of [
    'agents/registry.json',
    'agents/agent-a/.workspace/config.json',
    'agents/agent-a/.workspace/role-prompt.md',
    'agents/agent-a/.workspace/MEMORY.md',
  ]) {
    const encoded = encodeURIComponent(target);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/storage/write?path=${encoded}`,
      payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/storage/delete?path=${encoded}` }))
      .statusCode, 403);
  }
});

test('skin config storage migrates legacy video background into an independent texture layer', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-skin-config-migrate-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(storageRoutes, { prefix: '/api/storage' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const legacy = { primaryColor: '#fff', texture: { layers: ['grid'] },
    background: { type: 'video', video: { id: 'background-abc123.mp4', fit: 'contain', opacity: 0.6 } } };
  await fs.writeFile(path.join(dataDir, 'skin-config.json'), JSON.stringify(legacy));
  const read = await app.inject({ method: 'GET', url: '/api/storage/read?path=skin-config.json' });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().background.type, 'none');
  assert.deepEqual(read.json().texture.layers, ['grid', 'video']);
  assert.equal(read.json().texture.video.id, 'background-abc123.mp4');
  const saved = await app.inject({ method: 'PUT', url: '/api/storage/write?path=skin-config.json', payload: legacy });
  assert.equal(saved.statusCode, 200);
  const disk = JSON.parse(await fs.readFile(path.join(dataDir, 'skin-config.json'), 'utf8'));
  assert.equal(disk.background.type, 'none');
  assert.deepEqual(disk.texture.layers, ['grid', 'video']);
  assert.equal(disk.background.video, undefined);
});

test('provider credentials cannot bypass the model API through generic storage spelling or root deletion', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-provider-storage-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(storageRoutes, { prefix: '/api/storage' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  await fs.writeFile(path.join(dataDir, 'providers.json'), '{"apiKey":"fixture-only"}');
  for (const target of ['providers.json', './providers.json', 'folder/../providers.json', 'PROVIDERS.JSON', '.']) {
    for (const route of ['read', 'file']) assert.equal((await app.inject(
      `/api/storage/${route}?path=${encodeURIComponent(target)}`)).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/storage/write?path=${encodeURIComponent(target)}`,
      payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/storage/delete?path=${encodeURIComponent(target)}` }))
      .statusCode, 403);
  }
  assert.match(await fs.readFile(path.join(dataDir, 'providers.json'), 'utf8'), /fixture-only/);
});

test('canonical aliases, junctions and recursive parent deletion retain feature ownership', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-feature-ownership-'));
  const dataDir = path.join(root, 'data');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(storageRoutes, { prefix: '/api/storage' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const contents = { 'agents/registry.json': '{"agent-a":{}}',
    'agents/agent-a/sessions/session.json': '{"messages":["preserve"]}',
    'agents/agent-a/.workspace/config.json': '{"name":"preserve"}' };
  for (const [file, content] of Object.entries(contents)) {
    await fs.mkdir(path.dirname(path.join(dataDir, file)), { recursive: true });
    await fs.writeFile(path.join(dataDir, file), content);
  }
  await fs.symlink(path.join(dataDir, 'agents'), path.join(dataDir, 'agent-alias'), 'junction');
  for (const file of Object.keys(contents)) {
    for (const alias of [`./${file}`, `unused/../${file}`, file.replaceAll('/', '\\'),
      file.replace('agents/', 'agent-alias/')]) {
      for (const [method, route] of [['GET', 'read'], ['PUT', 'write'], ['PUT', 'upload'], ['DELETE', 'delete']] as const) {
        const response = await app.inject({ method, url: `/api/storage/${route}?path=${encodeURIComponent(alias)}`,
          ...(method === 'PUT' ? { payload: {} } : {}) });
        assert.equal(response.statusCode, 403, `${method} ${alias}`);
      }
    }
  }
  for (const target of ['agents', 'agents/agent-a', 'agents/agent-a/sessions', 'agents/agent-a/.workspace', 'agent-alias']) {
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/storage/delete?path=${encodeURIComponent(target)}` })).statusCode, 403);
  }
  for (const [file, content] of Object.entries(contents)) assert.equal(await fs.readFile(path.join(dataDir, file), 'utf8'), content);
  const ordinary = 'agents/agent-a/.workspace/generated/file.txt';
  assert.equal((await app.inject({ method: 'PUT', url: `/api/storage/write?path=${encodeURIComponent(ordinary)}`, payload: {} })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/storage/delete?path=${encodeURIComponent(path.posix.dirname(ordinary))}` })).statusCode, 200);
});
