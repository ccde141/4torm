import type { FastifyInstance } from 'fastify';
import { queryTradewind, type TradewindRouteOptions } from './tradewind-route-support.js';
import { tradewindReadIdentity } from './tradewind-read-identity.js';

export async function registerTradewindRuntimeRoutes(
  app: FastifyInstance, options: TradewindRouteOptions,
): Promise<void> {
  app.get('/nodes/status', async (request, reply) => reply.send(await queryTradewind(
    options, 'readNodeStatuses', tradewindReadIdentity(request.query), request,
  )));
}
