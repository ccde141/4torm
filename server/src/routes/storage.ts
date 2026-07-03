/**
 * Storage API 路由 — 文件 CRUD
 *
 * 迁移自 vite.config.ts 的 storage-api 中间件。
 * 保持接口完全兼容，前端无需改动。
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSafePath } from '../utils/path-guard.js';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

export async function storageRoutes(app: FastifyInstance): Promise<void> {
  // 注：本文件里 (req.query as any).path、req.body、(app as any).dataDir 的 as any 均为 Fastify
  // HTTP / 装饰器边界的**有意转型**——请求载荷在校验前没有静态类型。安全性不靠类型，而靠
  // resolveSafePath 统一做路径越界防护（见每个 handler）。非"类型随意"。
  const dataDir = (app as any).dataDir as string;

  // GET /api/storage/read?path=xxx
  app.get('/read', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    try {
      const resolved = resolveSafePath(dataDir, filePath);
      const raw = await fs.readFile(resolved, 'utf-8');
      if (resolved.endsWith('.json')) {
        reply.header('Content-Type', 'application/json');
      } else {
        reply.header('Content-Type', 'text/plain; charset=utf-8');
      }
      return reply.send(raw);
    } catch {
      return reply.status(404).send({ error: '文件不存在' });
    }
  });

  // GET /api/storage/file?path=xxx — 二进制安全读取（图片等）
  // 与 /read 区别：返回 Buffer 不做 utf-8 解码，按扩展名设 Content-Type
  app.get('/file', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    try {
      const resolved = resolveSafePath(dataDir, filePath);
      const buf = await fs.readFile(resolved);
      reply.header('Content-Type', mimeFromExt(resolved));
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(buf);
    } catch {
      return reply.status(404).send({ error: '文件不存在' });
    }
  });

  // PUT /api/storage/write?path=xxx
  app.put('/write', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    const resolved = resolveSafePath(dataDir, filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    // Fastify 自动解析 JSON body 为对象，需要 stringify 回 string
    const raw = req.body;
    const body = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    // 唯一临时名 + 原子 rename：并发写同一文件（如会话队列多次保存 _index.json）不能共用
    // 同一个 .tmp，否则两次写交错后 rename 出「短内容盖长文件、尾部残留旧字节」的损坏 JSON。
    const tmp = `${resolved}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      await fs.writeFile(tmp, body, 'utf-8');
      await fs.rename(tmp, resolved);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    return reply.send({ ok: true });
  });

  // PUT /api/storage/upload?path=xxx (base64 binary)
  app.put('/upload', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    const resolved = resolveSafePath(dataDir, filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const body = req.body as string || '';
    if (!body) {
      return reply.status(400).send({ error: '缺少文件数据' });
    }
    await fs.writeFile(resolved, Buffer.from(body, 'base64'));
    return reply.send({ ok: true });
  });

  // DELETE /api/storage/delete?path=xxx
  app.delete('/delete', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    try {
      const resolved = resolveSafePath(dataDir, filePath);
      await fs.rm(resolved, { recursive: true, force: true });
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ error: `删除失败: ${(e as Error).message}` });
    }
  });

  // POST /api/storage/mkdir?path=xxx
  app.post('/mkdir', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    const resolved = resolveSafePath(dataDir, filePath);
    await fs.mkdir(resolved, { recursive: true });
    return reply.send({ ok: true });
  });
}
