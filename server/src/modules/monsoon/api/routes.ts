/**
 * 普通会话 Fastify 路由
 *
 * 端点：
 * - POST /api/conversation/chat   — 发消息（SSE 流式返回）
 * - POST /api/collaboration/invoke — 通过统一控制面中止当前执行
 *
 * 注：危险工具二次确认机制已移除。
 */

import type { FastifyInstance } from 'fastify';
import { logModelDiagnostic } from '../../../config/developer-mode.js';
import { registerConversationTitle } from './title.js';
import { registerConversationInput } from './input.js';
import { registerConversationTeam } from './team.js';
import { conversationAttachmentRoutes } from './attachments.js';
import type { ServerResponse } from 'node:http';
import { runMonsoonTurnStream } from './turn-stream.js';
import { sseResponseHeaders } from '../../../utils/sse.js';
import type { MonsoonFeature } from './factory.js';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { humanContext } from '../../../routes/collaboration-context.js';
import { registerMonsoonSessions } from './sessions.js';
import { registerMonsoonCompaction } from './compaction.js';
import type { MonsoonTurnExecution } from '../application/turn-service.js';

// ── SSE 工具函数 ─────────────────────────────────────────────────

function initSSE(raw: ServerResponse, httpVersionMajor: number, origin?: string): void {
  raw.statusCode = 200;
  for (const [name, value] of Object.entries(sseResponseHeaders(httpVersionMajor, origin))) {
    raw.setHeader(name, value);
  }
  // 关键：关闭 Nagle 算法。直连裸 socket 时，单个小事件（如 delegate-start）后接
  // 长时间近静默的 sub-agent 执行，数据会滞留在内核发送缓冲，直到后续字节累积才发出
  // ——表现为「卡片直到 agent 收尾/手动停止才蹦出来」。高频 token 流因持续有字节而不受影响。
  if (httpVersionMajor < 2) raw.socket?.setNoDelay(true);
  // reply.hijack() 绕过了 @fastify/cors 的 hook，跨 origin 直连（dev 下前端直连
  // HTTPS/2 端口）会因缺 CORS 头被浏览器拦截 → fetch 抛 Failed to fetch。
  // 这里复用共享 SSE 头部的本机来源白名单，不直接回显任意 Origin。
  // 所有响应头（含上面的 CORS）设置完毕后再 flush，否则 CORS 头发不出去 →
  // 浏览器拦截跨 origin 响应 → Failed to fetch。顺序至关重要。
  raw.flushHeaders?.();
}

// ── 路由注册 ─────────────────────────────────────────────────────

export interface ConversationRouteOptions {
  feature: MonsoonFeature;
  router: CollaborationRouter;
}

export async function monsoonRoutes(
  app: FastifyInstance,
  options: ConversationRouteOptions,
): Promise<void> {
  const runtime = options.feature.runtime;
  app.addHook('onClose', () => runtime.shutdown());
  registerConversationTitle(app, options.router);
  registerConversationInput(app, options.router);
  registerConversationTeam(app, options.router);
  registerMonsoonSessions(app, options.router);
  registerMonsoonCompaction(app, options.router);
  await conversationAttachmentRoutes(app, { router: options.router });

  // ── POST /api/conversation/chat（SSE 流式） ──
  app.post('/chat', async (req, reply) => {
    const execution = await options.router.prepareTransport(
      'monsoon', 'chat', req.body, humanContext(req),
    ) as MonsoonTurnExecution;
    const detail = execution.description!;
    logModelDiagnostic(`[conversation] ${detail.agentName} (${detail.model}) → tools=${detail.native ? 'structured' : 'text'}`);
    streamTurn(req, reply, options.feature, execution, 'sse.conversation.chat');
  });

  // ── POST /api/conversation/reply（恢复 ask 挂起） ──
  app.post('/reply', async (req, reply) => {
    const execution = await options.router.prepareTransport(
      'monsoon', 'reply', req.body, humanContext(req),
    ) as MonsoonTurnExecution;
    streamTurn(req, reply, options.feature, execution, 'sse.conversation.reply');
  });
}

function streamTurn(
  req: { raw: { httpVersionMajor: number }; headers: { origin?: string } },
  reply: { hijack(): void; raw: ServerResponse },
  feature: MonsoonFeature,
  execution: MonsoonTurnExecution,
  errorSource: string,
): void {
  reply.hijack();
  const raw = reply.raw;
  void runMonsoonTurnStream({
    response: raw, runner: execution.runner, runtime: feature.runtime,
    sessionId: execution.sessionId, runId: execution.runId,
    agentId: execution.agentId, errorSource, record: execution.record,
    replyAcceptance: execution.replyAcceptance,
    open: () => initSSE(raw, req.raw.httpVersionMajor, req.headers.origin),
    execute: execution.execute,
  }).catch(error => {
    raw.destroy();
    console.error('[monsoon] 轮次生命周期失败:', error);
  });
}
