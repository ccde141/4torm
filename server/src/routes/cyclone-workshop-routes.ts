import type { FastifyInstance } from 'fastify';
import { initSSE, pushSSE, startHeartbeat } from '../utils/sse.js';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';

export async function registerCycloneWorkshopRoutes(
  app: FastifyInstance,
  options: CycloneRouteOptions,
): Promise<void> {
  app.get('/changes', async (request, reply) => {
    await queryCyclone(options, 'listWorkshops', {}, request);
    reply.hijack();
    let stop = () => {};
    let stopHeartbeat = () => {};
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      stop();
      stopHeartbeat();
      reply.raw.off('close', close);
      reply.raw.off('error', close);
    };
    reply.raw.once('close', close);
    reply.raw.once('error', close);
    if (request.raw.aborted || reply.raw.destroyed) { close(); return; }
    initSSE(reply);
    reply.raw.write(': connected\n\n');
    if (closed || reply.raw.destroyed) { close(); return; }
    stop = options.feature.changes.subscribe(signal => {
      try {
        pushSSE(reply, signal);
        if (reply.raw.writableLength > 64_000) reply.raw.end();
      } catch { reply.raw.destroy(); }
    });
    stopHeartbeat = startHeartbeat(reply);
    if (closed || reply.raw.destroyed) close();
  });
  app.get('/list', async (request, reply) => reply.send(await queryCyclone(
    options, 'listWorkshops', {}, request,
  )));
  app.get('/workshop/:workshopId/status', async (request, reply) => reply.send(
    await queryCyclone(options, 'readWorkshop', { workshopId: id(request.params) }, request),
  ));
  app.get('/workshop/:workshopId/summary', async (request, reply) => reply.send(
    await queryCyclone(options, 'summarizeWorkshop', { workshopId: id(request.params) }, request),
  ));
  app.get('/workshop/:workshopId/bulletin', async (request, reply) => reply.send(
    await queryCyclone(options, 'readWorkshopBulletin', { workshopId: id(request.params) }, request),
  ));
  app.get('/workshop/:workshopId/bulletin-history', async (request, reply) => reply.send(
    await queryCyclone(options, 'readWorkshopBulletinHistory',
      { workshopId: id(request.params) }, request),
  ));
}

function id(params: unknown): string {
  return (params as { workshopId: string }).workshopId;
}
