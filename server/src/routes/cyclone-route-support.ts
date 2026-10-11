import type { CollaborationRouter } from '../engine/collaboration/router.js';
import { humanContext } from './collaboration-context.js';
import type { CycloneFeature } from '../modules/cyclone/public.js';

export interface CycloneRouteOptions {
  router: CollaborationRouter;
  feature: CycloneFeature;
}

export function queryCyclone(
  options: CycloneRouteOptions, method: string, input: unknown, request: FastifyRequest,
): Promise<unknown> {
  return options.router.invoke({ feature: 'cyclone', method, input }, humanContext(request));
}
import type { FastifyRequest } from 'fastify';
