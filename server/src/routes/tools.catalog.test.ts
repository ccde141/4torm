import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { toolRoutes } from './tools.js';

test('工具接口只允许维护自定义目录，框架工具始终只读', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-catalog-route-'));
  const dataDir = path.join(root, 'data');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools', collaborationTools: () => [] });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const initial = await app.inject({ method: 'GET', url: '/api/tools/catalog' });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().tools.find((tool: { name: string }) => tool.name === 'read_file').readonly, true);

  const saved = await app.inject({
    method: 'PUT', url: '/api/tools/custom',
    payload: { tools: [{
      name: 'demo_tool', description: 'demo', executorType: 'custom', executorFile: 'demo_tool', parameters: {},
    }] },
  });
  assert.equal(saved.statusCode, 200);
  const catalog = (await app.inject({ method: 'GET', url: '/api/tools/catalog' })).json().tools;
  assert.equal(catalog.find((tool: { name: string }) => tool.name === 'demo_tool').readonly, false);

  const shadow = await app.inject({
    method: 'PUT', url: '/api/tools/custom',
    payload: { tools: [{
      name: 'read_file', description: 'shadow', executorType: 'custom', executorFile: 'shadow', parameters: {},
    }] },
  });
  assert.equal(shadow.statusCode, 400);
  assert.match(shadow.json().error, /框架工具不可覆盖/);
});

test('工具目录展示中心协作能力并禁止自定义工具占用其名称', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-collaboration-catalog-'));
  const app = Fastify();
  app.decorate('dataDir', path.join(root, 'data'));
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, {
    prefix: '/api/tools',
    collaborationTools: () => [{
      name: 'create_collaboration', description: '创建协作组', parameters: { type: 'object' },
    }],
  });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const catalog = (await app.inject({ method: 'GET', url: '/api/tools/catalog' })).json().tools;
  assert.equal(catalog.find((tool: { name: string }) =>
    tool.name === 'create_collaboration')?.readonly, true);
  const shadow = await app.inject({
    method: 'PUT', url: '/api/tools/custom', payload: { tools: [{
      name: 'create_collaboration', description: 'shadow', executorType: 'custom',
      executorFile: 'shadow', parameters: {},
    }] },
  });
  assert.equal(shadow.statusCode, 400);
  assert.match(shadow.json().error, /框架工具不可覆盖/);
});

test('工具目录报告旧名称冲突但继续展示健康工具', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-conflicts-route-'));
  const dataDir = path.join(root, 'data');
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  const registry = path.join(dataDir, 'tools', 'registry.json');
  const raw = JSON.stringify([
    { name: 'framework_capability_tide', description: 'bad', executorType: 'custom', parameters: {} },
    { name: 'healthy_tool', description: 'good', executorType: 'custom', parameters: {} },
  ]);
  await fs.writeFile(registry, raw);
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools', collaborationTools: () => [] });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({ method: 'GET', url: '/api/tools/catalog' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.tools.some((tool: { name: string }) => tool.name === 'healthy_tool'), true);
  assert.equal(body.tools.some((tool: { name: string }) => tool.name === 'framework_capability_tide'), false);
  assert.match(body.conflicts.find((issue: { name: string; reason: string }) =>
    issue.name === 'framework_capability_tide')?.reason ?? '', /框架保留名称/);
  assert.equal(await fs.readFile(registry, 'utf8'), raw);
});

test('执行入口再次核验 Agent 保存的工具权限', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-permission-route-'));
  const dataDir = path.join(root, 'data');
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent_a: { id: 'agent_a', name: 'A', model: 'test', config: { tools: [], toolMode: 'selected', skills: [] } },
  }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const denied = await app.inject({
    method: 'POST', url: '/api/tools/exec',
    payload: { tool: 'read_file', args: { filePath: 'demo.txt' }, agentId: 'agent_a' },
  });
  assert.equal(denied.statusCode, 403);
  assert.match(denied.json().error, /未获准使用工具/);
});
