import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { toolRoutes } from './tools.js';
import { executionObserver } from '../services/execution-observer.js';
import { backgroundExecutions } from '../services/background-execution.js';

test('命令非零退出作为完整业务失败返回，而不是 HTTP 500', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-exit-'));
  const dataDir = path.join(root, 'data');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, {
    prefix: '/api/tools',
    executeTool: async () => {
      const error = new Error('(命令退出码 7)\nTraceback\nValueError: final detail') as Error & { exitCode: number };
      error.name = 'CommandExecutionError';
      error.exitCode = 7;
      throw error;
    },
  });
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
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, {
    prefix: '/api/tools',
    backgroundGraceMs: 5,
    executeTool: async (_dataDir, _tool, _args, _agentId, _workspace, _sandbox, _meta, signal) => new Promise(resolve => {
      signal?.addEventListener('abort', () => resolve('stopped'), { once: true });
    }),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/tools/exec',
    payload: {
      tool: 'run_command', args: { command: 'wait' }, observation: { scope: 'conversation', ownerId: 'owner-a' },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.json().result, /后台运行/);
  const run = await waitForObservation('owner-a', 'wait');

  const foreign = await app.inject({ method: 'POST', url: `/api/tools/observations/${run.id}/terminate?scope=conversation&ownerId=owner-b` });
  assert.equal(foreign.statusCode, 404);
  const stopped = await app.inject({ method: 'POST', url: `/api/tools/observations/${run.id}/terminate?scope=conversation&ownerId=owner-a` });
  assert.equal(stopped.statusCode, 202);
  await waitForObservationStatus(run.id, 'cancelled');
});

test('短命令保持同步返回，且后台句柄保留退出码错误语义', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-quick-'));
  const app = Fastify();
  app.decorate('dataDir', path.join(root, 'data'));
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, {
    prefix: '/api/tools', backgroundGraceMs: 50,
    executeTool: async () => 'quick result',
  });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/tools/exec',
    payload: {
      tool: 'run_command', args: { command: 'quick' }, observation: { scope: 'conversation', ownerId: 'quick-owner' },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().result, 'quick result');
  assert.equal(executionObserver.get(response.json().executionId)?.status, 'completed');
});

test('生命周期入口缺失时仍可由后台协调器终止', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-fallback-'));
  const app = Fastify();
  app.decorate('dataDir', path.join(root, 'data'));
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const observed = executionObserver.start({
    scope: 'conversation', ownerId: 'fallback-owner', command: 'detached command', kind: 'terminal', viewer: 'terminal',
  });
  await backgroundExecutions.start({
    executionId: observed.id, scope: observed.scope, ownerId: observed.ownerId,
    label: observed.command, graceMs: 0,
    run: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    onSettled: snapshot => executionObserver.finish(observed.id, { status: snapshot.status === 'cancelled' ? 'cancelled' : 'failed' }),
  });

  const response = await app.inject({
    method: 'POST',
    url: `/api/tools/observations/${observed.id}/terminate?scope=conversation&ownerId=fallback-owner`,
  });
  assert.equal(response.statusCode, 202);
  await waitForObservationStatus(observed.id, 'cancelled');
});

test('声明 detachable 的自定义工具使用同一后台生命周期', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-custom-background-'));
  const dataDir = path.join(root, 'data');
  await installExecutionModeTool(dataDir, 'long_custom_tool', 'detachable');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, {
    prefix: '/api/tools', backgroundGraceMs: 5,
    executeTool: async (_dataDir, _tool, _args, _agentId, _workspace, _sandbox, _meta, signal, onOutput) => new Promise(resolve => {
      onOutput?.('stdout', 'custom started\n');
      signal?.addEventListener('abort', () => resolve('custom stopped'), { once: true });
    }),
  });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/tools/exec',
    payload: { tool: 'long_custom_tool', args: {}, observation: { scope: 'conversation', ownerId: 'custom-owner' } },
  });
  const payload = response.json();
  assert.equal(response.statusCode, 200);
  assert.match(payload.result, /后台运行/);
  assert.equal(executionObserver.get(payload.executionId)?.command, 'long_custom_tool');
  assert.equal(executionObserver.get(payload.executionId)?.promoted, true);

  const stopped = await app.inject({
    method: 'POST',
    url: `/api/tools/observations/${payload.executionId}/terminate?scope=conversation&ownerId=custom-owner`,
  });
  assert.equal(stopped.statusCode, 202);
  await waitForObservationStatus(payload.executionId, 'cancelled');
});

test('缺省 sync 的自定义工具保持当前调用内完成', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-custom-sync-'));
  const dataDir = path.join(root, 'data');
  await installExecutionModeTool(dataDir, 'sync_custom_tool', 'sync');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, {
    prefix: '/api/tools', backgroundGraceMs: 0,
    executeTool: async () => 'sync result',
  });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/tools/exec',
    payload: { tool: 'sync_custom_tool', args: {}, observation: { scope: 'conversation', ownerId: 'sync-owner' } },
  });
  assert.deepEqual(response.json(), { result: 'sync result' });
  assert.equal(executionObserver.list('conversation', 'sync-owner').length, 0);
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

async function installExecutionModeTool(dataDir: string, name: string, executionMode: 'sync' | 'detachable'): Promise<void> {
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name, description: 'test', category: 'custom', dangerous: false,
    executorType: 'custom', executorFile: name, executionMode,
    parameters: { type: 'object', properties: {} },
  }]));
}

async function waitForObservationStatus(id: string, status: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (executionObserver.get(id)?.status === status) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`observation did not reach ${status}`);
}
