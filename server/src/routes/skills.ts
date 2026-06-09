/**
 * Skills 路由 — 技能列表
 *
 * 迁移自 vite.config.ts 的 skills-api
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  const dataDir = (app as any).dataDir as string;

  // GET /api/skills/list
  app.get('/list', async (_req, reply) => {
    const skillsDir = path.join(dataDir, 'skills');
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true })
        .catch(() => [] as Array<{ name: string; isDirectory(): boolean }>);
      const skills = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const configRaw = await fs.readFile(
            path.join(skillsDir, entry.name, 'config.json'), 'utf-8',
          );
          const meta = JSON.parse(configRaw);
          const hasTools = await fs.access(
            path.join(skillsDir, entry.name, 'tools.json'),
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
