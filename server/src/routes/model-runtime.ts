import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { getProviderCatalog } from '../model-runtime/providers/provider-catalog.js';
import { readToolTransportContract } from '../model-runtime/config/tool-transport-config.js';
import { getAppContext } from '../services/app-context.js';
import { discoverModels, ModelDiscoveryError } from '../model-runtime/providers/model-discovery.js';
import {
  createProvider, deleteProvider, findProvider, isRecord, patchProvider, publicConfiguration,
  ProviderConfigurationError, setActiveProviderModel,
} from '../model-runtime/config/provider-store.js';
import { resolveToolTransportContract } from '../model-runtime/config/tool-transport-contract.js';
import { probeConfiguredProvider } from '../model-runtime/providers/capability-probe.js';
import { providerRequestHeaders } from '../model-runtime/providers/runtime-fetch.js';

export const modelRuntimeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/providers', async () => getProviderCatalog());
  app.post('/models', async (request, reply) => {
    return respond(reply, async () => {
      const body = request.body;
      if (!isRecord(body) || body.providerId === undefined) return discoverModels(body);
      if (typeof body.providerId !== 'string' || Object.keys(body).some(key => key !== 'providerId')) {
        throw new ProviderConfigurationError(400, 'MODEL_DISCOVERY_INPUT_INVALID', '模型列表参数无效');
      }
      const provider = await findProvider(getAppContext(app).dataDir, body.providerId);
      const { protocol } = resolveToolTransportContract(provider, provider.models?.[0] ?? '');
      return discoverModels({ baseUrl: provider.baseUrl,
        ...(protocol === 'anthropic-messages' ? {} : { apiKey: provider.apiKey }),
        headers: Object.fromEntries(providerRequestHeaders(provider, protocol)) });
    });
  });
  app.get('/configuration', async (_request, reply) => respond(reply,
    () => publicConfiguration(getAppContext(app).dataDir)));
  app.post('/configuration/providers', async (request, reply) => respond(reply,
    () => createProvider(getAppContext(app).dataDir, request.body)));
  app.patch<{ Params: { id: string } }>('/configuration/providers/:id', async (request, reply) => respond(reply,
    () => patchProvider(getAppContext(app).dataDir, request.params.id, request.body)));
  app.delete<{ Params: { id: string } }>('/configuration/providers/:id', async (request, reply) => respond(reply,
    () => deleteProvider(getAppContext(app).dataDir, request.params.id)));
  app.put('/configuration/active-model', async (request, reply) => respond(reply,
    () => setActiveProviderModel(getAppContext(app).dataDir, request.body)));
  app.post('/probes', async (request, reply) => respond(reply,
    () => probeConfiguredProvider(getAppContext(app).dataDir, request.body)));
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

async function respond(reply: FastifyReply, action: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try { return await action(); }
  catch (error) {
    if (!(error instanceof ModelDiscoveryError) && !(error instanceof ProviderConfigurationError)) throw error;
    return reply.code(error.statusCode).send({ error: error.message, errorCode: error.code,
      ...(error instanceof ModelDiscoveryError && error.upstreamStatus !== undefined
        ? { upstreamStatus: error.upstreamStatus } : {}) });
  }
}
