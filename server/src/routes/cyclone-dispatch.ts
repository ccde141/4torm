import type { FastifyInstance } from 'fastify';
import { queryCyclone, type CycloneRouteOptions } from './cyclone-route-support.js';

interface DispatchParams {
  workshopId: string;
  roomId: string;
}

export async function cycloneDispatchRoutes(
  app: FastifyInstance,
  options: CycloneRouteOptions,
): Promise<void> {
  app.get('/workshop/:workshopId/dispatches', async (request, reply) => {
    const { workshopId } = request.params as DispatchParams;
    return reply.send(await queryCyclone(options, 'listWorkshopDispatches',
      { workshopId }, request));
  });

  app.get('/workshop/:workshopId/room/:roomId/dispatches', async (request, reply) => {
    const { workshopId, roomId } = request.params as DispatchParams;
    return reply.send(await queryCyclone(options, 'listRoomDispatches',
      { workshopId, roomId }, request));
  });
}
