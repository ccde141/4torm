import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchProviderCatalog, providerSelectionPatch } from './provider-catalog.js';

const responseBody = {
  version: 1,
  providers: [{
    id: 'llama-cpp', label: 'llama.cpp', defaultTransport: 'openai-chat-completions',
    supportedTransports: ['openai-chat-completions'], probeStrategy: 'llama-cpp-metadata',
    verificationState: 'context-ready', selectable: true,
    configuration: {
      defaults: {
        runtimePolicy: { contextWindowTokens: null, maxConcurrency: null },
        generationDefaults: { maxOutputTokens: 2048, temperature: null },
      },
      sections: [{
        id: 'generationDefaults', label: { zh: '生成默认值', en: 'Generation defaults' },
        fields: [{
          path: 'generationDefaults.maxOutputTokens',
          label: { zh: '最大输出', en: 'Maximum output' },
          description: { zh: '输出上限', en: 'Output cap' },
          kind: 'integer' as const, nullable: false, min: 1, max: 1_000_000,
        }, {
          path: 'generationDefaults.thinkingMode',
          label: { zh: '思考模式', en: 'Thinking mode' },
          description: { zh: '控制思考', en: 'Controls thinking' },
          kind: 'select' as const, nullable: false,
          options: [
            { value: 'auto', label: { zh: '自动', en: 'Auto' } },
            { value: 'enabled', label: { zh: '开启', en: 'Enabled' } },
          ],
        }],
      }],
    },
  }],
  presets: [{
    id: 'llama-cpp', label: 'llama.cpp', baseUrl: 'http://localhost:8080/v1',
    protocol: 'openai-chat-completions' as const,
    providerType: 'llama-cpp', transport: 'openai-chat-completions',
  }],
};

test('provider catalog is fetched from the model runtime route', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    assert.equal(input, '/api/model-runtime/providers');
    return new Response(JSON.stringify(responseBody), { status: 200 });
  });
  assert.deepEqual(await fetchProviderCatalog(), responseBody);
});

test('malformed provider catalog fails at the HTTP boundary', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ version: 1, providers: [{}], presets: [] })));
  await assert.rejects(fetchProviderCatalog(), /Invalid model provider catalog/);
});

test('only selectable catalog entries produce stable configuration fields', () => {
  assert.deepEqual(providerSelectionPatch(responseBody, 'llama-cpp'), {
    providerType: 'llama-cpp',
    transport: 'openai-chat-completions',
    runtimePolicy: { contextWindowTokens: null, maxConcurrency: null },
    generationDefaults: { maxOutputTokens: 2048, temperature: null },
  });
  assert.throws(() => providerSelectionPatch({ ...responseBody, providers: [{ ...responseBody.providers[0]!, selectable: false }] }, 'llama-cpp'), /not selectable/);
});

test('switching to a provider without a schema clears provider-owned parameters', () => {
  const catalog = {
    ...responseBody,
    providers: [...responseBody.providers, {
      id: 'generic-openai', label: 'Generic OpenAI', defaultTransport: 'openai-chat-completions',
      supportedTransports: ['openai-chat-completions'], probeStrategy: 'openai-compatible',
      verificationState: 'transport-ready', selectable: true,
    }],
  };
  assert.deepEqual(providerSelectionPatch(catalog, 'generic-openai'), {
    providerType: 'generic-openai', transport: 'openai-chat-completions',
    runtimePolicy: undefined, generationDefaults: undefined,
  });
});

test('malformed provider configuration schema is rejected', async (t) => {
  const broken = structuredClone(responseBody);
  broken.providers[0]!.configuration!.sections[0]!.fields[0]!.min = Number.NaN;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(broken)));
  await assert.rejects(fetchProviderCatalog(), /Invalid model provider catalog/);
});
