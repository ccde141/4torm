/**
 * Skin 静态文件路由 — 提供 data/skin/ 下的图片资源
 *
 * 迁移自 vite.config.ts 的 skin-static 中间件。
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAppContext } from '../services/app-context.js';
import { skinDir as resolveSkinDir } from '../services/data-paths.js';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export async function skinRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);
  const skinRoot = resolveSkinDir(dataDir);

  // GET /skin/*
  app.get('/*', async (req, reply) => {
    const relativePath = (req.params as any)['*'] || '';
    if (!relativePath) {
      return reply.status(400).send({ error: '缺少文件路径' });
    }

    const filePath = path.resolve(skinRoot, relativePath);
    // 安全检查：不允许路径穿越
    if (!filePath.startsWith(skinRoot)) {
      return reply.status(403).send({ error: '路径越界' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext];
    if (!mime) {
      return reply.status(415).send({ error: '不支持的文件类型' });
    }

    try {
      const data = await fs.readFile(filePath);
      reply.header('Content-Type', mime);
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(data);
    } catch {
      return reply.status(404).send({ error: '文件不存在' });
    }
  });
}
