import type { ProviderAdapter } from '../contracts/provider-adapter.js';
import { normalizeLlamaCppConfig } from '../config/llama-cpp-config.js';

function propsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}/props`;
  url.search = '';
  return url.toString();
}

export const llamaCppAdapter: ProviderAdapter = {
  id: 'llama-cpp',
  matches: () => false,
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    defaultMaxOutputTokens: 2048,
    reasoningHistory: 'omit',
  },
  normalizeRequest(body, identity) {
    const config = providerConfig(identity);
    applySampling(body, config.generationDefaults);
    applyThinking(body, config.generationDefaults);
  },
  async discoverRuntimeCapabilities(identity, fetchImpl) {
    const response = await fetchImpl(propsUrl(identity.baseUrl));
    if (!response.ok) throw new Error(`llama.cpp 运行能力探测失败：HTTP ${response.status}`);
    const data = await response.json() as Record<string, unknown>;
    const settings = data.default_generation_settings as Record<string, unknown> | undefined;
    const contextWindowTokens = settings?.n_ctx;
    if (!Number.isInteger(contextWindowTokens) || (contextWindowTokens as number) <= 0) {
      throw new Error('llama.cpp 未返回有效上下文容量');
    }
    const config = providerConfig(identity);
    const rawModalities = data.modalities as Record<string, unknown> | undefined;
    const parallelSlots = data.total_slots;
    const observedContext = contextWindowTokens as number;
    const configuredContext = config.runtimePolicy.contextWindowTokens;
    const configuredConcurrency = config.runtimePolicy.maxConcurrency;
    return {
      contextWindowTokens: configuredContext === null
        ? observedContext : Math.min(observedContext, configuredContext),
      ...(Number.isInteger(parallelSlots) && (parallelSlots as number) > 0
        ? { parallelSlots: configuredConcurrency === null
          ? parallelSlots as number : Math.min(parallelSlots as number, configuredConcurrency) } : {}),
      ...(rawModalities ? {
        modalities: {
          vision: rawModalities.vision === true,
          audio: rawModalities.audio === true,
          video: rawModalities.video === true,
        },
      } : {}),
    };
  },
};

function providerConfig(identity: Parameters<NonNullable<ProviderAdapter['normalizeRequest']>>[1]) {
  return normalizeLlamaCppConfig({
    runtimePolicy: identity.runtimePolicy,
    generationDefaults: identity.generationDefaults,
  });
}

function applyThinking(
  body: Record<string, unknown>,
  defaults: ReturnType<typeof normalizeLlamaCppConfig>['generationDefaults'],
): void {
  if (defaults.thinkingMode !== 'auto') {
    const current = body.chat_template_kwargs;
    body.chat_template_kwargs = {
      ...(current && typeof current === 'object' ? current as Record<string, unknown> : {}),
      enable_thinking: defaults.thinkingMode === 'enabled',
    };
  }
  if (defaults.thinkingBudgetTokens !== null && body.thinking_budget_tokens === undefined) {
    body.thinking_budget_tokens = defaults.thinkingBudgetTokens;
  }
}

function applySampling(
  body: Record<string, unknown>,
  defaults: ReturnType<typeof normalizeLlamaCppConfig>['generationDefaults'],
): void {
  const values: Array<[string, number | null]> = [
    ['top_k', defaults.topK],
    ['top_p', defaults.topP],
    ['min_p', defaults.minP],
    ['repeat_penalty', defaults.repeatPenalty],
  ];
  for (const [key, value] of values) {
    if (value !== null && body[key] === undefined) body[key] = value;
  }
}
