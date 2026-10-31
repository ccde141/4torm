import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { humanContext } from '../../../routes/collaboration-context.js';
import { toolImagePreview } from '../../../engine/shared/tool-image-preview.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';

const UPLOAD_BODY_LIMIT = 12 * 1024 * 1024;

export async function conversationAttachmentRoutes(
  app: FastifyInstance, options: { router: CollaborationRouter },
): Promise<void> {
  app.post('/attachments', { bodyLimit: UPLOAD_BODY_LIMIT }, async (request, reply) => (
    reply.send(await prepare(options.router, 'attachmentUpload', request.body, request))
  ));

  app.get<{ Querystring: { preview?: string } }>('/attachments/:agentId/:sessionId/:attachmentId', async (request, reply) => {
    const preview = request.query.preview;
    if (preview !== undefined && preview !== '1') throw frameworkError({ code: 'IMAGE_PREVIEW_INPUT_INVALID',
      kind: 'validation', message: '图片预览参数无效', source: 'monsoon.attachments', retryable: false });
    const image = await prepare(options.router, 'attachmentRead', request.params,
      request) as { data: Buffer; mimeType: string };
    const data = preview === '1' ? await toolImagePreview(image.data) : image.data;
    return reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
      .type(preview === '1' ? 'image/webp' : image.mimeType).send(data);
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
