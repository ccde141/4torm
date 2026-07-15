/**
 * 普通会话 Fastify 路由
 *
 * 端点：
 * - POST /api/conversation/chat   — 发消息（SSE 流式返回）
 * - POST /api/conversation/abort   — 中止当前执行
 *
 * 注：危险工具二次确认机制已移除。
 */

import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { SessionRunner, type ConversationEvent, type SessionRunnerOpts } from '../engine/conversation/session-runner';
import { loadAgent } from '../engine/shared/agent-loader';
import { loadAgentToolDefs } from '../engine/shared/tool-defs-loader';
import { buildConversationSystemPrompt } from '../engine/conversation/prompt-builder';
import { resolveNativeMode } from '../engine/shared/llm-bridge';
import { withAgentTurn } from '../engine/shared/agent-queue';
import type { ContextMessage } from '../engine/shared/types';

// ── 活跃 runner 注册表（内存级） ─────────────────────────────────

const activeRunners = new Map<string, SessionRunner>();

function getOrCreateRunner(sessionId: string, opts: SessionRunnerOpts): SessionRunner {
  let runner = activeRunners.get(sessionId);
  // 季风临时切模型：缓存 runner 的 model 定死在构造时，model 变化且未在跑时按新 opts 重建，
  // 否则新选的模型会被旧 runner 吞掉。跑到一半不重建（isBusy 已在上层 409 拦）。
  if (runner && !runner.isBusy() && runner.getModel() !== opts.model) {
    runner = undefined;
  }
  if (!runner) {
    runner = new SessionRunner(opts);
    activeRunners.set(sessionId, runner);
  }
  return runner;
}

// ── SSE 工具函数 ─────────────────────────────────────────────────

function initSSE(raw: ServerResponse, origin?: string): void {
  raw.statusCode = 200;
  raw.setHeader('Content-Type', 'text/event-stream');
  raw.setHeader('Cache-Control', 'no-cache');
  raw.setHeader('Connection', 'keep-alive');
  raw.setHeader('X-Accel-Buffering', 'no');
  // 关键：关闭 Nagle 算法。直连裸 socket 时，单个小事件（如 delegate-start）后接
  // 长时间近静默的 sub-agent 执行，数据会滞留在内核发送缓冲，直到后续字节累积才发出
  // ——表现为「卡片直到 agent 收尾/手动停止才蹦出来」。高频 token 流因持续有字节而不受影响。
  raw.socket?.setNoDelay(true);
  // reply.hijack() 绕过了 @fastify/cors 的 hook，跨 origin 直连（dev 下前端直连
  // 3001 分摊连接）会因缺 CORS 头被浏览器拦截 → fetch 抛 Failed to fetch。
  // 这里手动回显 Origin（等价 cors origin:true）补回。
  if (origin) {
    raw.setHeader('Access-Control-Allow-Origin', origin);
    raw.setHeader('Access-Control-Allow-Credentials', 'true');
    raw.setHeader('Vary', 'Origin');
  }
  // 所有响应头（含上面的 CORS）设置完毕后再 flush，否则 CORS 头发不出去 →
  // 浏览器拦截跨 origin 响应 → Failed to fetch。顺序至关重要。
  raw.flushHeaders?.();
  raw.write(': connected\n\n');
}

function pushSSE(raw: ServerResponse, ev: ConversationEvent): void {
  raw.write(`data: ${JSON.stringify(ev)}\n\n`);
}

// ── 路由注册 ─────────────────────────────────────────────────────

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  const dataDir = (app as any).dataDir as string;

  // ── POST /api/conversation/chat（SSE 流式） ──
  app.post('/chat', async (req, reply) => {
    const body = req.body as {
      sessionId?: string;
      agentId?: string;
      model?: string;
      messages?: Array<{
        role: string;
        content: string;
        /** 原生模式历史回灌：assistant 携带的工具调用 */
        toolCalls?: import('../engine/shared/types').NativeToolCall[];
        /** 原生模式历史回灌：tool 结果消息配对 id */
        toolCallId?: string;
      }>;
    };

    if (!body.sessionId || !body.agentId || !Array.isArray(body.messages)) {
      return reply.status(400).send({ error: '缺少 sessionId / agentId / messages' });
    }

    const agent = await loadAgent(dataDir, body.agentId);
    if (!agent) {
      return reply.status(404).send({ error: `Agent 不存在：${body.agentId}` });
    }

    // 前端选择器可覆盖 agent 默认模型；缺省回落 agent.model
    const effectiveModel = body.model || agent.model;

    // 决议原生模式：读 provider 的 nativeMode + nativeProbe 缓存
    const nativeDecision = await resolveNativeMode(dataDir, effectiveModel);
    console.log(`[conversation] ${agent.name} (${effectiveModel}) → native=${nativeDecision.native} mode=${nativeDecision.mode}`);

    const opts: SessionRunnerOpts = {
      dataDir,
      agentId: agent.id,
      model: effectiveModel,
      temperature: agent.temperature,
      toolNames: agent.tools || [],
      skillIds: agent.skills || [],
      workspace: agent.workspace,
      sandboxLevel: agent.sandboxLevel,
      sessionId: body.sessionId,
      native: nativeDecision.native,
    };

    const runner = getOrCreateRunner(body.sessionId, opts);
    if (runner.isBusy()) {
      return reply.status(409).send({ error: '会话正在执行中' });
    }

    // 构建 system prompt
    const projectDir = path.resolve(dataDir, '..');
    const workspaceAbs = path.resolve(projectDir, agent.workspace);
    const toolDefs = await loadAgentToolDefs(dataDir, opts.toolNames, opts.skillIds);
    const lastUserMsg = body.messages.filter(m => m.role === 'user').pop();
    const systemPrompt = await buildConversationSystemPrompt({
      rolePrompt: agent.rolePrompt || '',
      toolDefs,
      workspace: opts.workspace,
      workspaceAbs,
      projectDir,
      sandboxLevel: agent.sandboxLevel,
      skillIds: opts.skillIds,
      dataDir,
      agentId: agent.id,
      sessionId: body.sessionId,
      userMessage: lastUserMsg?.content,
      native: nativeDecision.native,
    });

    // 构造 chatMessages（system + 历史）
    const chatMessages: ContextMessage[] = [
      { role: 'system', content: systemPrompt },
      // 保留 toolCalls / toolCallId / role:'tool'——native 历史回灌，让 agent
      // 跨轮次仍能看到自己上一轮的工具调用与工具返回原文（llm-bridge 已能序列化）。
      ...body.messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
        ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      })),
    ];

    // SSE 流式响应
    reply.hijack();
    const raw = reply.raw;
    initSSE(raw, req.headers.origin);

    // 强制 native 但探测显示不支持 → 显式警告（不阻断，仍按用户选择执行）
    if (nativeDecision.forcedMismatch) {
      pushSSE(raw, { type: 'notice', message: '⚠️ 该模型配置为强制原生工具调用（native），但探测显示其可能不支持。如遇工具调用异常，请在「模型提供商设置」中改为 auto 或 text 模式。' });
    }

    // 按 Agent 串行：同一 Agent 被多个会话/功能区同时驱动时，自动排队依次执行，
    // 避免并发读写同一 workspace / 记忆库。排队等待时推送一次提示。
    withAgentTurn(body.agentId!, () => runner.chat(systemPrompt, chatMessages, (ev) => {
      try { pushSSE(raw, ev); } catch { runner.abort(); }
    }), {
      onWait: () => { try { pushSSE(raw, { type: 'notice', message: '该 Agent 正被其他会话占用，已排队，轮到即自动开始…' }); } catch {} },
    }).then(() => {
      try { raw.end(); } catch {}
      // 非挂起（ask 等 reply）才清出注册表，否则 /reply 找不到 runner。
      // 不清会导致 activeRunners 内存泄漏（每个聊过的 session 永久驻留）。
      if (!runner.isSuspended()) activeRunners.delete(body.sessionId!);
    }).catch((e) => {
      try {
        pushSSE(raw, { type: 'error', message: (e as Error).message });
        raw.end();
      } catch {}
      activeRunners.delete(body.sessionId!); // 出错必清
    });
  });

  // ── POST /api/conversation/abort ──
  app.post('/abort', async (req, reply) => {
    const body = req.body as { sessionId?: string };

    if (!body.sessionId) {
      return reply.status(400).send({ error: '缺少 sessionId' });
    }

    const runner = activeRunners.get(body.sessionId);
    if (!runner) {
      return reply.status(404).send({ error: '会话不存在或已结束' });
    }

    runner.abort();
    // 挂起中（等 reply）的 runner abort 是空操作、chat 的 catch 不会触发清理，
    // 这里显式删除避免永久驻留；正在流式的 runner catch 也会删（幂等无害）。
    activeRunners.delete(body.sessionId);
    return reply.send({ ok: true });
  });

  // ── POST /api/conversation/reply（恢复 ask 挂起） ──
  app.post('/reply', async (req, reply) => {
    const body = req.body as { sessionId?: string; answer?: string };

    if (!body.sessionId || typeof body.answer !== 'string') {
      return reply.status(400).send({ error: '缺少 sessionId / answer' });
    }

    const runner = activeRunners.get(body.sessionId);
    if (!runner) {
      return reply.status(404).send({ error: '会话不存在或已结束' });
    }
    if (!runner.isSuspended()) {
      return reply.status(409).send({ error: '会话未处于挂起状态' });
    }

    // SSE 流式响应（resume 后 agent 继续执行）
    reply.hijack();
    const raw = reply.raw;
    initSSE(raw, req.headers.origin);

    // 同 /chat：恢复执行也走按-Agent 串行队列
    withAgentTurn(runner.getAgentId(), () => runner.resume(body.answer!, (ev) => {
      try { pushSSE(raw, ev); } catch { runner.abort(); }
    }), {
      onWait: () => { try { pushSSE(raw, { type: 'notice', message: '该 Agent 正被其他会话占用，已排队，轮到即自动开始…' }); } catch {} },
    }).then(() => {
      try { raw.end(); } catch {}
      // resume 后可能再次挂起（嵌套 ask）；非挂起才清出注册表
      if (!runner.isSuspended()) activeRunners.delete(body.sessionId!);
    }).catch((e) => {
      try {
        pushSSE(raw, { type: 'error', message: (e as Error).message });
        raw.end();
      } catch {}
      activeRunners.delete(body.sessionId!); // 出错必清
    });
  });
}
