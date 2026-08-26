import type { ProviderAdapter } from '../contracts/provider-adapter.js';
import { normalizeOllamaConfig } from '../config/ollama-config.js';

type JsonRecord = Record<string, unknown>;

function runtimeUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}/api/ps`;
  url.search = '';
  return url.toString();
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord : undefined;
}

async function discoverRuntime(
  identity: Parameters<NonNullable<ProviderAdapter['discoverRuntimeCapabilities']>>[0],
  fetchImpl: Parameters<NonNullable<ProviderAdapter['discoverRuntimeCapabilities']>>[1],
) {
  const response = await fetchImpl(runtimeUrl(identity.baseUrl));
  if (!response.ok) throw new Error(`Ollama 运行能力探测失败：HTTP ${response.status}`);
  const payload = record(await response.json());
  const models = Array.isArray(payload?.models)
    ? payload.models.map(record).filter((item): item is JsonRecord => !!item) : [];
  const loaded = models.find(item => item.name === identity.model || item.model === identity.model);
  if (!loaded) return undefined;
  const context = loaded.context_length;
  if (!Number.isInteger(context) || (context as number) <= 0) {
    throw new Error('Ollama 已加载模型未返回有效 context_length');
  }
  return { contextWindowTokens: context as number };
}

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  matches: () => false,
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'omit',
  },
  discoverRuntimeCapabilities: discoverRuntime,
  normalizeRequest(body, identity) {
    const defaults = normalizeOllamaConfig({ generationDefaults: identity.generationDefaults })
      .generationDefaults;
    if (defaults.topP !== null && body.top_p === undefined) body.top_p = defaults.topP;
    if (defaults.reasoningEffort !== 'auto' && body.reasoning_effort === undefined) {
      body.reasoning_effort = defaults.reasoningEffort;
    }
  },
};
