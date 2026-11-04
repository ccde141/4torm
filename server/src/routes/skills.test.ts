import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { skillsRoutes } from './skills.js';

test('custom categories persist, preserve skill contents and reject stale concurrent changes', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-categories-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(skillsRoutes, { prefix: '/api/skills' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  await app.inject({ method: 'POST', url: '/api/skills/create', payload: {
    id: 'demo', meta: { name: 'Demo', category: '文档', extension: { keep: true } }, content: '# Original',
  } });
  const file = path.join(dataDir, 'skills/demo/config.json');
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const category of [undefined, '', '   ', 12, {}, 'x'.repeat(61)]) {
    await fs.writeFile(file, JSON.stringify({ ...original, category }));
    const rows = (await app.inject('/api/skills/list')).json();
    assert.equal(rows[0].category, '');
    const response = await app.inject({ method: 'PATCH', url: '/api/skills/demo/category', payload: { category: '文档', expectedCategory: '' } });
    assert.equal(response.statusCode, 200);
  }
  const change = (category: string, expectedCategory = '文档') => app.inject({ method: 'PATCH', url: '/api/skills/demo/category', payload: { category, expectedCategory } });
  const results = await Promise.all([change('办公资料'), change('项目研究')]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  const list = (await app.inject('/api/skills/list')).json();
  assert.ok(['办公资料', '项目研究'].includes(list[0].category));
  const configFile = path.join(dataDir, 'skills/demo/config.json');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.deepEqual(config.extension, { keep: true });
  assert.equal(await fs.readFile(path.join(dataDir, 'skills/demo/SKILL.md'), 'utf8'), '# Original');
  assert.equal((await change('x'.repeat(61))).statusCode, 400);
  await fs.writeFile(configFile, 'broken');
  assert.equal((await change('其他')).statusCode, 500);
  assert.equal(await fs.readFile(configFile, 'utf8'), 'broken');
  await app.inject({ method: 'DELETE', url: '/api/skills/demo' });
  assert.equal((await change('其他')).statusCode, 404);
});

test('技能创建拒绝重复 ID，删除返回真实结果', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-skills-route-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(skillsRoutes, { prefix: '/api/skills' });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const payload = {
    id: 'review-skill',
    meta: { name: '审查技能', description: '检查代码', category: '开发', version: '1.0.0', author: 'User' },
    content: '# 审查技能\n',
  };
  const created = await app.inject({ method: 'POST', url: '/api/skills/create', payload });
  assert.equal(created.statusCode, 201);
  assert.equal(await fs.readFile(path.join(dataDir, 'skills', payload.id, 'SKILL.md'), 'utf8'), payload.content);

  const duplicate = await app.inject({ method: 'POST', url: '/api/skills/create', payload: { ...payload, content: '# 不应覆盖\n' } });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(await fs.readFile(path.join(dataDir, 'skills', payload.id, 'SKILL.md'), 'utf8'), payload.content);

  const deleted = await app.inject({ method: 'DELETE', url: `/api/skills/${payload.id}` });
  assert.equal(deleted.statusCode, 200);
  const missing = await app.inject({ method: 'DELETE', url: `/api/skills/${payload.id}` });
  assert.equal(missing.statusCode, 404);
});

test('deleting a skill referenced by an agent returns a conflict and keeps the skill', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-skills-reference-'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'skills', 'used-skill'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'skills', 'used-skill', 'config.json'), JSON.stringify({
    id: 'used-skill', name: 'Used skill', description: '', category: 'test', version: '1.0.0', author: 'test',
  }));
  await fs.writeFile(path.join(dataDir, 'skills', 'used-skill', 'SKILL.md'), '# Used skill\n');
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-1': { id: 'agent-1', name: 'Worker', config: { skills: ['used-skill'] } },
  }));

  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(skillsRoutes, { prefix: '/api/skills' });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await app.inject({ method: 'DELETE', url: '/api/skills/used-skill' });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json().agents, [{ id: 'agent-1', name: 'Worker' }]);
  await fs.access(path.join(dataDir, 'skills', 'used-skill', 'SKILL.md'));
});
