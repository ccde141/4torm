/**
 * Chat API 路由 — 普通对话辅助功能
 *
 * POST /api/chat/compact — 上下文压缩（SSE 流式返回摘要）
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { callLLM } from '../engine/shared/llm-bridge.js';
import { loadAgent } from '../engine/shared/agent-loader.js';
import { initSSE, pushSSE, endSSE } from '../utils/sse.js';

const COMPACT_SYSTEM_PROMPT = `你是一个工程对话压缩器。将开发对话压缩为结构化工作摘要，供后续对话恢复上下文。

## 输出格式

按以下分区输出，用 ## 标题分隔。无内容的分区省略。

## Goal
1-2 句话描述用户的总体目标或当前任务方向。

## Constraints & Preferences
用户明确表达的约束条件、偏好、风格要求。

## Progress
### Done
已完成事项，- 开头逐条列出。必须保留：具体文件路径、函数名/变量名/类名、改动本质（不是"修改了文件"而是"把 X 从同步改为异步"）、commit hash（如提到）。

### In Progress
正在进行但未完成的事项。

### Blocked
被阻塞或待确认的事项，附原因。

## Key Decisions
重要技术决策和取舍（架构选择、方案对比结论、被否决的方案及原因）。

## Next Steps
对话中明确提到的后续计划。

## Critical Context
不属于以上分类但对继续工作至关重要的信息（环境配置、端口号、第三方服务状态、已知 bug、运行时行为等）。

## Relevant Files
当前任务涉及的关键文件路径列表，可附简短说明。

## 规则
- 保留所有具体标识符（文件路径、函数名、变量名、端口号、错误码、commit hash），这些是恢复上下文的关键
- 不要泛化，用精确信息替代模糊总结
- 不要包含寒暄、情绪、礼貌用语
- 输出语言以人类消息中的自然语言为准（忽略代码块中的语言）
- 信息完整性优先，不设字数上限`;

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  agentId: string;
  [key: string]: unknown;
}

interface ChatSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  systemPrompt: string;
  masterPrompt?: string;
  rolePrompt?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const dataDir = (app as any).dataDir as string;

  // POST /api/chat/compact (SSE)
  app.post('/compact', async (req, reply) => {
    const body = req.body as {
      agentId?: string; sessionId?: string; model?: string;
    };
    const { agentId, sessionId, model } = body;

    if (!agentId || !sessionId) {
      return reply.status(400).send({ error: '缺少 agentId 或 sessionId' });
    }

    // 读会话文件
    const sessionFile = path.join(dataDir, 'agents', agentId, 'sessions', `${sessionId}.json`);
    let session: ChatSession;
    try {
      const raw = await fs.readFile(sessionFile, 'utf-8');
      session = JSON.parse(raw) as ChatSession;
    } catch {
      return reply.status(404).send({ error: '会话不存在' });
    }

    const msgs = session.messages;
    // 找最后一个 compact-marker
    let lastMarkerIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].type === 'compact-marker') { lastMarkerIdx = i; break; }
    }
    const compressStart = lastMarkerIdx + 1;
    const tail = msgs.slice(compressStart);

    // 估算 tail 区间的 token 数（中文 0.6/字，英文 0.3/字）
    const estimateTokens = (text: string): number => {
      let total = 0;
      for (const ch of text) {
        const code = ch.charCodeAt(0);
        if (code >= 0x4E00 && code <= 0x9FFF) total += 0.6;
        else if (code >= 0x3040 && code <= 0x30FF) total += 0.6;
        else if (code >= 0xAC00 && code <= 0xD7AF) total += 0.6;
        else total += 0.3;
      }
      return Math.ceil(total);
    };
    const tailTokens = tail.reduce((sum, m) => sum + estimateTokens(m.content), 0);

    if (tailTokens < 8000) {
      return reply.status(400).send({ error: `当前上下文约 ${tailTokens} token，不足 8000，无需压缩` });
    }

    const keep = tail.slice(-4);
    const old = tail.slice(0, -4);
    const dialogText = old
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const label = m.role === 'user' ? '用户' : '助手';
        return `${label}: ${m.content}`;
      })
      .join('\n\n');

    if (!dialogText.trim()) {
      return reply.status(400).send({ error: '没有可压缩的对话内容' });
    }

    // 确定模型
    let fullModelKey = model || session.model;
    if (!fullModelKey) {
      const agent = await loadAgent(dataDir, agentId);
      if (!agent) return reply.status(404).send({ error: 'Agent 不存在' });
      fullModelKey = agent.model;
    }
    if (!fullModelKey) {
      return reply.status(400).send({ error: '无法确定模型，请配置 Agent 模型' });
    }

    // hijack 防止 Fastify async handler 在 await 结束后 auto-send 截断 SSE 流
    reply.hijack();

    // 开启 SSE 流
    initSSE(reply);
    const compressedCount = old.length;
    pushSSE(reply, { type: 'start', compressedCount });

    // 流式调 LLM 生成摘要
    let summary = '';
    try {
      const result = await callLLM({
        dataDir,
        fullModelKey,
        messages: [
          { role: 'system', content: COMPACT_SYSTEM_PROMPT },
          { role: 'user', content: dialogText },
        ],
        options: { temperature: 0.1, maxTokens: 10000 },
        onChunk: (chunk) => { pushSSE(reply, { type: 'token', content: chunk }); },
      });
      summary = result.content;
    } catch (e) {
      pushSSE(reply, { type: 'error', error: (e as Error).message });
      endSSE(reply);
      return;
    }

    // 构造 compact-marker 插入消息列表
    const marker: ChatMessage = {
      id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      type: 'compact-marker',
      content: summary,
      timestamp: new Date().toISOString(),
      agentId,
    };

    const insertIdx = compressStart + old.length;
    const newMessages = [
      ...msgs.slice(0, insertIdx),
      marker,
      ...msgs.slice(insertIdx),
    ];

    session.messages = newMessages;
    session.updatedAt = new Date().toISOString();
    await fs.writeFile(sessionFile, JSON.stringify(session, null, 2), 'utf-8');

    pushSSE(reply, { type: 'done', markerId: marker.id, markerIdx: insertIdx });
    endSSE(reply);
  });
}