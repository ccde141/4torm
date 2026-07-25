import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { toolRoutes } from './tools.js';

test('closing /api/tools/exec aborts the running executor', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-abort-'));
  const dataDir = path.join(root, 'data');
  const marker = path.join(root, 'aborted.txt');
  await installAbortProbe(dataDir);

  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const req = http.request({
    host: '127.0.0.1', port: address.port,
    path: '/api/tools/exec', method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  req.on('error', () => {});
  req.end(JSON.stringify({ tool: 'abort_probe', args: { marker } }));
  setTimeout(() => req.destroy(), 30);

  await waitForFile(marker);
  assert.equal(await fs.readFile(marker, 'utf8'), 'aborted');
});

async function installAbortProbe(dataDir: string): Promise<void> {
  const executorDir = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executorDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'abort_probe', description: 'test',
    executorType: 'custom', executorFile: 'abort_probe',
  }]));
  await fs.writeFile(path.join(executorDir, 'abort_probe.js'), `
    import fs from 'node:fs/promises';
    export default (_args, ctx) => new Promise((resolve) => {
      ctx.signal.addEventListener('abort', async () => {
        await fs.writeFile(_args.marker, 'aborted');
        resolve('aborted');
      }, { once: true });
    });
  `);
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try { await fs.access(filePath); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('executor did not observe the disconnected request');
}
