import type { FastifyInstance } from 'fastify';
import { TeamStore } from '../engine/conversation/team/store.js';

/** Read-only observation: viewing a report never acknowledges it for Main. */
export function registerConversationTeam(app: FastifyInstance, dataDir: string): void {
  app.get('/team/context', async (request, reply) => {
    const { agentId, sessionId, memberId } = request.query as Record<string, unknown>;
    if (![agentId, sessionId, memberId].every(value => typeof value === 'string'
      && /^[a-zA-Z0-9_-]{1,160}$/.test(value))) return reply.code(400).send({ error: 'TEAM_INVALID_OWNER' });
    const store = new TeamStore(dataDir, { agentId: String(agentId), sessionId: String(sessionId) });
    const state = await store.read();
    const member = state.members.find(item => item.id === memberId);
    if (!member) return reply.code(404).send({ error: 'TEAM_MEMBER_NOT_FOUND' });
    return { revision: state.revision, memberId, messages: member.context
      .filter(message => message.role !== 'system')
      .map(({ role, content, toolCalls, toolCallId }) => ({ role, content, toolCalls, toolCallId })) };
  });
  app.get('/team', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { agentId, sessionId } = query;
    if (typeof agentId !== 'string' || typeof sessionId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,160}$/.test(agentId) || !/^[a-zA-Z0-9_-]{1,160}$/.test(sessionId)) {
      return reply.code(400).send({ error: 'TEAM_INVALID_OWNER' });
    }
    const store = new TeamStore(dataDir, { agentId, sessionId });
    const state = await store.recoverInterrupted();
    return { revision: state.revision,
      members: state.members.map(({ context: _context, ...member }) => member),
      reports: state.reports };
  });
}
