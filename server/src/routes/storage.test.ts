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
