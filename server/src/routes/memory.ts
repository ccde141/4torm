/**
 * Agent 长期记忆路由 —— 人类在控制台查看/编辑 agent 记忆
 *
 * 复用 shared/agent-memory 的解析与读写（单一来源，不在前端重复解析
 * frontmatter / index 行，避免格式漂移）。前端只见干净 JSON。
 *
 * 注册前缀：/api/memory
 */

import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import {
  listMemoryFull,
  writeMemory,
  updateMemory,
  deleteMemory,
  type MemoryCategory,
} from '../engine/shared/agent-memory.js';

const CATEGORIES: MemoryCategory[] = ['feedback', 'fact', 'pitfall', 'reference'];
function coerceCategory(v: unknown): MemoryCategory | undefined {
  return typeof v === 'string' && (CATEGORIES as string[]).includes(v) ? (v as MemoryCategory) : undefined;
}
function coerceTags(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  return undefined;
}

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  // GET /api/memory/list?agentId=xxx — 列全部条目（含全文）
  app.get('/list', async (req, reply) => {
    const agentId = (req.query as { agentId?: string })?.agentId;
    if (!agentId) return reply.status(400).send({ error: '缺少 agentId' });
    try {
      return reply.send(await listMemoryFull(dataDir, agentId));
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  // POST /api/memory/create { agentId, detail, category?, tags?, summary? } — 人工新增
  // 人只需给 detail（正文）；summary 省略时系统兜底、等 agent 精炼。
  app.post('/create', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const agentId = b?.agentId as string;
    const detail = String(b?.detail || '').trim();
    if (!agentId || !detail) return reply.status(400).send({ error: 'agentId/detail 必填' });
    try {
      const summary = typeof b?.summary === 'string' && b.summary.trim() ? b.summary.trim() : undefined;
      const r = await writeMemory(dataDir, agentId, {
        summary, detail,
        category: coerceCategory(b?.category) ?? 'fact',
        tags: coerceTags(b?.tags) ?? [],
        source: 'human', now: new Date().toISOString(),
      });
      return reply.send(r);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  // POST /api/memory/update { agentId, slug, summary?, detail?, category?, tags? } — 人工编辑
  app.post('/update', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const agentId = b?.agentId as string;
    const slug = b?.slug as string;
    if (!agentId || !slug) return reply.status(400).send({ error: 'agentId/slug 必填' });
    try {
      const entry = await updateMemory(dataDir, agentId, slug, {
        summary: typeof b?.summary === 'string' ? b.summary : undefined,
        detail: typeof b?.detail === 'string' ? b.detail : undefined,
        category: coerceCategory(b?.category),
        tags: coerceTags(b?.tags),
        now: new Date().toISOString(),
      });
      if (!entry) return reply.status(404).send({ error: '条目不存在' });
      return reply.send(entry);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  // POST /api/memory/delete { agentId, slug } — 人工删除
  app.post('/delete', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const agentId = b?.agentId as string;
    const slug = b?.slug as string;
    if (!agentId || !slug) return reply.status(400).send({ error: 'agentId/slug 必填' });
    try {
      await deleteMemory(dataDir, agentId, slug);
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });
}
