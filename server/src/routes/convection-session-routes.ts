import type { FastifyInstance } from 'fastify';
import { routeText } from './convection-route-input.js';
import type { ConvectionRouteOptions } from './convection-route-types.js';
import { humanContext } from './collaboration-context.js';

export async function registerConvectionSessionRoutes(
  app: FastifyInstance,
  options: ConvectionRouteOptions,
): Promise<void> {
  app.get('/list', async (request, reply) => reply.send(await options.router.invoke({
    feature: 'convection', method: 'listSessions', input: {},
  }, humanContext(request))));
  app.get('/session/:sessionId/status', async (request, reply) => {
    const sessionId = routeText(request.params, 'sessionId') as string;
    return reply.send(await options.router.invoke({
      feature: 'convection', method: 'readSession', input: { sessionId },
    }, humanContext(request)));
  });
}
