import { resolveProviderAdapter } from './registry.js';
import type {
  ProviderModelCapabilities,
  ProviderModelIdentity,
  ProviderRuntimeCapabilities,
  ProviderRuntimeFetch,
} from '../contracts/provider-adapter.js';
import { normalizeLlamaCppConfig } from '../config/llama-cpp-config.js';
import { normalizeOllamaConfig } from '../config/ollama-config.js';
import { normalizeDeepSeekRuntimeConfig } from '../config/deepseek-config.js';
import { normalizeVllmConfig } from '../config/vllm-config.js';
import { normalizeKimiConfig } from '../config/kimi-config.js';
import { normalizeZhipuConfig } from '../config/zhipu-config.js';
import { normalizeDashScopeConfig } from '../config/dashscope-config.js';
import { normalizeMiniMaxConfig } from '../config/minimax-config.js';
import { mergeCustomRequestParameters } from './custom-request-parameters.js';

export type { ProviderModelCapabilities, ProviderModelIdentity } from '../contracts/provider-adapter.js';

export async function discoverProviderRuntimeCapabilities(
  identity: ProviderModelIdentity,
  fetchImpl: ProviderRuntimeFetch = fetch,
): Promise<ProviderRuntimeCapabilities | undefined> {
  return resolveProviderAdapter(identity).discoverRuntimeCapabilities?.(identity, fetchImpl);
}

export function resolveProviderModelCapabilities(
  identity: ProviderModelIdentity,
): ProviderModelCapabilities {
  return resolveProviderAdapter(identity).capabilities;
}

export function resolveMaxOutputTokens(
  identity: ProviderModelIdentity,
  requested?: number,
): number {
  const adapter = resolveProviderAdapter(identity);
  if (requested !== undefined) return adapter.constrainOutputTokens?.(requested) ?? requested;
  if (adapter.id === 'llama-cpp') {
    return llamaConfig(identity).generationDefaults.maxOutputTokens;
  }
  if (adapter.id === 'ollama') {
    return ollamaConfig(identity).generationDefaults.maxOutputTokens;
  }
  if (adapter.id === 'deepseek') {
    return deepSeekConfig(identity).generationDefaults.maxOutputTokens;
  }
  if (adapter.id === 'vllm') {
    return vllmConfig(identity).generationDefaults.maxOutputTokens;
  }
  if (adapter.id === 'kimi') {
    return kimiConfig(identity).generationDefaults.maxOutputTokens;
  }
  if (adapter.id === 'zhipu-glm') {
    return zhipuConfig(identity).generationDefaults.maxOutputTokens;
  }
  if (adapter.id === 'dashscope') {
    return dashScopeConfig(identity).generationDefaults.maxOutputTokens;
  }
  if (adapter.id === 'minimax') {
    return miniMaxConfig(identity).generationDefaults.maxOutputTokens;
  }
  return adapter.capabilities.defaultMaxOutputTokens ?? 8192;
}

export function resolveRequestTemperature(
  identity: ProviderModelIdentity,
  requested?: number,
): number | undefined {
  if (requested !== undefined) return requested;
  if (resolveProviderAdapter(identity).id === 'llama-cpp') {
    return llamaConfig(identity).generationDefaults.temperature ?? undefined;
  }
  if (resolveProviderAdapter(identity).id === 'ollama') {
    return ollamaConfig(identity).generationDefaults.temperature ?? undefined;
  }
  if (resolveProviderAdapter(identity).id === 'deepseek') {
    return deepSeekConfig(identity).generationDefaults.temperature ?? undefined;
  }
  if (resolveProviderAdapter(identity).id === 'vllm') {
    return vllmConfig(identity).generationDefaults.temperature ?? undefined;
  }
  if (resolveProviderAdapter(identity).id === 'zhipu-glm') {
    return zhipuConfig(identity).generationDefaults.temperature ?? undefined;
  }
  if (resolveProviderAdapter(identity).id === 'dashscope') {
    return dashScopeConfig(identity).generationDefaults.temperature ?? undefined;
  }
  if (resolveProviderAdapter(identity).id === 'minimax') {
    return miniMaxConfig(identity).generationDefaults.temperature ?? undefined;
  }
  return 0.7;
}

function llamaConfig(identity: ProviderModelIdentity) {
  return normalizeLlamaCppConfig({
    runtimePolicy: identity.runtimePolicy,
    generationDefaults: identity.generationDefaults,
  });
}

function ollamaConfig(identity: ProviderModelIdentity) {
  return normalizeOllamaConfig({ generationDefaults: identity.generationDefaults });
}

function deepSeekConfig(identity: ProviderModelIdentity) {
  return normalizeDeepSeekRuntimeConfig({ generationDefaults: identity.generationDefaults });
}

function vllmConfig(identity: ProviderModelIdentity) {
  return normalizeVllmConfig({ generationDefaults: identity.generationDefaults });
}

function kimiConfig(identity: ProviderModelIdentity) {
  return normalizeKimiConfig({ generationDefaults: identity.generationDefaults });
}

function zhipuConfig(identity: ProviderModelIdentity) {
  return normalizeZhipuConfig({ generationDefaults: identity.generationDefaults });
}

function dashScopeConfig(identity: ProviderModelIdentity) {
  return normalizeDashScopeConfig({ generationDefaults: identity.generationDefaults });
}

function miniMaxConfig(identity: ProviderModelIdentity) {
  return normalizeMiniMaxConfig({ generationDefaults: identity.generationDefaults });
}

export function resolveSafePromptTokens(
  contextWindowTokens: number,
  maxOutputTokens: number,
): number {
  const safetyMargin = Math.ceil(contextWindowTokens * 0.05);
  const available = contextWindowTokens - maxOutputTokens - safetyMargin;
  if (available <= 0) throw new Error('模型上下文容量不足以容纳输出预算');
  return available;
}

export function normalizeChatRequestBody(
  identity: ProviderModelIdentity,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const body = { ...source };
  const adapter = resolveProviderAdapter(identity);
  const capabilities = adapter.capabilities;
  if (capabilities.temperature === 'omit') delete body.temperature;
  if (capabilities.maxTokensField === 'omit') {
    delete body.max_tokens;
    delete body.max_completion_tokens;
  }
  if (capabilities.maxTokensField === 'max_completion_tokens' && body.max_tokens !== undefined) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  adapter.normalizeRequest?.(body, identity);
  const merged = mergeCustomRequestParameters(body, identity.customRequestParameters);
  const tokenField = capabilities.maxTokensField;
  if (adapter.constrainOutputTokens && tokenField !== 'omit' && merged[tokenField] !== undefined) {
    const tokens = merged[tokenField];
    if (typeof tokens !== 'number') throw new Error('模型 max_tokens 必须是正整数');
    merged[tokenField] = adapter.constrainOutputTokens(tokens);
  }
  return merged;
}
