import type { FastifyInstance } from 'fastify';
import { humanContext } from './collaboration-context.js';
import { openTradewindStream } from './tradewind-stream-response.js';
import type { TradewindRouteOptions } from './tradewind-route-support.js';
import type { PreparedTradewindEventStream } from '../modules/tradewind/public.js';
import { tradewindReadIdentity } from './tradewind-read-identity.js';

export async function registerTradewindMeetingStreamRoutes(
  app: FastifyInstance, options: TradewindRouteOptions,
): Promise<void> {
  app.get('/meeting/:nodeId/events', async (request, reply) => {
    const { nodeId } = request.params as { nodeId: string };
    const prepared = await options.router.prepareTransport('tradewind', 'meetingEvents',
      { nodeId, executionId: tradewindReadIdentity(request.query).executionId }, humanContext(request)) as PreparedTradewindEventStream;
    openTradewindStream(request, reply, prepared);
  });
}
