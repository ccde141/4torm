import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { agentAvatarRoutes } from './agent-avatar.js';
import { agentRoutes } from '../modules/agents/public.js';
import { createMonsoonFeature, monsoonRoutes } from '../modules/monsoon/public.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]);

test('新建 Agent 由后端生成有效标识并可立即被后续接口使用', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-agent-create-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(agentRoutes, { prefix: '/api/agents' });
  await app.register(agentAvatarRoutes, { prefix: '/api/agents' });
  const monsoon = createMonsoonFeature({ dataDir });
  await app.register(monsoonRoutes, {
    prefix: '/api/conversation', feature: monsoon,
    router: new CollaborationRouter([monsoon.module]),
  });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const created = await app.inject({ method: 'POST', url: '/api/agents', payload: {
    name: '事故复现', role: '测试', description: '创建后立即使用', model: 'provider:model',
    config: { rolePrompt: '保持严谨', tools: ['read_file'], toolMode: 'selected', skills: [] },
  } });
  assert.equal(created.statusCode, 201);
  const agent = created.json();
  assert.match(agent.id, /^agent-[a-z0-9]+$/);

  const avatar = await app.inject({ method: 'PUT', url: `/api/agents/${agent.id}/avatar`,
    payload: { dataUrl: `data:image/webp;base64,${WEBP.toString('base64')}` } });
  assert.equal(avatar.statusCode, 200);

  const session = await app.inject({ method: 'POST', url: '/api/conversation/sessions', payload: {
    id: `${agent.id}-session-a`, agentId: agent.id, agentName: agent.name, title: '新会话',
    messages: [], model: agent.model, systemPrompt: '', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), revision: 0,
  } });
  assert.equal(session.statusCode, 201);
  assert.equal(session.json().agentId, agent.id);

  const registry = JSON.parse(await fs.readFile(path.join(dataDir, 'agents', 'registry.json'), 'utf8'));
  assert.equal(registry[agent.id].id, agent.id);
  assert.equal(await fs.readFile(path.join(dataDir, 'agents', agent.id, '.workspace',
    'role-prompt.md'), 'utf8'), '保持严谨');
});

test('并发新建 Agent 不会互相覆盖 registry', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-agent-race-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(agentRoutes, { prefix: '/api/agents' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => app.inject({
    method: 'POST', url: '/api/agents', payload: {
      name: `Agent ${index}`, role: '', description: '', model: '', config: {},
    },
  })));
  assert.deepEqual(responses.map(response => response.statusCode), Array(20).fill(201));
  const ids = responses.map(response => response.json().id);
  assert.equal(new Set(ids).size, 20);
  const registry = JSON.parse(await fs.readFile(path.join(dataDir, 'agents', 'registry.json'), 'utf8'));
  assert.deepEqual(Object.keys(registry).sort(), [...ids].sort());
});

test('Agent 实体入口统一读取、更新配置和删除', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-agent-crud-'));
  const dataDir = path.join(root, 'data');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(agentRoutes, { prefix: '/api/agents' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const invalidLabel = await app.inject({ method: 'POST', url: '/api/agents', payload: {
    name: '旧标签', role: '', description: '', model: 'old', config: {}, label: 'one',
  } });
  assert.equal(invalidLabel.statusCode, 400);

  const created = await app.inject({ method: 'POST', url: '/api/agents', payload: {
    name: 'A', role: '', description: '', model: 'old',
    config: {},
  } });
  const id = created.json().id;
  const listed = (await app.inject('/api/agents')).json();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].workspaceDisplayPath, `./data/agents/${id}/.workspace`);
  assert.equal(listed[0].workspacePath, undefined);
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'agents', 'registry.json'), 'utf8'));
  assert.equal(saved[id].workspacePath, undefined);
  saved[id].label = 'old-label';
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify(saved));
  const rejectedPatch = await app.inject({ method: 'PATCH', url: `/api/agents/${id}`,
    payload: { label: null } });
  assert.equal(rejectedPatch.statusCode, 400);
  const updated = await app.inject({ method: 'PUT', url: `/api/agents/${id}/config`, payload: {
    model: 'new', config: { rolePrompt: 'new role', tools: [] },
    patch: { name: 'B' },
  } });
  assert.equal(updated.json().name, 'B');
  assert.equal(updated.json().model, 'new');
  assert.equal(updated.json().label, 'old-label');
  const afterUpdate = (await app.inject('/api/agents')).json()[0];
  assert.equal(afterUpdate.workspaceDisplayPath, `./data/agents/${id}/.workspace`);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/agents/${id}` })).statusCode, 200);
  const repeated = await app.inject({ method: 'DELETE', url: `/api/agents/${id}` });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().existed, false);
  assert.deepEqual((await app.inject('/api/agents')).json(), []);
});

test('Agent 工作区仅在软件目录外展示绝对路径', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-agent-workspace-'));
  const dataDir = path.join(root, 'data');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(agentRoutes, { prefix: '/api/agents' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const created = await app.inject({ method: 'POST', url: '/api/agents', payload: {
    name: 'Workspace', role: '', description: '', model: '', config: {},
  } });
  const id = created.json().id;
  const updateWorkspace = async (workspace: string) => app.inject({
    method: 'PUT', url: `/api/agents/${id}/config`,
    payload: { model: '', config: { workspace }, patch: {} },
  });
  const displayed = async () => (await app.inject('/api/agents')).json()[0].workspaceDisplayPath;

  assert.equal((await updateWorkspace('shared/work')).statusCode, 200);
  assert.equal(await displayed(), './shared/work');
  const insideAbsolute = path.join(root, 'shared', 'work');
  assert.equal((await updateWorkspace(insideAbsolute)).statusCode, 200);
  assert.equal(await displayed(), './shared/work');
  const external = path.resolve(root, '..', 'external-work');
  assert.equal((await updateWorkspace(external)).statusCode, 200);
  assert.equal(await displayed(), external);
  const registry = JSON.parse(await fs.readFile(path.join(dataDir, 'agents', 'registry.json'), 'utf8'));
  assert.equal(registry[id].config.workspace, external);
  assert.equal(registry[id].workspaceDisplayPath, undefined);
  assert.equal((await updateWorkspace('../external-work')).statusCode, 200);
  assert.equal(await displayed(), external);
  const sibling = path.resolve(root, '..', `${path.basename(root)}-other`, 'work');
  assert.equal((await updateWorkspace(sibling)).statusCode, 200);
  assert.equal(await displayed(), sibling);
});

test('生产服务注册 Agent 实体路由', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = await fs.readFile(path.join(root, 'index.ts'), 'utf8');
  assert.match(source, /register\(agentRoutes, \{ prefix: '\/api\/agents' \}\)/);
});
