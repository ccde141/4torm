import type { CollaborationRouter } from '../engine/collaboration/router.js';
import { humanContext } from './collaboration-context.js';

export interface TradewindRouteOptions { router: CollaborationRouter }

export function queryTradewind(
  options: TradewindRouteOptions, method: string, input: unknown, request: FastifyRequest,
): Promise<unknown> {
  return options.router.invoke({ feature: 'tradewind', method, input },
    humanContext(request));
}
import type { FastifyRequest } from 'fastify';
