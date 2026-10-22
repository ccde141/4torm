import type { FastifyInstance } from 'fastify';
import { initSSE, pushSSE, startHeartbeat, endSSE } from '../utils/sse.js';
import { humanContext } from './collaboration-context.js';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';
import type { PreparedSupervisorChat } from '../modules/cyclone/public.js';

export function registerCycloneSupervisorRoutes(app: FastifyInstance, options: CycloneRouteOptions): void {
  app.all('/workshop/:workshopId/supervisor/:action', async (request, reply) => {
    const { workshopId, action } = request.params as { workshopId: string; action: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (action === 'status' || action === 'revision') return queryCyclone(options,
      action === 'status' ? 'readSupervisor' : 'readSupervisorRevision', { workshopId }, request);
    if (action === 'activity') return queryCyclone(options, 'readPrivateChatActivity', {
      workshopId, targetKind: 'supervisor', targetId: 'supervisor',
      since: Number((request.query as { since?: string }).since ?? 0),
    }, request);
    if (action === 'config' && request.method === 'PUT') return queryCyclone(options,
      'configureSupervisor', { ...body, workshopId }, request);
    if (action === 'message' && request.method === 'PATCH') return queryCyclone(options,
      'editSupervisorMessage', { ...body, workshopId }, request);
    if (action === 'reset') return queryCyclone(options,
      'resetSupervisorContext', { ...body, workshopId }, request);
    if (action === 'taskboard') {
      const result = await queryCyclone(options, request.method === 'PUT'
        ? 'mutateSupervisorTaskboard' : 'readSupervisorTaskboard',
      request.method === 'PUT' ? { ...body, workshopId } : { workshopId }, request);
      if (result && typeof result === 'object' && 'conflict' in result && result.conflict) reply.status(409);
      return result;
    }
    if (action !== 'chat' && action !== 'resume' && action !== 'compact') return reply.code(404).send({ error: '主管接口不存在' });
    if (request.method !== 'POST') return reply.code(405).send({ error: '请使用 POST' });
    const input = action === 'compact' ? { workshopId }
      : { workshopId, mode: action, text: body.message ?? body.answer };
    const prepared = await options.router.prepareTransport('cyclone',
      action === 'compact' ? 'supervisorCompaction' : 'supervisorChat', input,
      humanContext(request)) as PreparedSupervisorChat;
    let stopHeartbeat = () => {};
    let started = false;
    let errorSent = false;
    let failure: unknown;
    try {
      reply.hijack(); initSSE(reply); started = true;
      stopHeartbeat = startHeartbeat(reply);
      pushSSE(reply, { type: 'execution-start', ...prepared.execution });
      await prepared.run(event => {
        if (event && typeof event === 'object' && 'type' in event && event.type === 'error') errorSent = true;
        pushSSE(reply, event);
      });
    } catch (error) {
      failure = error;
      if (started && !errorSent && !reply.raw.destroyed) pushSSE(reply, { type: 'error', message: (error as Error).message });
      else if (!started) throw error;
    } finally {
      try { await prepared.dispose(failure); }
      finally { stopHeartbeat(); if (started && !reply.raw.destroyed && !reply.raw.writableEnded) endSSE(reply); }
    }
  });
}
