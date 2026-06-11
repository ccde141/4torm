/**
 * 对流 Fastify 路由适配层
 *
 * 直接调用 engine/convection/ 下的业务函数。
 * 对流 HTTP 层很薄，直接在 Fastify 里重写比透传更清晰。
 */

import type { FastifyInstance } from 'fastify';
import {
  createSession, loadSession, saveSession, listSessions,
  deleteSession, renameSession, tryAcquireSessionLock, isAgentInAnySession,
  sessionWorkspace,
} from '../engine/convection/session';
import { handleSpeak, handleChair } from '../engine/convection/handlers';
import type { ConvectionStreamEvent } from '../engine/convection/handlers';
import { loadAgent } from '../engine/shared/agent-loader';
import { callLLM } from '../engine/shared/llm-bridge';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse';
import fs from 'node:fs/promises';
import path from 'node:path';
import { lockAgent, unlockAgent, setPresence, clearPresence } from '../engine/shared/agent-lock';

/** 活跃的轮次 AbortController：sessionId → AbortController */
const activeAborts = new Map<string, AbortController>();

export async function convectionRoutes(app: FastifyInstance): Promise<void> {
  const dataDir = (app as any).dataDir as string;

  // POST /api/convection/create
  app.post('/create', async (req, reply) => {
    const body = req.body as any;
    const { chairAgentId, participantAgentIds, topic, title } = body || {};
    if (!chairAgentId || !Array.isArray(participantAgentIds) || !participantAgentIds.length) {
      return reply.status(400).send({ error: '缺少 chairAgentId 或 participantAgentIds' });
    }
    const allIds = [chairAgentId, ...participantAgentIds];
    for (const id of allIds) {
      await setPresence(dataDir, id, 'convection');
    }
    const session = await createSession(dataDir, { chairAgentId, participantAgentIds, topic, title });
    return reply.send(session);
  });

  // GET /api/convection/list
  app.get('/list', async (_req, reply) => {
    const list = await listSessions(dataDir);
    return reply.send(list);
  });

  // ALL /api/convection/session/:sessionId/:action
  app.all('/session/:sessionId/:action', async (req, reply) => {
    const { sessionId, action } = req.params as any;
    const body = req.body as any;

    if (action === 'status') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      return reply.send(s);
    }

    if (action === 'speak') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      if (!body?.message?.trim()) return reply.status(400).send({ error: '缺少 message' });
      const release = tryAcquireSessionLock(sessionId);
      if (!release) return reply.status(409).send({ error: '该会话正在处理中，请稍后再试' });
      reply.hijack();
      initSSE(reply);
      const stopHB = startHeartbeat(reply);
      const abort = new AbortController();
      activeAborts.set(sessionId, abort);
      const onEvent = (ev: ConvectionStreamEvent) => { pushSSE(reply, ev); };
      try {
        await handleSpeak(dataDir, s, body.message.trim(), onEvent, abort.signal);
        pushSSE(reply, { type: 'done' });
      } catch (e) {
        pushSSE(reply, { type: 'error', message: (e as Error).message });
      } finally {
        activeAborts.delete(sessionId);
        release();
        stopHB();
        endSSE(reply);
      }
      return;
    }

    if (action === 'chair') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      if (!body?.message?.trim()) return reply.status(400).send({ error: '缺少 message' });
      const release = tryAcquireSessionLock(sessionId);
      if (!release) return reply.status(409).send({ error: '该会话正在处理中，请稍后再试' });
      reply.hijack();
      initSSE(reply);
      const stopHB = startHeartbeat(reply);
      const abort = new AbortController();
      activeAborts.set(`${sessionId}:chair`, abort);
      const onEvent = (ev: ConvectionStreamEvent) => { pushSSE(reply, ev); };
      try {
        await handleChair(dataDir, s, body.message.trim(), onEvent, abort.signal);
        pushSSE(reply, { type: 'done' });
      } catch (e) {
        pushSSE(reply, { type: 'error', message: (e as Error).message });
      } finally {
        activeAborts.delete(`${sessionId}:chair`);
        release();
        stopHB();
        endSSE(reply);
      }
      return;
    }

    if (action === 'abort') {
      // 中断 speak 或 chair（speak 优先）
      const ctrl = activeAborts.get(sessionId) || activeAborts.get(`${sessionId}:chair`);
      if (!ctrl) return reply.status(409).send({ error: 'No active round' });
      ctrl.abort();
      return reply.send({ ok: true });
    }

    if (action === 'rename') {
      if (!body?.title?.trim()) return reply.status(400).send({ error: '缺少 title' });
      await renameSession(dataDir, sessionId, body.title.trim());
      return reply.send({ ok: true });
    }

    if (action === 'join') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      if (!body?.agentId) return reply.status(400).send({ error: '缺少 agentId' });
      if (!s.participantAgentIds.includes(body.agentId)) {
        s.participantAgentIds.push(body.agentId);
        await saveSession(dataDir, s);
        await setPresence(dataDir, body.agentId, 'convection');
      }
      return reply.send({ participantAgentIds: s.participantAgentIds });
    }

    if (action === 'leave') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      if (!body?.agentId) return reply.status(400).send({ error: '缺少 agentId' });
      s.participantAgentIds = s.participantAgentIds.filter((x: string) => x !== body.agentId);
      await saveSession(dataDir, s);
      const stillIn = await isAgentInAnySession(dataDir, body.agentId, sessionId);
      if (!stillIn) {
        await clearPresence(dataDir, body.agentId, 'convection');
      }
      return reply.send({ participantAgentIds: s.participantAgentIds });
    }

    if (action === 'reorder') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      if (!Array.isArray(body?.participantAgentIds)) return reply.status(400).send({ error: '缺少 participantAgentIds 数组' });
      s.participantAgentIds = body.participantAgentIds;
      await saveSession(dataDir, s);
      return reply.send({ participantAgentIds: s.participantAgentIds });
    }

    if (action === 'set-chair') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      if (!body?.agentId) return reply.status(400).send({ error: '缺少 agentId' });
      s.chairAgentId = body.agentId;
      await saveSession(dataDir, s);
      return reply.send({ chairAgentId: s.chairAgentId });
    }

    if (action === 'delete') {
      const s = await loadSession(dataDir, sessionId);
      if (s) {
        for (const id of [s.chairAgentId, ...s.participantAgentIds]) {
          const stillIn = await isAgentInAnySession(dataDir, id, sessionId);
          if (!stillIn) await clearPresence(dataDir, id, 'convection');
        }
      }
      await deleteSession(dataDir, sessionId);
      return reply.send({ ok: true });
    }

    if (action === 'edit-message') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      if (typeof body?.index !== 'number' || typeof body?.content !== 'string') {
        return reply.status(400).send({ error: '缺少 index 或 content' });
      }
      if (body.index < 0 || body.index >= s.publicMessages.length) {
        return reply.status(400).send({ error: '索引越界' });
      }
      s.publicMessages[body.index].content = body.content;
      await saveSession(dataDir, s);
      return reply.send({ ok: true });
    }

    if (action === 'delete-message') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      if (typeof body?.index !== 'number') return reply.status(400).send({ error: '缺少 index' });
      if (body.index < 0 || body.index >= s.publicMessages.length) {
        return reply.status(400).send({ error: '索引越界' });
      }
      s.publicMessages.splice(body.index, 1);
      await saveSession(dataDir, s);
      return reply.send({ ok: true });
    }

    if (action === 'reset-context') {
      const s = await loadSession(dataDir, sessionId);
      if (!s) return reply.status(404).send({ error: '会话不存在' });
      const mode: 'clean' | 'summary' = body?.mode === 'summary' ? 'summary' : 'clean';

      // 归档当前所有 publicMessages + chairMessages
      const state = s.compactState ?? { disabled: false, archiveSeq: 0 };
      state.archiveSeq++;
      const wsPath = sessionWorkspace(dataDir, s.id);
      const archiveDir = path.join(wsPath, 'bak');
      const archiveFileName = `${String(state.archiveSeq).padStart(3, '0')}.json`;

      try {
        await fs.mkdir(archiveDir, { recursive: true });
        await fs.writeFile(
          path.join(archiveDir, archiveFileName),
          JSON.stringify({ publicMessages: s.publicMessages, chairMessages: s.chairMessages }, null, 2),
        );
      } catch { /* 归档失败不阻塞 */ }

      let summaryContent = '';
      if (mode === 'summary') {
        // 会长生成极简摘要
        const chairAgent = await loadAgent(dataDir, s.chairAgentId);
        if (chairAgent) {
          try {
            const summaryResult = await callLLM({
              dataDir,
              fullModelKey: chairAgent.model,
              messages: [
                { role: 'system', content: '你是会议主持人。请用 3-5 句话极简概括以下对话的当前状态：做了什么、达成了什么结论、还有什么待完成。直接输出，不加前缀。' },
                { role: 'user', content: s.publicMessages.map(m => `[${m.speaker}] ${m.content}`).join('\n\n') },
              ],
              options: { temperature: 0.3 },
            });
            summaryContent = summaryResult.content.trim();
          } catch { /* 摘要失败则退化为 clean */ }
        }
      }

      // 清空
      s.publicMessages = [];
      s.chairMessages = [];
      s.compactState = state;

      // summary 模式：插入摘要作为起始消息
      if (summaryContent) {
        s.publicMessages.push({
          speaker: '系统',
          content: `[会话归档摘要]\n\n${summaryContent}`,
          timestamp: Date.now(),
        });
      }

      await saveSession(dataDir, s);
      return reply.send({ ok: true, mode, archived: archiveFileName, summary: summaryContent || undefined });
    }

    return reply.status(400).send({ error: `未知 action：${action}` });
  });
}
