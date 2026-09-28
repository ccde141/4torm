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

  const target = 'agents/agent-test/sessions/_index.json';
  const payloads = Array.from({ length: 40 }, (_, index) => [{ id: `session-${index}` }]);
  const responses = await Promise.all(payloads.map(payload => app.inject({
    method: 'PUT',
    url: `/api/storage/write?path=${encodeURIComponent(target)}`,
    payload,
  })));

  assert.deepEqual(responses.map(response => response.statusCode), Array(40).fill(200));
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, target), 'utf8'));
  assert.ok(payloads.some(payload => JSON.stringify(payload) === JSON.stringify(saved)));
  const files = await fs.readdir(path.join(dataDir, 'agents', 'agent-test', 'sessions'));
  assert.equal(files.filter(file => file.endsWith('.tmp')).length, 0);
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
