import type { ProviderAdapter, ProviderModelIdentity, ProviderRuntimeFetch } from '../contracts/provider-adapter.js';
import { normalizeVllmConfig } from '../config/vllm-config.js';

function endpoint(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  const root = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  url.pathname = path.startsWith('/v1') ? `${root}${path}` : path;
  url.search = path === '/server_info' ? 'config_format=json' : '';
  return url.toString();
}

async function json(response: Response, label: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`vLLM ${label}探测失败：HTTP ${response.status}`);
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`vLLM ${label}未返回对象`);
  }
  return value as Record<string, unknown>;
}

async function discoverRuntime(identity: ProviderModelIdentity, fetchImpl: ProviderRuntimeFetch) {
  const models = await json(await fetchImpl(endpoint(identity.baseUrl, '/v1/models')), '模型');
  const cards = Array.isArray(models.data) ? models.data : [];
  const card = cards.find(item => item && typeof item === 'object'
    && (item as Record<string, unknown>).id === identity.model) as Record<string, unknown> | undefined;
  if (!card) return undefined;
  const context = card.max_model_len;
  if (!Number.isInteger(context) || (context as number) <= 0) {
    throw new Error('vLLM 未返回有效上下文容量');
  }
  const infoResponse = await fetchImpl(endpoint(identity.baseUrl, '/server_info'));
  if (infoResponse.status === 404) return { contextWindowTokens: context as number };
  const info = await json(infoResponse, '服务配置');
  const config = object(info.vllm_config);
  const scheduler = object(config?.scheduler_config);
  const parallel = scheduler?.max_num_seqs;
  return {
    contextWindowTokens: context as number,
    ...(Number.isInteger(parallel) && (parallel as number) > 0
      ? { parallelSlots: parallel as number } : {}),
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export const vllmAdapter: ProviderAdapter = {
  id: 'vllm',
  matches: () => false,
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning',
  },
  discoverRuntimeCapabilities: discoverRuntime,
  normalizeRequest(body, identity) {
    const defaults = normalizeVllmConfig({ generationDefaults: identity.generationDefaults })
      .generationDefaults;
    const fields: Array<[string, number | null]> = [
      ['top_p', defaults.topP], ['top_k', defaults.topK], ['min_p', defaults.minP],
      ['repetition_penalty', defaults.repetitionPenalty],
    ];
    for (const [key, value] of fields) {
      if (value !== null && body[key] === undefined) body[key] = value;
    }
    if (defaults.reasoningEffort !== 'auto' && body.reasoning_effort === undefined) {
      body.reasoning_effort = defaults.reasoningEffort;
    }
  },
};
