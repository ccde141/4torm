import type { FastifyInstance } from 'fastify';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse.js';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';
import { humanContext } from './collaboration-context.js';
import type { PreparedCycloneChairChat } from '../modules/cyclone/public.js';

export function registerCycloneChairRoutes(app: FastifyInstance, options: CycloneRouteOptions): void {
  app.all('/workshop/:workshopId/room/:roomId/chair/:action', async (req, reply) => {
    const { workshopId, roomId, action } = req.params as any;
    const body = (req.body as any) || {};

    if (action === 'status') return reply.send(await queryCyclone(
      options, 'readChair', { workshopId, roomId }, req,
    ));

    // 会长是纯文本参谋，无挂起态 → 只有 chat，无 resume
    if (action === 'chat') {
      const text = (body?.message ?? '').trim();
      if (!text) return reply.status(400).send({ error: '缺少 message' });
      const prepared = await options.router.prepareTransport('cyclone', 'chairChat',
        { workshopId, roomId, message: text },
        humanContext(req)) as PreparedCycloneChairChat;
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
  });

}
