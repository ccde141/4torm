/**
 * SubAgent delegate 路由 — SSE 端点
 *
 * POST /api/chat/delegate
 * 接收主 Agent 的委托请求，启动 SubAgentRunner，通过 SSE 流式返回执行过程。
 */

import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import { runSubAgent } from '../engine/shared/sub-agent-runner.js';
import type { SubAgentEvent } from '../engine/shared/sub-agent-types.js';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse.js';

export async function delegateRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  app.post('/', async (req, reply) => {
    const body = req.body as any;
    const { task, context, systemPrompt, agentId, maxRounds, timeout } = body || {};

    // 参数校验
    if (!task || typeof task !== 'string') {
      return reply.status(400).send({ error: '缺少 task' });
    }
    if (!agentId || typeof agentId !== 'string') {
      return reply.status(400).send({ error: '缺少 agentId' });
    }

    const rounds = typeof maxRounds === 'number' && maxRounds > 0 ? maxRounds : 30;
    const timeoutMs = typeof timeout === 'number' && timeout > 0 ? timeout : 3_600_000;

    // 创建 AbortController
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    // 切换为 SSE 模式
    reply.hijack();
    initSSE(reply);

    // 客户端断开时 abort（监听 response socket，不是 request）
    reply.raw.on('close', () => { if (!ac.signal.aborted) { ac.abort(); clearTimeout(timer); } });

    const stopHB = startHeartbeat(reply);

    const emit = (event: SubAgentEvent) => {
      if (reply.raw.destroyed) return;
      pushSSE(reply, { event: event.type, ...event.data });
    };

    try {
      await runSubAgent({
        task,
        context: context || '',
        systemPrompt: systemPrompt || '你是一个专注执行子任务的助手。',
        agentId,
        dataDir,
        signal: ac.signal,
        timeout: timeoutMs,
        maxRounds: rounds,
        emit,
      });
    } catch {
      // runSubAgent 内部已消化所有错误，这里是最终兜底
      pushSSE(reply, { event: 'error', status: 'error', summary: '未知错误', rounds: 0 });
    } finally {
      clearTimeout(timer);
      stopHB();
      endSSE(reply);
    }
  });
}
