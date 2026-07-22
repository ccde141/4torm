import type { FastifyInstance } from 'fastify';
import { getAllAgentActivities } from '../engine/shared/agent-activity.js';

export async function agentActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/activity', async () => Object.fromEntries(getAllAgentActivities()));
}
