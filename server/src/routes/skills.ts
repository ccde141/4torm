/**
 * Skills 路由 — 技能列表
 *
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAppContext } from '../services/app-context.js';
import { atomicWriteFile } from '../engine/shared/atomic-io.js';
import { agentRegistryFile, skillDir, skillsDir as resolveSkillsDir } from '../services/data-paths.js';

const skillWrites = new Map<string, Promise<unknown>>();
async function withSkillWrite<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = skillWrites.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(run);
  skillWrites.set(key, current);
  try { return await current; } finally { if (skillWrites.get(key) === current) skillWrites.delete(key); }
}

function categoryValue(value: unknown): string {
  return typeof value === 'string' && value.trim().length <= 60 ? value.trim() : '';
}

const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function validSkillId(id: unknown): id is string {
  return typeof id === 'string' && SKILL_ID_PATTERN.test(id);
}

interface AgentRegistryEntry {
  id?: unknown;
  name?: unknown;
  config?: { skills?: unknown };
}

async function findSkillReferences(
  dataDir: string,
  skillId: string,
): Promise<Array<{ id: string; name: string }>> {
  let raw: string;
  try {
    raw = await fs.readFile(agentRegistryFile(dataDir), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const registry = JSON.parse(raw) as Record<string, AgentRegistryEntry>;
  return Object.entries(registry)
    .filter(([, entry]) => Array.isArray(entry?.config?.skills) && entry.config.skills.includes(skillId))
    .map(([id, entry]) => ({
      id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : id,
    }));
}

export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  // GET /api/skills/list
  app.get('/list', async (_req, reply) => {
    const skillsRoot = resolveSkillsDir(dataDir);
    try {
      const entries = await fs.readdir(skillsRoot, { withFileTypes: true })
        .catch(() => [] as Array<{ name: string; isDirectory(): boolean }>);
      const skills = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const configRaw = await fs.readFile(
            path.join(skillDir(dataDir, entry.name), 'config.json'), 'utf-8',
          );
          const meta = JSON.parse(configRaw);
          const hasTools = await fs.access(
            path.join(skillDir(dataDir, entry.name), 'tools.json'),
          ).then(() => true).catch(() => false);
          skills.push({ ...meta, id: entry.name, category: categoryValue(meta.category), hasTools });
        } catch { /* skip invalid skill dirs */ }
      }
      return reply.send(skills);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  app.patch('/:skillId/category', async (req, reply) => {
    const { skillId } = req.params as { skillId: string };
    const body = req.body as { category?: unknown; expectedCategory?: unknown } | null;
    if (!validSkillId(skillId) || typeof body?.category !== 'string'
      || body.category.trim().length > 60 || typeof body.expectedCategory !== 'string') {
      return reply.status(400).send({ error: 'SKILL_CATEGORY_INVALID' });
    }
    return withSkillWrite(skillDir(dataDir, skillId), async () => {
      const file = path.join(skillDir(dataDir, skillId), 'config.json');
      let raw: string;
      try { raw = await fs.readFile(file, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.status(404).send({ error: 'SKILL_NOT_FOUND' }); throw error; }
      const meta = JSON.parse(raw);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('SKILL_CONFIG_INVALID');
      if (categoryValue(meta.category) !== body.expectedCategory) return reply.status(409).send({ error: 'SKILL_CATEGORY_CONFLICT' });
      await atomicWriteFile(file, JSON.stringify({ ...meta, category: (body.category as string).trim() }, null, 2));
      return { ok: true };
    });
  });

  // POST /api/skills/create
  app.post('/create', async (req, reply) => {
    const body = req.body as {
      id?: string;
      meta?: Record<string, unknown>;
      content?: string;
    };
    if (!validSkillId(body.id)) {
      return reply.status(400).send({ error: '技能 ID 只能包含小写字母、数字、连字符和下划线' });
    }
    if (!body.meta || typeof body.meta.name !== 'string' || !body.meta.name.trim()) {
      return reply.status(400).send({ error: '缺少技能名称' });
    }
    if (typeof body.content !== 'string') {
      return reply.status(400).send({ error: '缺少 SKILL.md 内容' });
    }

    return withSkillWrite(skillDir(dataDir, body.id), async () => {
      const dir = skillDir(dataDir, body.id!);
      await fs.mkdir(resolveSkillsDir(dataDir), { recursive: true });
      try {
        await fs.mkdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return reply.status(409).send({ error: `技能 ID 已存在：${body.id}` });
        }
        throw error;
      }

      try {
        await atomicWriteFile(path.join(dir, 'config.json'), JSON.stringify({ ...body.meta, id: body.id }, null, 2));
        await atomicWriteFile(path.join(dir, 'SKILL.md'), body.content!);
      } catch (error) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      return reply.status(201).send({ ok: true, id: body.id });
    });
  });

  // DELETE /api/skills/:skillId
  app.delete('/:skillId', async (req, reply) => {
    const { skillId } = req.params as { skillId: string };
    if (!validSkillId(skillId)) {
      return reply.status(400).send({ error: '无效的技能 ID' });
    }
    return withSkillWrite(skillDir(dataDir, skillId), async () => {
      const references = await findSkillReferences(dataDir, skillId);
      if (references.length > 0) {
        return reply.status(409).send({
          error: '技能仍被 Agent 使用，请先取消关联后再移除',
          agents: references,
        });
      }
      try {
        await fs.rm(skillDir(dataDir, skillId), { recursive: true, force: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.status(404).send({ error: '技能不存在' });
        }
        throw error;
      }
      return reply.send({ ok: true });
    });
  });
}
