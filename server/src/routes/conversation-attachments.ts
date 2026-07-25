import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { getAppContext } from '../services/app-context.js';
import { agentSessionFile } from '../services/data-paths.js';
import {
  deleteConversationAttachments,
  readConversationAttachment,
  saveConversationAttachment,
} from '../services/conversation-attachments.js';

const UPLOAD_BODY_LIMIT = 12 * 1024 * 1024;

export async function conversationAttachmentRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  app.post('/attachments', { bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const agentId = text(body.agentId);
    const sessionId = text(body.sessionId);
    if (!agentId || !sessionId) return reply.status(400).send({ error: '缺少 agentId 或 sessionId' });
    try {
      await fs.access(agentSessionFile(dataDir, agentId, sessionId));
    } catch {
      return reply.status(404).send({ error: '会话不存在' });
    }
    try {
      return await saveConversationAttachment(dataDir, agentId, sessionId, {
        name: text(body.name), mimeType: text(body.mimeType), dataUrl: text(body.dataUrl),
      });
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  app.get('/attachments/:agentId/:sessionId/:attachmentId', async (req, reply) => {
    const { agentId, sessionId, attachmentId } = req.params as Record<string, string>;
    try {
      await fs.access(agentSessionFile(dataDir, agentId, sessionId));
      const image = await readConversationAttachment(dataDir, agentId, sessionId, attachmentId);
      return reply.header('Cache-Control', 'private, max-age=31536000, immutable')
        .type(image.mimeType).send(image.data);
    } catch {
      return reply.status(404).send({ error: '附件不存在' });
    }
  });

  app.delete('/attachments/:agentId/:sessionId', async (req, reply) => {
    const { agentId, sessionId } = req.params as Record<string, string>;
    try {
      await deleteConversationAttachments(dataDir, agentId, sessionId);
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
