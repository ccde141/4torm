import type { FastifyInstance } from 'fastify';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';

interface WorkshopParams {
  workshopId: string;
}

export async function cycloneOrganizationRoutes(
  app: FastifyInstance,
  options: CycloneRouteOptions,
): Promise<void> {
  app.get('/workshop/:workshopId/organization', async (request, reply) => {
    const { workshopId } = request.params as WorkshopParams;
    return reply.send(await queryCyclone(options, 'readWorkshopOrganization',
      { workshopId }, request));
  });
}
