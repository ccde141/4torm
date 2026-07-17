import type { FastifyInstance } from 'fastify';

export interface AppContext {
  dataDir: string;
  projectRoot: string;
}

export function getAppContext(
  app: Pick<FastifyInstance, 'dataDir' | 'projectRoot'>,
): AppContext {
  return {
    dataDir: app.dataDir,
    projectRoot: app.projectRoot,
  };
}
