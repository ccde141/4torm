import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    dataDir: string;
    projectRoot: string;
  }
}
