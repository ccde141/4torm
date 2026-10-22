import type { FastifyInstance } from 'fastify';
import type { ConnectionAccess } from '../config/connection-access.js';

export async function connectionRoutes(app: FastifyInstance, options: { access: ConnectionAccess }): Promise<void> {
  app.get('/', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return options.access.handshake(request);
  });
  app.post('/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return options.access.signIn(request, reply);
  });
  app.delete('/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return options.access.signOut(request, reply);
  });
}
