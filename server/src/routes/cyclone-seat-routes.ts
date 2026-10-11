import type { FastifyInstance } from 'fastify';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse.js';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';
import { humanContext } from './collaboration-context.js';
import type { PreparedCycloneSeatChat, PreparedCycloneSeatCompaction } from '../modules/cyclone/public.js';


export function registerCycloneSeatRoutes(app: FastifyInstance, options: CycloneRouteOptions): void {
  app.all('/workshop/:workshopId/seat/:seatId/:action', async (req, reply) => {
    const { workshopId, seatId, action } = req.params as any;
    const body = (req.body as any) || {};

    if (action === 'revision') return reply.send(await queryCyclone(
      options, 'readSeatRevision', { workshopId, seatId }, req,
    ));
    if (action === 'status') return reply.send(await queryCyclone(
      options, 'readSeat', { workshopId, seatId }, req,
    ));

    if (action === 'activity') {
      const since = Number((req.query as { since?: string } | undefined)?.since || 0);
      return reply.send(await queryCyclone(options, 'readSeatActivity',
        { workshopId, seatId, since: Number.isFinite(since) ? since : 0 }, req));
    }

    if (action === 'compact') {
      const prepared = await options.router.prepareTransport('cyclone', 'seatCompaction',
        { workshopId, seatId }, humanContext(req)) as PreparedCycloneSeatCompaction;
      reply.hijack();
      initSSE(reply);
      const stopHeartbeat = startHeartbeat(reply);
      pushSSE(reply, { type: 'execution-start', ...prepared.execution });
      try { await prepared.run(event => pushSSE(reply, event)); }
      catch (error) {
        const message = (error as Error).message;
        pushSSE(reply, { type: 'error', error: message, message });
      } finally { stopHeartbeat(); endSSE(reply); }
      return;
    }

    // chat / resume：SSE 流式
    if (action === 'chat' || action === 'resume') {
      const text = (body?.message ?? body?.answer ?? '').trim();
      if (!text) return reply.status(400).send({ error: action === 'chat' ? '缺少 message' : '缺少 answer' });
      const prepared = await options.router.prepareTransport('cyclone', 'seatChat',
        { workshopId, seatId, mode: action, text },
        humanContext(req)) as PreparedCycloneSeatChat;
      let stopHB: (() => void) | undefined;
      let sseStarted = false;
      try {
        reply.hijack();
        initSSE(reply);
        sseStarted = true;
        stopHB = startHeartbeat(reply);
        pushSSE(reply, { type: 'execution-start', ...prepared.execution });
        await prepared.run(event => pushSSE(reply, event));
      } catch (e) {
        if (sseStarted) pushSSE(reply, { type: 'error', message: (e as Error).message });
        else throw e;
      } finally {
        stopHB?.();
        if (sseStarted) endSSE(reply);
      }
      return;
    }

    return reply.status(400).send({ error: `未知 action：${action}` });
  });

}
