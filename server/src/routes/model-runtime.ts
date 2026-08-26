import type { FastifyPluginAsync } from 'fastify';
import { getProviderCatalog } from '../model-runtime/providers/provider-catalog.js';

export const modelRuntimeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/providers', async () => getProviderCatalog());
};
