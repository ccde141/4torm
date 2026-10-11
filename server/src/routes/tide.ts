import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TideFeature } from '../modules/tide/public.js';
import type { CollaborationRouter } from '../engine/collaboration/router.js';
import { humanContext } from './collaboration-context.js';
import { initSSE, pushSSE, startHeartbeat } from '../utils/sse.js';

export interface TideRouteOptions {
  feature: TideFeature;
  router: CollaborationRouter;
}

export async function tideRoutes(app: FastifyInstance, options: TideRouteOptions): Promise<void> {
  app.get('/changes', async (request, reply) => {
    await invokeTideQuery(options, 'readTaskList', {}, request);
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
    stop = options.feature.changes.subscribe(signal => {
      try {
        pushSSE(reply, signal);
        if (reply.raw.writableLength > 64_000) reply.raw.end();
      } catch { reply.raw.destroy(); }
    });
    if (closed || reply.raw.destroyed) { close(); return; }
    stopHeartbeat = startHeartbeat(reply);
    reply.raw.write(': connected\n\n');
  });

  app.get('/task/:taskId', async (request, reply) => {
    return reply.send(await invokeTideQuery(options, 'readTaskDetail',
      { taskId: taskIdOf(request.params) }, request));
  });

  app.get('/tasks', async (request, reply) => {
    return reply.send(await invokeTideQuery(options, 'readTaskList', {}, request));
  });

  app.get('/task/:taskId/runs', async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = Number.parseInt(query.limit ?? '20', 10);
    return reply.send(await invokeTideQuery(options, 'readTaskRuns',
      { taskId: taskIdOf(request.params), limit }, request));
  });

  app.get('/sessions/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    return reply.send(await invokeTideQuery(options, 'readSessions', { agentId }, request));
  });

  app.get('/session/:agentId/:sessionId', async (request, reply) => {
    const { agentId, sessionId } = request.params as { agentId: string; sessionId: string };
    return reply.send(await invokeTideQuery(options, 'readSession', { agentId, sessionId }, request));
  });

}

function invokeTideQuery(options: TideRouteOptions, method: string, input: unknown, request: FastifyRequest) {
  return options.router.invoke({ feature: 'tide', method, input }, humanContext(request));
}

function taskIdOf(params: unknown): string {
  return (params as { taskId: string }).taskId;
}
