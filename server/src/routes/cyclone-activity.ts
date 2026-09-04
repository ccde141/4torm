import type { FastifyInstance } from 'fastify';
import { readWorkshopExternalSeatActivities } from '../engine/cyclone/seat-activity.js';
import { listLockedSeatIds } from '../engine/cyclone/seat-store.js';

interface WorkshopParams {
  workshopId: string;
}

export async function cycloneActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/workshop/:workshopId/activities', async (request, reply) => {
    const { workshopId } = request.params as WorkshopParams;
    return reply.send({
      runningSeatIds: listLockedSeatIds(workshopId),
      activities: readWorkshopExternalSeatActivities(workshopId),
    });
  });
}
