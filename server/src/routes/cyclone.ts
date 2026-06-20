/**
 * 气旋工作室 Fastify 路由适配层
 *
 * 直接调用 engine/cyclone/ 下的业务函数。HTTP 层很薄。
 * Phase 0：工作室/工位 CRUD + 工位私聊（chat/resume，SSE 流式）。
 * 群聊（room）在 Phase 1 接入。
 */

import type { FastifyInstance } from 'fastify';
import {
  createWorkshop, loadWorkshop, listWorkshops, deleteWorkshop, renameWorkshop,
} from '../engine/cyclone/workshop-store';
import {
  addSeat, loadSeat, deleteSeat, updateSeatRole,
} from '../engine/cyclone/seat-store';
import { chatSeat, resumeSeat, type SeatEvent } from '../engine/cyclone/seat-runner';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse';

/** 活跃轮次 AbortController：`${workshopId}/${seatId}` → ctrl */
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
}
