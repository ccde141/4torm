import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import {
  deleteAgentAvatar,
  readAgentAvatar,
  saveAgentAvatar,
} from '../services/agent-avatar.js';

const BODY_LIMIT = 2 * 1024 * 1024;

export async function agentAvatarRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  app.put('/:agentId/avatar', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const body = req.body as Record<string, unknown>;
    try {
      return await saveAgentAvatar(dataDir, agentId, typeof body?.dataUrl === 'string' ? body.dataUrl : '');
    } catch (error) {
      const message = (error as Error).message;
      return reply.status(message === 'Agent 不存在' ? 404 : 400).send({ error: message });
    }
  });

  app.get('/:agentId/avatar', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    try {
      const data = await readAgentAvatar(dataDir, agentId);
      return reply.header('Cache-Control', 'private, max-age=31536000, immutable')
        .type('image/webp').send(data);
    } catch {
      return reply.status(404).send({ error: '头像不存在' });
    }
  });

  app.delete('/:agentId/avatar', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    try {
      await deleteAgentAvatar(dataDir, agentId);
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });
}
