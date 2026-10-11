import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ConvectionConferenceEvent, PreparedConvectionFeed } from
  '../modules/convection/public.js';
import { endSSE, initSSE, pushSSE, pushSSEError, startHeartbeat } from '../utils/sse.js';
import { humanContext } from './collaboration-context.js';
import type { ConvectionRouteOptions } from './convection-route-types.js';

export async function registerConvectionFeedRoutes(
  app: FastifyInstance,
  options: ConvectionRouteOptions,
): Promise<void> {
  app.get('/events', async (request, reply) => {
    const prepared = await options.router.prepareTransport('convection', 'conferenceFeed',
      request.query ?? {}, humanContext(request)) as PreparedConvectionFeed;
    await streamFeed(prepared, reply);
  });
}

async function streamFeed(prepared: PreparedConvectionFeed, reply: FastifyReply): Promise<void> {
  reply.hijack();
  initSSE(reply);
  const stopHeartbeat = startHeartbeat(reply);
  let closed = false;
  let ready = false;
  const pending: ConvectionConferenceEvent[] = [];
  const send = (event: ConvectionConferenceEvent) => {
    if (!closed) pushSSE(reply, event);
  };
  const unsubscribe = prepared.subscribe(event => {
    if (ready) send(event);
    else pending.push(event);
  });
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    stopHeartbeat();
  };
  reply.raw.once('close', close);
  try {
    const snapshot = await prepared.snapshot();
    if (closed) return;
    pushSSE(reply, { type: 'snapshot', ...snapshot });
    ready = true;
    pending.forEach(send);
  } catch (error) {
    if (!closed) pushSSEError(reply, error, 'sse.convection.feed');
    close();
    endSSE(reply);
  }
}
