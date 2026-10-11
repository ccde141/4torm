import type { FastifyInstance } from 'fastify';
import { queryTradewind, type TradewindRouteOptions } from './tradewind-route-support.js';

export async function registerTradewindMeetingResourceRoutes(
  app: FastifyInstance, options: TradewindRouteOptions,
): Promise<void> {
  app.get('/meeting/:nodeId/status', async (request, reply) => {
    const { nodeId } = request.params as { nodeId: string };
    return reply.send(await queryTradewind(options, 'readMeetingStatus', { nodeId }, request));
  });
}
