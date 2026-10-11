import type { FastifyInstance } from 'fastify';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { humanContext } from '../../../routes/collaboration-context.js';

/** Read-only observation: viewing a report never acknowledges it for Main. */
export function registerConversationTeam(app: FastifyInstance, router: CollaborationRouter): void {
  app.get('/team/context', async (request, reply) => {
    const { agentId, sessionId, memberId } = request.query as Record<string, unknown>;
    if (![agentId, sessionId, memberId].every(value => typeof value === 'string'
      && /^[a-zA-Z0-9_-]{1,160}$/.test(value))) return reply.code(400).send({ error: 'TEAM_INVALID_OWNER' });
    return router.invoke({ feature: 'monsoon', method: 'readMemberContext',
      input: { agentId, sessionId, memberId } }, humanContext(request));
  });
}
