import type { FastifyInstance } from 'fastify';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse.js';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';
import type { CycloneJoinBehavior } from '../modules/cyclone/public.js';
import type { PreparedCycloneRoomIntroduction, PreparedCycloneRoomRound } from '../modules/cyclone/public.js';
import { humanContext } from './collaboration-context.js';

export function registerCycloneRoomRoutes(app: FastifyInstance, options: CycloneRouteOptions): void {
  // ── 群聊级：成员管理 / 改名·模式 / 重置上下文 / 入会发言·串行发言(SSE 流式) ──
  // ALL /api/cyclone/workshop/:workshopId/room/:roomId/:action
  app.all('/workshop/:workshopId/room/:roomId/:action', async (req, reply) => {
    const { workshopId, roomId, action } = req.params as any;
    const body = (req.body as any) || {};

    if (action === 'status') return reply.send(await queryCyclone(
      options, 'readRoom', { workshopId, roomId }, req,
    ));

    // 入会发言：对指定工位按各自 joinBehavior 依次生成开场白（SSE 流式，仿 speak 事件）
    // body.intros: Array<{ seatId: string; behavior: 'summary'|'intro'|'none' }>
    if (action === 'intro') {
      const intros = parseIntroductions(body?.intros);
      if (!intros) return reply.status(400).send({ error: '入会介绍参数无效' });
      const prepared = await options.router.prepareTransport('cyclone', 'roomIntroduction',
        { workshopId, roomId, intros },
        humanContext(req)) as PreparedCycloneRoomIntroduction;
      let stopHB: (() => void) | undefined;
      let sseStarted = false;
      let failure: unknown;
      try {
        reply.hijack();
        initSSE(reply);
        sseStarted = true;
        stopHB = startHeartbeat(reply);
        pushSSE(reply, { type: 'execution-start', ...prepared.execution });
        await prepared.run(event => pushSSE(reply, event));
        pushSSE(reply, { type: 'done' });
      } catch (e) {
        failure = e;
        if (sseStarted) pushSSE(reply, { type: 'error', message: (e as Error).message });
        else throw e;
      } finally {
        try { await prepared.dispose(failure); }
        finally {
          stopHB?.();
          if (sseStarted && !reply.raw.destroyed && !reply.raw.writableEnded) endSSE(reply);
        }
      }
      return;
    }

    if (action === 'speak') {
      const text = (body?.message ?? '').trim();
      if (!text) return reply.status(400).send({ error: '缺少 message' });
      const prepared = await options.router.prepareTransport('cyclone', 'roomRound',
        { workshopId, roomId, message: text },
        humanContext(req)) as PreparedCycloneRoomRound;
      let stopHB: (() => void) | undefined;
      let sseStarted = false;
      let failure: unknown;
      try {
        reply.hijack();
        initSSE(reply);
        sseStarted = true;
        stopHB = startHeartbeat(reply);
        pushSSE(reply, { type: 'execution-start', ...prepared.execution });
        await prepared.run(event => pushSSE(reply, event));
        pushSSE(reply, { type: 'done' });
      } catch (e) {
        failure = e;
        if (sseStarted) pushSSE(reply, { type: 'error', message: (e as Error).message });
        else throw e;
      } finally {
        try { await prepared.dispose(failure); }
        finally {
          stopHB?.();
          if (sseStarted && !reply.raw.destroyed && !reply.raw.writableEnded) endSSE(reply);
        }
      }
      return;
    }

    return reply.status(400).send({ error: `未知 action：${action}` });
  });}

function parseIntroductions(value: unknown): Array<{ seatId: string; behavior: CycloneJoinBehavior }> | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const intros = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const { seatId, behavior } = item as Record<string, unknown>;
    if (typeof seatId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(seatId)
      || !['summary', 'intro', 'none'].includes(String(behavior))) return null;
    intros.push({ seatId, behavior: behavior as CycloneJoinBehavior });
  }
  return intros;
}
