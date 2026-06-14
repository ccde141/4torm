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
import type { ContextMessage } from '../engine/shared/types';

// ── 活跃 runner 注册表（内存级） ─────────────────────────────────

const activeRunners = new Map<string, SessionRunner>();

function getOrCreateRunner(sessionId: string, opts: SessionRunnerOpts): SessionRunner {
  let runner = activeRunners.get(sessionId);
  if (!runner) {
    runner = new SessionRunner(opts);
    activeRunners.set(sessionId, runner);
  }
  return runner;
}

// ── SSE 工具函数 ─────────────────────────────────────────────────

function initSSE(raw: ServerResponse): void {
  raw.statusCode = 200;
  raw.setHeader('Content-Type', 'text/event-stream');
  raw.setHeader('Cache-Control', 'no-cache');
  raw.setHeader('Connection', 'keep-alive');
  raw.setHeader('X-Accel-Buffering', 'no');
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
      messages?: Array<{ role: string; content: string }>;
    };

    if (!body.sessionId || !body.agentId || !Array.isArray(body.messages)) {
      return reply.status(400).send({ error: '缺少 sessionId / agentId / messages' });
    }

    const agent = await loadAgent(dataDir, body.agentId);
    if (!agent) {
      return reply.status(404).send({ error: `Agent 不存在：${body.agentId}` });
    }

    const opts: SessionRunnerOpts = {
      dataDir,
      agentId: agent.id,
      model: agent.model,
      temperature: agent.temperature,
      toolNames: agent.tools || [],
      skillIds: agent.skills || [],
      workspace: agent.workspace,
      sandboxLevel: agent.sandboxLevel,
      native: true, // Phase 2：季风写死走原生工具调用
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
      userMessage: lastUserMsg?.content,
      native: true, // Phase 2：季风写死走原生工具调用
    });

    // 构造 chatMessages（system + 历史）
    const chatMessages: ContextMessage[] = [
      { role: 'system', content: systemPrompt },
      ...body.messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ];

    // SSE 流式响应
    reply.hijack();
    const raw = reply.raw;
    initSSE(raw);

    runner.chat(systemPrompt, chatMessages, (ev) => {
      try { pushSSE(raw, ev); } catch { runner.abort(); }
    }).then(() => {
      try { raw.end(); } catch {}
    }).catch((e) => {
      try {
        pushSSE(raw, { type: 'error', message: (e as Error).message });
        raw.end();
      } catch {}
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
    initSSE(raw);

    runner.resume(body.answer, (ev) => {
      try { pushSSE(raw, ev); } catch { runner.abort(); }
    }).then(() => {
      try { raw.end(); } catch {}
    }).catch((e) => {
      try {
        pushSSE(raw, { type: 'error', message: (e as Error).message });
        raw.end();
      } catch {}
    });
  });
}
