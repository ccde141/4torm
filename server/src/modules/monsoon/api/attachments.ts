import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { humanContext } from '../../../routes/collaboration-context.js';

const UPLOAD_BODY_LIMIT = 12 * 1024 * 1024;

export async function conversationAttachmentRoutes(
  app: FastifyInstance, options: { router: CollaborationRouter },
): Promise<void> {
  app.post('/attachments', { bodyLimit: UPLOAD_BODY_LIMIT }, async (request, reply) => (
    reply.send(await prepare(options.router, 'attachmentUpload', request.body, request))
  ));

  app.get('/attachments/:agentId/:sessionId/:attachmentId', async (request, reply) => {
    const image = await prepare(options.router, 'attachmentRead', request.params,
      request) as { data: Buffer; mimeType: string };
    return reply.header('Cache-Control', 'private, max-age=31536000, immutable')
      .type(image.mimeType).send(image.data);
  });

  app.delete('/attachments/:agentId/:sessionId/:attachmentId', async (request, reply) => (
    reply.send(await prepare(options.router, 'attachmentDelete', request.params, request))
  ));

  app.delete('/attachments/:agentId/:sessionId', async (request, reply) => (
    reply.send(await prepare(options.router, 'attachmentDeleteAll', request.params, request))
  ));
}

function prepare(router: CollaborationRouter, port: string, input: unknown, request: FastifyRequest) {
  return router.prepareTransport('monsoon', port, input, humanContext(request));
}
