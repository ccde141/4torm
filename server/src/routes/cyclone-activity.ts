import type { FastifyInstance } from 'fastify';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';

interface WorkshopParams {
  workshopId: string;
}

export async function cycloneActivityRoutes(
  app: FastifyInstance, options: CycloneRouteOptions,
): Promise<void> {
  app.get('/workshop/:workshopId/activities', async (request, reply) => {
    const { workshopId } = request.params as WorkshopParams;
    return reply.send(await queryCyclone(options, 'readWorkshopActivities', { workshopId }, request));
  });
}
