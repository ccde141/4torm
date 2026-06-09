/**
 * LLM Proxy 路由 — 反向代理到本地 LLM 服务
 *
 * 迁移自 vite.config.ts 的 llm-proxy 中间件。
 * URL 格式：/api/llm/{port}/{targetPath...}
 */

import type { FastifyInstance } from 'fastify';

export async function llmProxyRoutes(app: FastifyInstance): Promise<void> {

  // ANY /api/llm/:port/*
  app.all('/:port/*', async (req, reply) => {
    const port = (req.params as any).port;
    const targetPath = (req.params as any)['*'] || '';
    const targetUrl = `http://localhost:${port}/${targetPath}`;

    try {
      const headers: Record<string, string> = {};
      // 透传关键请求头
      if (req.headers['content-type']) {
        headers['Content-Type'] = req.headers['content-type'] as string;
      }
      if (req.headers['authorization']) {
        headers['Authorization'] = req.headers['authorization'] as string;
      }

      const fetchOpts: RequestInit = {
        method: req.method,
        headers,
      };

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const body = req.body;
        fetchOpts.body = typeof body === 'string'
          ? body
          : JSON.stringify(body);
      }

      const res = await fetch(targetUrl, fetchOpts);

      reply.status(res.status);
      // 透传响应头
      for (const [k, v] of res.headers.entries()) {
        if (k.toLowerCase() !== 'transfer-encoding') {
          reply.header(k, v);
        }
      }

      const resBody = await res.text();
      return reply.send(resBody);
    } catch (e) {
      return reply.status(502).send({
        error: `代理失败: ${(e as Error).message}`,
      });
    }
  });
}
