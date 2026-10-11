/**
 * SSE 工具函数 — 统一封装供所有路由复用
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { frameworkSseErrorFromUnknown } from '../engine/shared/framework-error-transport.js';

/** Shared browser-origin boundary for ordinary HTTP and hijacked SSE responses. */
export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  const port = Number.parseInt(process.env.PORT || '3001', 10);
  return origin === 'http://localhost:5173'
    || origin === 'http://127.0.0.1:5173'
    || origin === `https://localhost:${port}`
    || origin === `https://127.0.0.1:${port}`
    || origin === configuredRendererOrigin();
}

function configuredRendererOrigin(): string | undefined {
  const raw = process.env.ELECTRON_RENDERER_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function localCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow: boolean) => void,
): void {
  callback(null, isAllowedLocalOrigin(origin));
}

/** CORS headers alone do not stop simple cross-site writes; reject explicit foreign origins. */
export async function enforceLocalBrowserOrigin(
  request: FastifyRequest, reply: FastifyReply,
): Promise<void> {
  const origin = request.headers.origin;
  if (origin && !isAllowedLocalOrigin(origin)) {
    reply.code(403).send({ error: '来源不受信任', errorCode: 'ORIGIN_NOT_ALLOWED' });
  }
}

export function sseResponseHeaders(httpVersionMajor: number, origin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  };
  if (httpVersionMajor < 2) headers.Connection = 'keep-alive';
  if (origin && isAllowedLocalOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  }
  return headers;
}

/** 初始化 SSE 响应头 */
export function initSSE(reply: FastifyReply): void {
  // reply.hijack() / writeHead 绕过了 @fastify/cors 的 hook，跨 origin 直连
  // （dev 下前端直连 HTTPS/2 后端）会因缺 CORS 头被浏览器拦截 → fetch 抛
  // Failed to fetch。这里复用普通 HTTP 的本机来源边界，绝不直接回显 Origin。
  const origin = reply.request.headers.origin;
  reply.raw.writeHead(200, sseResponseHeaders(reply.request.raw.httpVersionMajor, origin));
}

/** 推送一条 SSE 事件 */
export function pushSSE(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 推送统一错误帧；旧 type/message 保持不变，新增 code/kind。 */
export function pushSSEError(
  reply: FastifyReply,
  error: unknown,
  source: string,
): void {
  pushSSE(reply, frameworkSseErrorFromUnknown(error, source));
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
