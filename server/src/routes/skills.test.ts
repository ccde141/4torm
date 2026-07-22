import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { skillsRoutes } from './skills.js';

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
