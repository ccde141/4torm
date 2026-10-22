/**
 * Storage API 路由 — 文件 CRUD
 *
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../engine/shared/atomic-io.js';
import { getAppContext } from '../services/app-context.js';
import { resolveSafePath } from '../utils/path-guard.js';
import { migrateSkinVideoConfig } from './skin-config-migration.js';

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
  // 各文件操作在处理路径前调用 resolveSafePath，检查字面相对路径。
  const { dataDir } = getAppContext(app);

  // GET /api/storage/read?path=xxx
  app.get('/read', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    const target = await storageTarget(dataDir, filePath);
    const ownership = target.error;
    if (ownership) return reply.status(403).send({ error: ownership });
    try {
      const resolved = target.resolved;
      const raw = await fs.readFile(resolved, 'utf-8');
      if (resolved.endsWith('.json')) {
        reply.header('Content-Type', 'application/json');
      } else {
        reply.header('Content-Type', 'text/plain; charset=utf-8');
      }
      if (target.relative === 'skin-config.json') {
        try { return reply.send(migrateSkinVideoConfig(JSON.parse(raw))); }
        catch { return reply.send(raw); }
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
    const target = await storageTarget(dataDir, filePath);
    const ownership = target.error;
    if (ownership) return reply.status(403).send({ error: ownership });
    try {
      const resolved = target.resolved;
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
    const target = await storageTarget(dataDir, filePath);
    const ownership = target.error;
    if (ownership) return reply.status(403).send({ error: ownership });
    const resolved = target.resolved;
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    // Fastify 自动解析 JSON body 为对象，需要 stringify 回 string
    const raw = req.body;
    let body = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    if (target.relative === 'skin-config.json') {
      try { body = JSON.stringify(migrateSkinVideoConfig(JSON.parse(body)), null, 2); }
      catch { return reply.status(400).send({ error: '皮肤配置不是有效 JSON' }); }
    }
    await atomicWriteFile(resolved, body);
    return reply.send({ ok: true });
  });

  // PUT /api/storage/upload?path=xxx (base64 binary)
  app.put('/upload', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    const target = await storageTarget(dataDir, filePath);
    const ownership = target.error;
    if (ownership) return reply.status(403).send({ error: ownership });
    const resolved = target.resolved;
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
    const target = await storageTarget(dataDir, filePath, true);
    const ownership = target.error;
    if (ownership) return reply.status(403).send({ error: ownership });
    try {
      const resolved = target.resolved;
      await fs.rm(resolved, { recursive: true, force: true });
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ error: `删除失败: ${(e as Error).message}` });
    }
  });

  // POST /api/storage/mkdir?path=xxx
  app.post('/mkdir', async (req, reply) => {
    const filePath = (req.query as any).path || '';
    const target = await storageTarget(dataDir, filePath);
    const ownership = target.error;
    if (ownership) return reply.status(403).send({ error: ownership });
    const resolved = target.resolved;
    await fs.mkdir(resolved, { recursive: true });
    return reply.send({ ok: true });
  });
}

async function storageTarget(dataDir: string, filePath: string, deleting = false) {
  const lexical = resolveSafePath(dataDir, filePath);
  const [base, resolved] = await Promise.all([canonicalPath(dataDir), canonicalPath(lexical)]);
  const actual = path.relative(base, resolved);
  if (actual === '..' || actual.startsWith(`..${path.sep}`) || path.isAbsolute(actual)) {
    return { resolved, relative: actual, error: '路径越界' };
  }
  const requested = path.relative(path.resolve(dataDir), lexical);
  const names = [requested, actual].map(value => value.replaceAll('\\', '/').toLowerCase() || '.');
  return { resolved, relative: names[1]!, error: names.map(value => ownershipError(value, deleting)).find(Boolean) };
}

async function canonicalPath(target: string): Promise<string> {
  try { return await fs.realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(await canonicalPath(parent), path.basename(target));
  }
}

function ownershipError(normalized: string, deleting: boolean): string | undefined {
  if (normalized === 'providers.json' || normalized === '.') return '模型配置只能通过模型设置接口访问';
  if (isMonsoonOwnedPath(normalized)) return '季风数据只能通过会话接口访问';
  if (isAgentOwnedPath(normalized)) return 'Agent 数据只能通过 Agent 实体接口访问';
  if (deleting && (/^agents(?:\/[^/]+)?$/.test(normalized)
    || /^agents\/[^/]+\/(?:sessions|\.workspace)$/.test(normalized))) {
    return '该目录包含 Agent 或季风数据，请通过对应管理接口删除';
  }
  return undefined;
}

function isMonsoonOwnedPath(normalized: string): boolean {
  return /^agents\/[^/]+\/sessions\/.+/.test(normalized)
    && !/^agents\/[^/]+\/sessions\/[^/]+\.taskboard\.json$/.test(normalized);
}

function isAgentOwnedPath(normalized: string): boolean {
  return normalized === 'agents/registry.json'
    || /^agents\/[^/]+\/\.workspace\/(?:config\.json|role-prompt\.md|memory\.md)$/.test(normalized);
}
