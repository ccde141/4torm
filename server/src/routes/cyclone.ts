/**
 * 气旋工作室 Fastify 路由适配层
 *
 * 直接调用 engine/cyclone/ 下的业务函数。HTTP 层很薄。
 * Phase 0：工作室/工位 CRUD + 工位私聊（chat/resume，SSE 流式）。
 * Phase 1：群聊 CRUD + 拉工位 + 串行发言（speak，SSE 流式）。
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { getAppContext } from '../services/app-context.js';
import {
  createWorkshop, loadWorkshop, listWorkshops, deleteWorkshop, renameWorkshop, setChair,
} from '../engine/cyclone/workshop-store';
import {
  addSeat, loadSeat, saveSeat, deleteSeat, updateSeatRole, resetSeatContext, tryAcquireSeatLock,
} from '../engine/cyclone/seat-store';
import {
  createRoom, loadRoom, saveRoom, deleteRoom, joinRoom, leaveRoom, setRoomParticipants, renameRoom, setRoomMode, tryAcquireRoomLock, resetRoomContext,
} from '../engine/cyclone/room-store';
import { chatSeat, resumeSeat, type SeatEvent } from '../engine/cyclone/seat-runner';
import { chatChair } from '../engine/cyclone/chair-runner';
import { speakInRoom, type RoomEvent } from '../engine/cyclone/room-runner';
import { generateJoinSpeech } from '../engine/cyclone/seat-summary';
import { generateSeatDuty } from '../engine/cyclone/seat-duty';
import type { JoinBehavior } from '../engine/cyclone/types';
import { workshopWorkspace } from '../engine/cyclone/paths';
import { readBulletin, applyBulletinOps, readBulletinHistory, revertBulletinChange, type BulletinOp } from '../engine/cyclone/bulletin';
import { loadAgent } from '../engine/shared/agent-loader';
import { callLLM } from '../engine/shared/llm-bridge';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse';
import { deleteContextMessage, editContextMessage } from '../engine/cyclone/message-mutations';

/** 活跃轮次 AbortController：`${workshopId}/${seatId}` 或 `${workshopId}/room/${roomId}` → ctrl */
const activeAborts = new Map<string, AbortController>();

function isActiveRound(workshopId: string, key: string): boolean {
  return activeAborts.has(`${workshopId}/${key}`) || activeAborts.has(`${workshopId}/room/${key}`);
}

function summaryMessages(messages: Array<{ role?: string; speaker?: string; content?: string; isHuman?: boolean }>): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role || (m.isHuman ? 'user' : m.speaker || 'assistant'),
    content: m.content || '',
  })).filter(m => m.content.trim());
}

async function buildCycloneSummary(subject: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const text = messages.slice(-60).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  if (!text.trim()) return '';
  return `你是一个工程对话压缩器。将以下 ${subject} 对话压缩为结构化工作摘要，供后续对话恢复上下文。

## 输出格式
按以下分区输出，用 ## 标题分隔。无内容的分区省略。

## Goal
1-2 句话描述当前任务目标或方向。

## Constraints & Preferences
用户明确表达的约束条件、偏好、风格要求。

## Progress
### Done
已完成事项，- 开头逐条列出。必须保留：具体文件路径、函数名/变量名/类名、改动本质、commit hash（如提到）。

### In Progress
正在进行但未完成的事项。

### Blocked
被阻塞或待确认的事项，附原因。

## Key Decisions
重要技术决策和取舍（架构选择、方案对比结论、被否决的方案及原因）。

## Next Steps
对话中明确提到的后续计划。

\n\n${text}`;
}

async function summarizeWithAgent(dataDir: string, agentId: string, subject: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const prompt = await buildCycloneSummary(subject, messages);
  if (!prompt) return '';
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) throw new Error('摘要 Agent 不存在');
  if (!agent.model) throw new Error('摘要 Agent 未配置模型');
  const result = await callLLM({
    dataDir,
    fullModelKey: agent.model,
    messages: [
      { role: 'system', content: '你是 4torm 气旋工作室的上下文压缩器。输出中文，精炼、可继续工作。' },
      { role: 'user', content: prompt },
    ],
    options: { temperature: 0.2, maxTokens: 900 },
  });
  return result.content.trim();
}

export async function cycloneRoutes(app: FastifyInstance): Promise<void> {
  // 注：HTTP 参数在进入领域逻辑前保持轻量适配。
  // 装饰器边界的**有意转型**——请求载荷在校验前无静态类型，各 handler 内用显式判空 / 取默认
  // 值兜底（如 `body?.title?.trim()`、`body?.agentId`）。非"类型随意"。
  const { dataDir } = getAppContext(app);

  // POST /api/cyclone/create —— 建工作室
  app.post('/create', async (req, reply) => {
    const { title, chairAgentId } = (req.body as any) || {};
    const w = await createWorkshop(dataDir, { title, chairAgentId });
    return reply.send(w);
  });

  // GET /api/cyclone/list —— 工作室列表
  app.get('/list', async (_req, reply) => {
    return reply.send(await listWorkshops(dataDir));
  });

  // ── 工作室级：CRUD / 侧栏摘要 / 设会长 / 建工位 / 职责名片 ──────────────
  // ALL /api/cyclone/workshop/:workshopId/:action
  app.all('/workshop/:workshopId/:action', async (req, reply) => {
    const { workshopId, action } = req.params as any;
    const body = (req.body as any) || {};

    if (action === 'status') {
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      return reply.send(w);
    }

    // 侧栏轻量摘要：一次返回工位/群聊的 id+标题（+工位是否挂起），并行读，不拉完整会话
    if (action === 'summary') {
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      const [seats, rooms, bulletin] = await Promise.all([
        Promise.all(w.seatIds.map(async (sid) => {
          const s = await loadSeat(dataDir, workshopId, sid);
          return s ? { id: s.id, title: s.title, pending: !!s.pending } : null;
        })),
        Promise.all(w.roomIds.map(async (rid) => {
          const rm = await loadRoom(dataDir, workshopId, rid);
          return rm ? { id: rm.id, title: rm.title } : null;
        })),
        readBulletin(dataDir, workshopId),
      ]);
      return reply.send({
        id: w.id, title: w.title, chairAgentId: w.chairAgentId,
        seats: seats.filter(Boolean),
        rooms: rooms.filter(Boolean),
        bulletin,
      });
    }

    // 公告板：读 / 增量改（工作室级，全体工位可见；人与工位皆可写，增量操作免全量覆盖冲突）
    if (action === 'bulletin') {
      return reply.send(await readBulletin(dataDir, workshopId));
    }

    if (action === 'bulletin-mutate') {
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      const ops = Array.isArray(body?.ops) ? (body.ops as BulletinOp[]) : [];
      const b = ops.length ? await applyBulletinOps(dataDir, workshopId, ops, '人类') : await readBulletin(dataDir, workshopId);
      return reply.send({ ...b, changes: await readBulletinHistory(dataDir, workshopId) });
    }

    // 改动时间轴：读 / 撤回某条（撤回者落款为「人类」）
    if (action === 'bulletin-history') {
      return reply.send({ changes: await readBulletinHistory(dataDir, workshopId) });
    }

    if (action === 'bulletin-revert') {
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      const seq = Number(body?.seq);
      if (!Number.isFinite(seq)) return reply.status(400).send({ error: '缺少 seq' });
      const b = await revertBulletinChange(dataDir, workshopId, seq, '人类');
      return reply.send({ ...b, changes: await readBulletinHistory(dataDir, workshopId) });
    }

    if (action === 'rename') {
      if (!body?.title?.trim()) return reply.status(400).send({ error: '缺少 title' });
      await renameWorkshop(dataDir, workshopId, body.title.trim());
      return reply.send({ ok: true });
    }

    if (action === 'delete') {
      await deleteWorkshop(dataDir, workshopId);
      return reply.send({ ok: true });
    }

    if (action === 'open-workspace') {
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      const workspacePath = workshopWorkspace(dataDir, workshopId);
      await fs.mkdir(workspacePath, { recursive: true });
      if (process.platform === 'win32') {
        spawn('explorer.exe', [workspacePath], { detached: true, stdio: 'ignore' }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [workspacePath], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [workspacePath], { detached: true, stdio: 'ignore' }).unref();
      }
      return reply.send({ ok: true, path: workspacePath });
    }

    if (action === 'set-chair') {
      const w = await setChair(dataDir, workshopId, body?.chairAgentId || '');
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      return reply.send({ chairAgentId: w.chairAgentId });
    }

    if (action === 'add-seat') {
      if (!body?.agentId) return reply.status(400).send({ error: '缺少 agentId' });
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      const seat = await addSeat(dataDir, workshopId, {
        agentId: body.agentId, title: body.title, rolePrompt: body.rolePrompt,
        duty: body.duty, overrideAgentRole: body.overrideAgentRole,
      });
      return reply.send(seat);
    }

    // 无状态职责名片生成（创建工位前调用，不依赖已存工位）
    if (action === 'gen-duty') {
      if (!body?.agentId) return reply.status(400).send({ error: '缺少 agentId' });
      const duty = await generateSeatDuty(dataDir, {
        agentId: body.agentId, title: body.title || '工位', rolePrompt: body.rolePrompt,
      });
      return reply.send({ duty });
    }

    return reply.status(400).send({ error: `未知 action：${action}` });
  });

  // ── 工位级：状态 / 改角色 / 重置上下文 / 私聊(chat·resume, SSE 流式) ──────
  // ALL /api/cyclone/workshop/:workshopId/seat/:seatId/:action
  app.all('/workshop/:workshopId/seat/:seatId/:action', async (req, reply) => {
    const { workshopId, seatId, action } = req.params as any;
    const body = (req.body as any) || {};
    const lockKey = `${workshopId}/${seatId}`;

    if (action === 'status') {
      const seat = await loadSeat(dataDir, workshopId, seatId);
      if (!seat) return reply.status(404).send({ error: '工位不存在' });
      return reply.send(seat);
    }

    if (action === 'update-role') {
      const updated = await updateSeatRole(dataDir, workshopId, seatId, {
        title: body.title, rolePrompt: body.rolePrompt,
        duty: body.duty, overrideAgentRole: body.overrideAgentRole,
      });
      if (!updated) return reply.status(404).send({ error: '工位不存在' });
      return reply.send(updated);
    }

    if (action === 'edit-message' || action === 'delete-message') {
      const release = tryAcquireSeatLock(workshopId, seatId);
      if (!release) return reply.status(409).send({ error: '该工位正在处理消息，暂时不能修改历史' });
      try {
        const seat = await loadSeat(dataDir, workshopId, seatId);
        if (!seat) return reply.status(404).send({ error: '工位不存在' });
        if (seat.pending) return reply.status(409).send({ error: '该工位存在挂起提问，请先完成回答再修改历史' });
        if (!Number.isInteger(body?.index)) return reply.status(400).send({ error: '缺少 index' });
        const changed = action === 'edit-message'
          ? typeof body?.content === 'string' && editContextMessage(seat.messages, body.index, body.content)
          : deleteContextMessage(seat.messages, body.index);
        if (!changed) return reply.status(400).send({ error: '消息索引越界或内容无效' });
        await saveSeat(dataDir, workshopId, seat);
        return reply.send({ ok: true });
      } finally {
        release();
      }
    }

    if (action === 'reset-context') {
      if (activeAborts.has(lockKey)) return reply.status(409).send({ error: '该工位正在处理中，请稍后再重置上下文' });
      const seat = await loadSeat(dataDir, workshopId, seatId);
      if (!seat) return reply.status(404).send({ error: '工位不存在' });
      let summary = '';
      if (body?.mode === 'summary') {
        summary = await summarizeWithAgent(dataDir, seat.agentId, `工位「${seat.title}」私聊`, summaryMessages(seat.messages || []));
      }
      try {
        const result = await resetSeatContext(dataDir, workshopId, seatId, {
          summary,
          forcePending: !!body?.forcePending,
        });
        return reply.send({ ok: true, archivePath: result.archivePath, archivedCount: result.archivedCount, summary: !!summary });
      } catch (e) {
        return reply.status(409).send({ error: (e as Error).message });
      }
    }

    if (action === 'delete') {
      await deleteSeat(dataDir, workshopId, seatId);
      return reply.send({ ok: true });
    }

    if (action === 'abort') {
      const ctrl = activeAborts.get(lockKey);
      if (!ctrl) return reply.status(409).send({ error: 'No active round' });
      ctrl.abort();
      return reply.send({ ok: true });
    }

    // chat / resume：SSE 流式
    if (action === 'chat' || action === 'resume') {
      const text = (body?.message ?? body?.answer ?? '').trim();
      if (!text) return reply.status(400).send({ error: action === 'chat' ? '缺少 message' : '缺少 answer' });
      const seat = await loadSeat(dataDir, workshopId, seatId);
      if (!seat) return reply.status(404).send({ error: '工位不存在' });

      reply.hijack();
      initSSE(reply);
      const stopHB = startHeartbeat(reply);
      const abort = new AbortController();
      activeAborts.set(lockKey, abort);
      const onEvent = (ev: SeatEvent) => { pushSSE(reply, ev); };
      try {
        if (action === 'chat') {
          await chatSeat(dataDir, workshopId, seatId, text, onEvent, abort.signal);
        } else {
          await resumeSeat(dataDir, workshopId, seatId, text, onEvent, abort.signal);
        }
      } catch (e) {
        pushSSE(reply, { type: 'error', message: (e as Error).message });
      } finally {
        activeAborts.delete(lockKey);
        stopHB();
        endSSE(reply);
      }
      return;
    }

    return reply.status(400).send({ error: `未知 action：${action}` });
  });

  // ── 会长级：按会议(room)隔离的私聊参谋(chat, SSE 流式) ────────────────────
  // ALL /api/cyclone/workshop/:workshopId/room/:roomId/chair/:action
  // 会长按会议（room）隔离：私聊落 room.chairMessages，只读本 room 会议快照，换会议不串台。
  app.all('/workshop/:workshopId/room/:roomId/chair/:action', async (req, reply) => {
    const { workshopId, roomId, action } = req.params as any;
    const body = (req.body as any) || {};
    // 与群聊发言共用 per-room 锁键，统一在 activeAborts 里登记
    const lockKey = `${workshopId}/room/${roomId}`;

    if (action === 'status') {
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      const room = await loadRoom(dataDir, workshopId, roomId);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      if (!w.chairAgentId) return reply.status(400).send({ error: '该工作室未指定会长' });
      return reply.send({
        chairAgentId: w.chairAgentId,
        messages: room.chairMessages || [],
      });
    }

    if (action === 'reset-context') {
      if (activeAborts.has(lockKey)) return reply.status(409).send({ error: '会长正在处理中，请稍后再重置上下文' });
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      if (!w.chairAgentId) return reply.status(400).send({ error: '该工作室未指定会长' });
      const room = await loadRoom(dataDir, workshopId, roomId);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      let chairSummary = '';
      if (body?.mode === 'summary') {
        chairSummary = await summarizeWithAgent(dataDir, w.chairAgentId, `群聊「${room.title}」会长私聊`, summaryMessages(room.chairMessages || []));
      }
      try {
        const result = await resetRoomContext(dataDir, workshopId, roomId, { scope: 'chair', chairSummary });
        return reply.send({ ok: true, archivePath: result.archivePath, archivedChairCount: result.archivedChairCount, summary: !!chairSummary });
      } catch (e) {
        return reply.status(409).send({ error: (e as Error).message });
      }
    }

    if (action === 'edit-message' || action === 'delete-message') {
      const release = tryAcquireRoomLock(workshopId, roomId);
      if (!release) return reply.status(409).send({ error: '会长正在处理消息，暂时不能修改历史' });
      try {
        const room = await loadRoom(dataDir, workshopId, roomId);
        if (!room) return reply.status(404).send({ error: '群聊不存在' });
        if (!Number.isInteger(body?.index)) return reply.status(400).send({ error: '缺少 index' });
        const messages = room.chairMessages || [];
        const changed = action === 'edit-message'
          ? typeof body?.content === 'string' && editContextMessage(messages, body.index, body.content)
          : deleteContextMessage(messages, body.index);
        if (!changed) return reply.status(400).send({ error: '消息索引越界或内容无效' });
        room.chairMessages = messages;
        await saveRoom(dataDir, workshopId, room);
        return reply.send({ ok: true });
      } finally {
        release();
      }
    }

    if (action === 'abort') {
      const ctrl = activeAborts.get(lockKey);
      if (!ctrl) return reply.status(409).send({ error: 'No active round' });
      ctrl.abort();
      return reply.send({ ok: true });
    }

    // 会长是纯文本参谋，无挂起态 → 只有 chat，无 resume
    if (action === 'chat') {
      const text = (body?.message ?? '').trim();
      if (!text) return reply.status(400).send({ error: '缺少 message' });
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      if (!w.chairAgentId) return reply.status(400).send({ error: '该工作室未指定会长' });

      reply.hijack();
      initSSE(reply);
      const stopHB = startHeartbeat(reply);
      const abort = new AbortController();
      activeAborts.set(lockKey, abort);
      const onEvent = (ev: SeatEvent) => { pushSSE(reply, ev); };
      try {
        await chatChair(dataDir, workshopId, roomId, text, onEvent, abort.signal);
      } catch (e) {
        pushSSE(reply, { type: 'error', message: (e as Error).message });
      } finally {
        activeAborts.delete(lockKey);
        stopHB();
        endSSE(reply);
      }
      return;
    }

    return reply.status(400).send({ error: `未知 action：${action}` });
  });

  // POST /api/cyclone/workshop/:workshopId/create-room —— 建群聊
  app.post('/workshop/:workshopId/create-room', async (req, reply) => {
    const { workshopId } = req.params as any;
    const body = (req.body as any) || {};
    const w = await loadWorkshop(dataDir, workshopId);
    if (!w) return reply.status(404).send({ error: '工作室不存在' });
    const room = await createRoom(dataDir, workshopId, {
      title: body.title, topic: body.topic, participantSeatIds: body.participantSeatIds, mode: body.mode,
    });
    return reply.send(room);
  });

  // ── 群聊级：成员管理 / 改名·模式 / 重置上下文 / 入会发言·串行发言(SSE 流式) ──
  // ALL /api/cyclone/workshop/:workshopId/room/:roomId/:action
  app.all('/workshop/:workshopId/room/:roomId/:action', async (req, reply) => {
    const { workshopId, roomId, action } = req.params as any;
    const body = (req.body as any) || {};
    const lockKey = `${workshopId}/room/${roomId}`;

    if (action === 'status') {
      const room = await loadRoom(dataDir, workshopId, roomId);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      return reply.send(room);
    }

    if (action === 'delete') {
      await deleteRoom(dataDir, workshopId, roomId);
      return reply.send({ ok: true });
    }

    if (action === 'join') {
      if (!body?.seatId) return reply.status(400).send({ error: '缺少 seatId' });
      try {
        const room = await joinRoom(dataDir, workshopId, roomId, body.seatId);
        if (!room) return reply.status(404).send({ error: '群聊不存在' });
        return reply.send({ participantSeatIds: room.participantSeatIds });
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    }

    if (action === 'leave') {
      if (!body?.seatId) return reply.status(400).send({ error: '缺少 seatId' });
      const room = await leaveRoom(dataDir, workshopId, roomId, body.seatId);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      return reply.send({ participantSeatIds: room.participantSeatIds });
    }

    if (action === 'reorder') {
      if (!Array.isArray(body?.seatIds)) return reply.status(400).send({ error: '缺少 seatIds 数组' });
      const room = await setRoomParticipants(dataDir, workshopId, roomId, body.seatIds);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      return reply.send({ participantSeatIds: room.participantSeatIds });
    }

    if (action === 'rename') {
      if (!body?.title) return reply.status(400).send({ error: '缺少 title' });
      const room = await renameRoom(dataDir, workshopId, roomId, body.title);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      return reply.send({ title: room.title });
    }

    if (action === 'set-mode') {
      const room = await setRoomMode(dataDir, workshopId, roomId, body?.mode);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      return reply.send({ mode: room.mode });
    }

    if (action === 'edit-message' || action === 'delete-message') {
      const release = tryAcquireRoomLock(workshopId, roomId);
      if (!release) return reply.status(409).send({ error: '群聊正在处理消息，暂时不能修改历史' });
      try {
        const room = await loadRoom(dataDir, workshopId, roomId);
        if (!room) return reply.status(404).send({ error: '群聊不存在' });
        if (!Number.isInteger(body?.index)) return reply.status(400).send({ error: '缺少 index' });
        const message = room.publicMessages[body.index];
        if (!message) return reply.status(400).send({ error: '消息索引越界' });
        if (action === 'edit-message') {
          if (typeof body?.content !== 'string') return reply.status(400).send({ error: '缺少 content' });
          message.content = body.content;
          message.rawContent = undefined;
        } else {
          room.publicMessages.splice(body.index, 1);
        }
        await saveRoom(dataDir, workshopId, room);
        return reply.send({ ok: true });
      } finally {
        release();
      }
    }

    if (action === 'reset-context') {
      if (activeAborts.has(lockKey)) return reply.status(409).send({ error: '该群聊正在处理中，请稍后再重置上下文' });
      const room = await loadRoom(dataDir, workshopId, roomId);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      const scope = body?.scope === 'chair' ? 'chair' : body?.scope === 'both' ? 'both' : 'public';
      let publicSummary = '';
      let chairSummary = '';
      if (body?.mode === 'summary' || body?.mode === 'all-summary') {
        const chairId = (await loadWorkshop(dataDir, workshopId))?.chairAgentId;
        if (!chairId) return reply.status(400).send({ error: '摘要重置需要先设置会长 Agent' });
        if (scope === 'public' || scope === 'both') {
          publicSummary = await summarizeWithAgent(dataDir, chairId, `群聊「${room.title}」公共上下文`, summaryMessages(room.publicMessages || []));
        }
        if ((scope === 'chair' || scope === 'both') && room.chairMessages?.length) {
          chairSummary = await summarizeWithAgent(dataDir, chairId, `群聊「${room.title}」会长私聊`, summaryMessages(room.chairMessages || []));
        }
      }
      const release = tryAcquireRoomLock(workshopId, roomId);
      if (!release) return reply.status(409).send({ error: '该群聊正在处理中，请稍后再试' });
      try {
        const result = await resetRoomContext(dataDir, workshopId, roomId, { scope, publicSummary, chairSummary });
        return reply.send({ ok: true, archivePath: result.archivePath, archivedPublicCount: result.archivedPublicCount, archivedChairCount: result.archivedChairCount });
      } catch (e) {
        return reply.status(409).send({ error: (e as Error).message });
      } finally {
        release();
      }
    }

    // 入会发言：对指定工位按各自 joinBehavior 依次生成开场白（SSE 流式，仿 speak 事件）
    // body.intros: Array<{ seatId: string; behavior: 'summary'|'intro'|'none' }>
    if (action === 'intro') {
      const intros: Array<{ seatId: string; behavior: JoinBehavior }> = Array.isArray(body?.intros) ? body.intros : [];
      const room = await loadRoom(dataDir, workshopId, roomId);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      const release = tryAcquireRoomLock(workshopId, roomId);
      if (!release) return reply.status(409).send({ error: '该群聊正在处理中，请稍后再试' });

      reply.hijack();
      initSSE(reply);
      const stopHB = startHeartbeat(reply);
      const abort = new AbortController();
      activeAborts.set(lockKey, abort);
      try {
        for (const it of intros) {
          if (abort.signal.aborted) break;
          if (it.behavior === 'none') continue;
          const seat = await loadSeat(dataDir, workshopId, it.seatId);
          if (!seat) continue;
          pushSSE(reply, { type: 'seat-start', speaker: seat.title });
          const speech = await generateJoinSpeech(
            dataDir, workshopId, room, it.seatId, it.behavior,
            (chunk) => pushSSE(reply, { type: 'token', speaker: seat.title, content: chunk }),
            abort.signal,
          );
          if (speech) pushSSE(reply, { type: 'seat-done', speaker: seat.title, content: speech });
        }
        pushSSE(reply, { type: 'done' });
      } catch (e) {
        pushSSE(reply, { type: 'error', message: (e as Error).message });
      } finally {
        activeAborts.delete(lockKey);
        release();
        stopHB();
        endSSE(reply);
      }
      return;
    }

    if (action === 'abort') {
      const ctrl = activeAborts.get(lockKey);
      if (!ctrl) return reply.status(409).send({ error: 'No active round' });
      ctrl.abort();
      return reply.send({ ok: true });
    }

    if (action === 'speak') {
      const text = (body?.message ?? '').trim();
      if (!text) return reply.status(400).send({ error: '缺少 message' });
      const room = await loadRoom(dataDir, workshopId, roomId);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      const release = tryAcquireRoomLock(workshopId, roomId);
      if (!release) return reply.status(409).send({ error: '该群聊正在处理中，请稍后再试' });

      reply.hijack();
      initSSE(reply);
      const stopHB = startHeartbeat(reply);
      const abort = new AbortController();
      activeAborts.set(lockKey, abort);
      const onEvent = (ev: RoomEvent) => { pushSSE(reply, ev); };
      try {
        await speakInRoom(dataDir, workshopId, room, text, onEvent, abort.signal);
        pushSSE(reply, { type: 'done' });
      } catch (e) {
        pushSSE(reply, { type: 'error', message: (e as Error).message });
      } finally {
        activeAborts.delete(lockKey);
        release();
        stopHB();
        endSSE(reply);
      }
      return;
    }

    return reply.status(400).send({ error: `未知 action：${action}` });
  });
}
