import { dashScopeAdapter } from './dashscope.js';
import { deepSeekAdapter } from './deepseek.js';
import { kimiAdapter } from './kimi.js';
import { lmStudioAdapter } from './lmstudio.js';
import { llamaCppAdapter } from './llama-cpp.js';
import { miniMaxAdapter } from './minimax.js';
import { openAICompatibleAdapter } from './openai-compatible.js';
import { openRouterAdapter } from './openrouter.js';
import { ollamaAdapter } from './ollama.js';
import { siliconFlowThinkingAdapter } from './siliconflow-thinking.js';
import { siliconFlowAdapter } from './siliconflow.js';
import type { ProviderAdapter, ProviderModelIdentity } from '../contracts/provider-adapter.js';
import type { ProviderType } from '../contracts/provider-config.js';
import { zhipuGlmAdapter } from './zhipu-glm.js';
import { vllmAdapter } from './vllm.js';

const PROVIDER_ADAPTERS: ProviderAdapter[] = [
  kimiAdapter,
  lmStudioAdapter,
  llamaCppAdapter,
  ollamaAdapter,
  vllmAdapter,
  deepSeekAdapter,
  zhipuGlmAdapter,
  dashScopeAdapter,
  openRouterAdapter,
  miniMaxAdapter,
  siliconFlowAdapter,
  siliconFlowThinkingAdapter,
  openAICompatibleAdapter,
];

const EXPLICIT_PROVIDER_ADAPTERS: Partial<Record<ProviderType, string>> = {
  'openai-cloud': 'openai-compatible',
  'openai-compatible': 'openai-compatible',
  deepseek: 'deepseek',
  kimi: 'kimi',
  dashscope: 'dashscope',
  zhipu: 'zhipu-glm',
  openrouter: 'openrouter',
  minimax: 'minimax',
  siliconflow: 'siliconflow',
  'llama-cpp': 'llama-cpp',
  'lm-studio': 'lmstudio',
  ollama: 'ollama',
  vllm: 'vllm',
  sglang: 'openai-compatible',
};

export function resolveProviderAdapter(identity: ProviderModelIdentity): ProviderAdapter {
  const explicitProvider = identity.providerType
    ? EXPLICIT_PROVIDER_ADAPTERS[identity.providerType]
    : undefined;
  if (explicitProvider) return PROVIDER_ADAPTERS.find(adapter => adapter.id === explicitProvider)!;
  const explicit = identity.profile
    ? PROVIDER_ADAPTERS.find(adapter => adapter.id === identity.profile)
    : undefined;
  if (explicit) return explicit;
  return PROVIDER_ADAPTERS.find(adapter => adapter.matches(identity))!;
}
