/**
 * SSE 工具函数 — 统一封装供所有路由复用
 */

import type { FastifyReply } from 'fastify';

/** 初始化 SSE 响应头 */
export function initSSE(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

/** 推送一条 SSE 事件 */
export function pushSSE(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 心跳：每 15 秒发注释行保持连接活跃，返回 stop 函数 */
export function startHeartbeat(reply: FastifyReply): () => void {
  const timer = setInterval(() => {
    try { reply.raw.write(': heartbeat\n\n'); } catch { clearInterval(timer); }
  }, 15_000);
  return () => clearInterval(timer);
}

/** 结束 SSE 流 */
export function endSSE(reply: FastifyReply): void {
  reply.raw.end();
}
