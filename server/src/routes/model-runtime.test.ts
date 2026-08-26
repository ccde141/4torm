import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { modelRuntimeRoutes } from './model-runtime.js';

test('model runtime provider catalog is available without reading user configuration', async (t) => {
  const app = Fastify();
  await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/model-runtime/providers' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(Array.isArray(body.providers), true);
  assert.equal(Array.isArray(body.presets), true);
  assert.equal(body.providers.some((provider: { id: string }) => provider.id === 'llama-cpp'), true);
  assert.equal(JSON.stringify(body).includes('apiKey'), false);
});
