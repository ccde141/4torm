import type { FastifyInstance } from 'fastify';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';

export function registerCycloneContactRoutes(app: FastifyInstance, options: CycloneRouteOptions): void {
  app.get('/workshop/:workshopId/contact/:contactId', async request => {
    const { workshopId, contactId } = request.params as { workshopId: string; contactId: string };
    const query = request.query as Record<string, unknown>;
    return queryCyclone(options, 'readContactCommunication', { ...query, workshopId, contactId,
      ...(query.offset === undefined ? {} : {
        offset: typeof query.offset === 'string' && /^\d+$/.test(query.offset) ? Number(query.offset) : NaN,
      }) }, request);
  });
}
