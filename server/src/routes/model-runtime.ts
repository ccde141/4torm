import type { FastifyPluginAsync } from 'fastify';
import { getProviderCatalog } from '../model-runtime/providers/provider-catalog.js';
import { readToolTransportContract } from '../model-runtime/config/tool-transport-config.js';
import { getAppContext } from '../services/app-context.js';

export const modelRuntimeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/providers', async () => getProviderCatalog());
  app.get<{ Querystring: { providerId?: string; model?: string } }>(
    '/tool-transport', async (request, reply) => {
      const { providerId, model } = request.query;
      if (!providerId?.trim() || !model?.trim()) {
        return reply.code(400).send({ error: 'providerId and model are required' });
      }
      const { dataDir } = getAppContext(app);
      const contract = await readToolTransportContract(dataDir, providerId, model);
      if (!contract) return reply.code(404).send({ error: 'Provider not found' });
      return contract;
    },
  );
};
