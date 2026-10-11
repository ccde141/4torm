import type { FastifyInstance } from 'fastify';
import { registerConvectionSessionRoutes } from './convection-session-routes.js';
import { registerConvectionStreamRoutes } from './convection-stream-routes.js';
import { registerConvectionFeedRoutes } from './convection-feed-routes.js';
import type { ConvectionRouteOptions } from './convection-route-types.js';

export type { ConvectionRouteOptions } from './convection-route-types.js';

export async function convectionRoutes(
  app: FastifyInstance,
  options: ConvectionRouteOptions,
): Promise<void> {
  await registerConvectionStreamRoutes(app, options);
  await registerConvectionFeedRoutes(app, options);
  await registerConvectionSessionRoutes(app, options);
}
