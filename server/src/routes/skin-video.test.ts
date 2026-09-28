import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { skinVideoRoutes } from './skin-video.js';

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(16)]);

test('background video upload, byte ranges and deletion use isolated local files', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), '4torm-skin-video-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(skinVideoRoutes, { prefix: '/api/skin-video' });
  t.after(() => app.close());

  const uploaded = await app.inject({ method: 'PUT', url: '/api/skin-video', headers: { 'content-type': 'video/mp4' }, payload: MP4 });
  assert.equal(uploaded.statusCode, 200);
  const { id } = uploaded.json() as { id: string };
  assert.match(id, /^background-[a-f0-9-]+\.mp4$/);
  const full = await app.inject({ method: 'GET', url: `/api/skin-video/${id}` });
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers['content-type'], 'video/mp4');
  assert.deepEqual(full.rawPayload, MP4);
  const range = await app.inject({ method: 'GET', url: `/api/skin-video/${id}`, headers: { range: 'bytes=4-11' } });
  assert.equal(range.statusCode, 206);
  assert.equal(range.headers['content-range'], `bytes 4-11/${MP4.length}`);
  assert.deepEqual(range.rawPayload, MP4.subarray(4, 12));
  const invalidRange = await app.inject({ method: 'GET', url: `/api/skin-video/${id}`, headers: { range: 'bytes=999-' } });
  assert.equal(invalidRange.statusCode, 416);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/skin-video/${id}` })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/api/skin-video/${id}` })).statusCode, 404);
});

test('background video rejects invalid content and names', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), '4torm-skin-video-invalid-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(skinVideoRoutes, { prefix: '/api/skin-video' });
  t.after(() => app.close());

  const fake = await app.inject({ method: 'PUT', url: '/api/skin-video', headers: { 'content-type': 'video/mp4' }, payload: Buffer.from('not a video') });
  assert.equal(fake.statusCode, 415);
  assert.deepEqual(await readdir(path.join(dataDir, 'skin-videos')), []);
  assert.equal((await app.inject({ method: 'GET', url: '/api/skin-video/not-a-video.mp4' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/skin-video/not-a-video.mp4' })).statusCode, 400);
  const webm = await app.inject({ method: 'PUT', url: '/api/skin-video', headers: { 'content-type': 'video/webm' },
    payload: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]) });
  assert.equal(webm.statusCode, 200);
  assert.match(webm.json().id, /\.webm$/);
});

test('interrupted video upload removes its partial file', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), '4torm-skin-video-abort-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(skinVideoRoutes, { prefix: '/api/skin-video' });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const request = http.request({ host: '127.0.0.1', port: address.port, method: 'PUT', path: '/api/skin-video',
    headers: { 'content-type': 'video/mp4', 'content-length': 1024 * 1024 } });
  request.on('error', () => {});
  request.write(Buffer.concat([MP4, Buffer.alloc(16 * 1024)]));
  const directory = path.join(dataDir, 'skin-videos');
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await readdir(directory).catch(() => [])).length > 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok((await readdir(directory)).length > 0);
  request.destroy();
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await readdir(directory).catch(() => [])).length === 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(await readdir(directory), []);
});

test('background video accepts files larger than the former 48 MB limit without leaving temporary files', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), '4torm-skin-video-large-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(skinVideoRoutes, { prefix: '/api/skin-video' });
  t.after(() => app.close());

  const payload = Buffer.alloc(49 * 1024 * 1024);
  MP4.copy(payload);
  const uploaded = await app.inject({ method: 'PUT', url: '/api/skin-video', headers: { 'content-type': 'video/mp4' }, payload });
  assert.equal(uploaded.statusCode, 200);
  assert.equal((await stat(path.join(dataDir, 'skin-videos', uploaded.json().id))).size, payload.length);
  assert.deepEqual(await readdir(path.join(dataDir, 'skin-videos')), [uploaded.json().id]);
});
