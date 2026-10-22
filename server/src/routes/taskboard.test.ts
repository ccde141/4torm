import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';

import { taskboardRoutes } from './taskboard.js';

test('taskboard mutation route rejects a stale browser edit', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-taskboard-route-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(taskboardRoutes, { prefix: '/api/taskboard' });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const target = 'agents/agent-a/sessions/session-a.taskboard.json';

  const created = await app.inject({
    method: 'POST', url: '/api/taskboard/mutate',
    payload: {
      path: target, action: 'set', expectedRevision: 0, goal: '测试',
      tasks: [{ id: 't1', title: '初始', status: 'todo' }],
    },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().meta.taskboard.revision, 1);

  const updated = await app.inject({
    method: 'POST', url: '/api/taskboard/mutate',
    payload: {
      path: target, action: 'set', expectedRevision: 1, goal: '测试',
      tasks: [{ id: 't1', title: '新版', status: 'done' }],
    },
  });
  assert.equal(updated.json().meta.taskboard.revision, 2);

  const stale = await app.inject({
    method: 'POST', url: '/api/taskboard/mutate',
    payload: {
      path: target, action: 'set', expectedRevision: 1, goal: '测试',
      tasks: [{ id: 't1', title: '旧版', status: 'doing' }],
    },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().meta.taskboard.tasks[0].title, '新版');
});

test('taskboard route refuses non-taskboard storage paths', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-taskboard-path-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(taskboardRoutes, { prefix: '/api/taskboard' });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await app.inject({
    method: 'POST', url: '/api/taskboard/mutate',
    payload: { path: 'providers.json', action: 'clear', expectedRevision: 0 },
  });
  assert.equal(response.statusCode, 400);
});

test('taskboard route reports corrupt storage as failure without altering it', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-taskboard-route-corrupt-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(taskboardRoutes, { prefix: '/api/taskboard' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const target = 'agents/agent-a/sessions/session-a.taskboard.json';
  const file = path.join(dataDir, target);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{broken');
  const response = await app.inject({ method: 'POST', url: '/api/taskboard/mutate',
    payload: { path: target, action: 'set', expectedRevision: 0, tasks: [{ title: 'must not write' }] } });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().errorCode, 'TASKBOARD_STORE_CORRUPT');
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});
