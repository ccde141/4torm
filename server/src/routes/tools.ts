/**
 * Tools + Skills 路由
 *
 * 迁移自 vite.config.ts 的 tool-executor / skills-api。
 * 注：permissions 端点已移除（危险工具二次确认机制废弃）。
 */

import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import { executeTool } from '../services/tool-executor.js';

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  // POST /api/tools/exec
  app.post('/exec', async (req, reply) => {
    const body = req.body as any;
    if (!body || !body.tool) {
      return reply.status(400).send({ error: '缺少 tool 参数' });
    }
    const { tool, args, agentId, workspaceDirOverride, sandboxLevelOverride } = body;
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    try {
      let meta: unknown;
      const result = await executeTool(
        dataDir, tool, args || {}, agentId || '', workspaceDirOverride, sandboxLevelOverride,
        (m) => { meta = m; },
        controller.signal,
      );
      return reply.send({ result, meta });
    } catch (e) {
      if (controller.signal.aborted) return;
      return reply.status(500).send({ error: (e as Error).message });
    } finally {
      req.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', abort);
    }
  });
}
