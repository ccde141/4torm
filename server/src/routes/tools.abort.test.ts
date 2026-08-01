import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { toolRoutes } from './tools.js';
import { executionObserver } from '../services/execution-observer.js';

test('命令非零退出作为完整业务失败返回，而不是 HTTP 500', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-exit-'));
  const dataDir = path.join(root, 'data');
  await installCommandFailureProbe(dataDir);
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/tools/exec',
    payload: { tool: 'run_command', args: { command: 'python failing.py' } },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: false,
    error: '(命令退出码 7)\nTraceback\nValueError: final detail',
    exitCode: 7,
  });
});

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

test('terminating an observed command cancels its owned runner', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-terminate-'));
  const dataDir = path.join(root, 'data');
  await installTerminationProbe(dataDir);
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const response = new Promise<number>(resolve => {
    const request = http.request({
      host: '127.0.0.1', port: address.port, path: '/api/tools/exec', method: 'POST', headers: { 'content-type': 'application/json' },
    }, reply => { reply.resume(); reply.once('end', () => resolve(reply.statusCode ?? 0)); });
    request.end(JSON.stringify({
      tool: 'run_command', args: { command: 'wait' }, observation: { scope: 'conversation', ownerId: 'owner-a' },
    }));
  });
  const run = await waitForObservation('owner-a', 'wait');

  const foreign = await app.inject({ method: 'POST', url: `/api/tools/observations/${run.id}/terminate?scope=conversation&ownerId=owner-b` });
  assert.equal(foreign.statusCode, 404);
  const stopped = await app.inject({ method: 'POST', url: `/api/tools/observations/${run.id}/terminate?scope=conversation&ownerId=owner-a` });
  assert.equal(stopped.statusCode, 202);
  assert.equal(await response, 409);
  assert.equal(executionObserver.get(run.id)?.status, 'cancelled');
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

async function installCommandFailureProbe(dataDir: string): Promise<void> {
  const executorDir = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executorDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'run_command', description: 'test', executorType: 'custom', executorFile: 'command_failure_probe',
  }]));
  await fs.writeFile(path.join(executorDir, 'command_failure_probe.js'), `
    export default () => {
      const error = new Error('(命令退出码 7)\\nTraceback\\nValueError: final detail');
      error.name = 'CommandExecutionError';
      error.exitCode = 7;
      throw error;
    };
  `);
}

async function installTerminationProbe(dataDir: string): Promise<void> {
  const executorDir = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executorDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'run_command', description: 'test', executorType: 'custom', executorFile: 'terminate_probe',
  }]));
  await fs.writeFile(path.join(executorDir, 'terminate_probe.js'), `
    export default (_args, ctx) => new Promise((resolve) => {
      ctx.signal.addEventListener('abort', () => {
        resolve('stopped');
      }, { once: true });
    });
  `);
}

async function waitForObservation(ownerId: string, command: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const found = executionObserver.listActive('conversation', ownerId).find(item => item.command === command);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('observed command did not start');
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try { await fs.access(filePath); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('executor did not observe the disconnected request');
}
