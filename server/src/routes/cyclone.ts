/**
 * 气旋工作室 Fastify 路由适配层
 *
 * 直接调用 engine/cyclone/ 下的业务函数。HTTP 层很薄。
 * Phase 0：工作室/工位 CRUD + 工位私聊（chat/resume，SSE 流式）。
 * Phase 1：群聊 CRUD + 拉工位 + 串行发言（speak，SSE 流式）。
 */

import type { FastifyInstance } from 'fastify';
import {
  createWorkshop, loadWorkshop, listWorkshops, deleteWorkshop, renameWorkshop,
} from '../engine/cyclone/workshop-store';
import {
  addSeat, loadSeat, deleteSeat, updateSeatRole,
} from '../engine/cyclone/seat-store';
import {
  createRoom, loadRoom, deleteRoom, joinRoom, leaveRoom, setRoomParticipants, renameRoom, tryAcquireRoomLock,
} from '../engine/cyclone/room-store';
import { chatSeat, resumeSeat, type SeatEvent } from '../engine/cyclone/seat-runner';
import { speakInRoom, type RoomEvent } from '../engine/cyclone/room-runner';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse';

/** 活跃轮次 AbortController：`${workshopId}/${seatId}` 或 `${workshopId}/room/${roomId}` → ctrl */
const activeAborts = new Map<string, AbortController>();

export async function cycloneRoutes(app: FastifyInstance): Promise<void> {
  const dataDir = (app as any).dataDir as string;

  // POST /api/cyclone/create —— 建工作室
  app.post('/create', async (req, reply) => {
    const { title } = (req.body as any) || {};
    const w = await createWorkshop(dataDir, { title });
    return reply.send(w);
  });

  // GET /api/cyclone/list —— 工作室列表
  app.get('/list', async (_req, reply) => {
    return reply.send(await listWorkshops(dataDir));
  });

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
      const [seats, rooms] = await Promise.all([
        Promise.all(w.seatIds.map(async (sid) => {
          const s = await loadSeat(dataDir, workshopId, sid);
          return s ? { id: s.id, title: s.title, pending: !!s.pending } : null;
        })),
        Promise.all(w.roomIds.map(async (rid) => {
          const rm = await loadRoom(dataDir, workshopId, rid);
          return rm ? { id: rm.id, title: rm.title } : null;
        })),
      ]);
      return reply.send({
        id: w.id, title: w.title,
        seats: seats.filter(Boolean),
        rooms: rooms.filter(Boolean),
      });
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

    if (action === 'add-seat') {
      if (!body?.agentId) return reply.status(400).send({ error: '缺少 agentId' });
      const w = await loadWorkshop(dataDir, workshopId);
      if (!w) return reply.status(404).send({ error: '工作室不存在' });
      const seat = await addSeat(dataDir, workshopId, {
        agentId: body.agentId, title: body.title, rolePrompt: body.rolePrompt,
      });
      return reply.send(seat);
    }

    return reply.status(400).send({ error: `未知 action：${action}` });
  });

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
      });
      if (!updated) return reply.status(404).send({ error: '工位不存在' });
      return reply.send(updated);
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

  // POST /api/cyclone/workshop/:workshopId/create-room —— 建群聊
  app.post('/workshop/:workshopId/create-room', async (req, reply) => {
    const { workshopId } = req.params as any;
    const body = (req.body as any) || {};
    const w = await loadWorkshop(dataDir, workshopId);
    if (!w) return reply.status(404).send({ error: '工作室不存在' });
    const room = await createRoom(dataDir, workshopId, {
      title: body.title, topic: body.topic, participantSeatIds: body.participantSeatIds,
    });
    return reply.send(room);
  });

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
      const room = await joinRoom(dataDir, workshopId, roomId, body.seatId);
      if (!room) return reply.status(404).send({ error: '群聊不存在' });
      return reply.send({ participantSeatIds: room.participantSeatIds });
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
