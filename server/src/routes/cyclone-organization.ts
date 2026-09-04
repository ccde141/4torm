import type { FastifyInstance } from 'fastify';
import {
  loadWorkshopOrganization,
  saveWorkshopOrganization,
} from '../engine/cyclone/organization/organization-store.js';
import { getAppContext } from '../services/app-context.js';

interface WorkshopParams {
  workshopId: string;
}

export async function cycloneOrganizationRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  app.get('/workshop/:workshopId/organization', async (request, reply) => {
    const { workshopId } = request.params as WorkshopParams;
    return reply.send(await loadWorkshopOrganization(dataDir, workshopId));
  });

  app.put('/workshop/:workshopId/organization', async (request, reply) => {
    const { workshopId } = request.params as WorkshopParams;
    return reply.send(await saveWorkshopOrganization(dataDir, workshopId, request.body));
  });
}
