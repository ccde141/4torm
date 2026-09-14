import type { FastifyInstance } from 'fastify';
import { generateSessionTitle } from '../engine/conversation/session-title.js';

export function registerConversationTitle(app: FastifyInstance): void {
  app.post('/title', {
    preValidation: async (req, reply) => {
      const value = req.body;
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.values(value).some(field => typeof field !== 'string')
        || Object.keys(value).some(key => !['model', 'user', 'assistant'].includes(key))) {
        return reply.status(400).send({ error: '标题请求必须包含 model、user、assistant 字符串' });
      }
    },
    schema: { body: {
      type: 'object', additionalProperties: false, required: ['model', 'user', 'assistant'],
      properties: {
        model: { type: 'string', minLength: 1, maxLength: 512 },
        user: { type: 'string', minLength: 1, maxLength: 2000 },
        assistant: { type: 'string', minLength: 1, maxLength: 2000 },
      },
    } },
  }, async req => {
    const input = req.body as { model: string; user: string; assistant: string };
    return { title: await generateSessionTitle(app.dataDir, input) };
  });
}
