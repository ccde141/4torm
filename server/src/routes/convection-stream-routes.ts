import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ConvectionRoundKind } from '../modules/convection/public.js';
import type { PreparedConvectionRound } from '../modules/convection/public.js';
import { endSSE, initSSE, pushSSE, pushSSEError, startHeartbeat } from '../utils/sse.js';
import { humanContext } from './collaboration-context.js';
import { routeText } from './convection-route-input.js';
import type { ConvectionRouteOptions } from './convection-route-types.js';

export async function registerConvectionStreamRoutes(
  app: FastifyInstance,
  options: ConvectionRouteOptions,
): Promise<void> {
  app.all('/session/:sessionId/speak', (request, reply) => (
    streamRound(request, reply, options, 'public')
  ));
  app.all('/session/:sessionId/chair', (request, reply) => (
    streamRound(request, reply, options, 'chair')
  ));
}

async function streamRound(
  request: FastifyRequest,
  reply: FastifyReply,
  options: ConvectionRouteOptions,
  roundKind: ConvectionRoundKind,
): Promise<void> {
  const sessionId = routeText(request.params, 'sessionId') as string;
  const message = routeText(request.body, 'message') as string;
  const prepared = await options.router.prepareTransport('convection', 'discussionRound', {
    sessionId, round: roundKind, message,
  }, humanContext(request)) as PreparedConvectionRound;
  let stopHeartbeat: () => void = () => undefined;
  let failure: unknown;
  try {
    reply.hijack();
    initSSE(reply);
    stopHeartbeat = startHeartbeat(reply);
    pushSSE(reply, { type: 'round-start', ...prepared.receipt });
    await prepared.run(event => pushSSE(reply, event));
    pushSSE(reply, { type: 'done' });
  } catch (error) {
    failure = error;
    request.log.error(error);
    try {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        pushSSEError(reply, error, `sse.convection.${roundKind}`);
      }
    } catch (writeError) { request.log.error(writeError); }
  } finally {
    try { await prepared.dispose(failure); }
    finally {
      try { stopHeartbeat(); }
      finally { if (!reply.raw.destroyed && !reply.raw.writableEnded) endSSE(reply); }
    }
  }
}
