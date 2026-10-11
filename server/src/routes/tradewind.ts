import type { FastifyInstance } from 'fastify';
import { registerTradewindRuntimeRoutes } from './tradewind-runtime-routes.js';
import { registerTradewindNodeRoutes } from './tradewind-node-routes.js';
import { registerTradewindMeetingStreamRoutes } from './tradewind-meeting-stream-routes.js';
import { registerTradewindMeetingResourceRoutes } from './tradewind-meeting-resource-routes.js';
import type { TradewindRouteOptions } from './tradewind-route-support.js';

export { stopActiveTradewindExecution } from '../services/tradewind-execution.js';

export async function tradewindRoutes(app: FastifyInstance, options: TradewindRouteOptions): Promise<void> {
  await registerTradewindRuntimeRoutes(app, options);
  await registerTradewindNodeRoutes(app, options);
  await registerTradewindMeetingStreamRoutes(app, options);
  await registerTradewindMeetingResourceRoutes(app, options);
}
