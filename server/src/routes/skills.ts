/**
 * Skills 路由 — 技能列表
 *
 * 迁移自 vite.config.ts 的 skills-api
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAppContext } from '../services/app-context.js';
import { skillDir, skillsDir as resolveSkillsDir } from '../services/data-paths.js';

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
          skills.push({ id: entry.name, ...meta, hasTools });
        } catch { /* skip invalid skill dirs */ }
      }
      return reply.send(skills);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });
}
