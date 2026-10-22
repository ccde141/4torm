import type { FastifyInstance } from 'fastify';
import type { CollaborationRouter } from '../engine/collaboration/router.js';
import { COLLABORATION_FEATURES, type CollaborationFeature } from '../engine/collaboration/contracts.js';
import { humanContext } from './collaboration-context.js';
import { frameworkError } from '../engine/shared/framework-error.js';

export async function toolMediaRoutes(app: FastifyInstance,
  options: { router: CollaborationRouter }): Promise<void> {
  app.get<{ Params: { feature: string; imageId: string }; Querystring: Record<string, string> }>(
    '/:feature/:imageId', async (request, reply) => {
      if (!COLLABORATION_FEATURES.includes(request.params.feature as CollaborationFeature)) {
        throw frameworkError({ code: 'TOOL_IMAGE_FEATURE_INVALID', kind: 'validation',
          message: '工具图片所属功能区无效', source: 'tool-media', retryable: false });
      }
      const image = await options.router.prepareTransport(request.params.feature as CollaborationFeature,
        'toolImageRead', { ...request.query, imageId: request.params.imageId }, humanContext(request)) as {
          data: Buffer; mimeType: string };
      return reply.header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff').type(image.mimeType).send(image.data);
    });
}
