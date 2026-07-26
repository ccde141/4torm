import { dashScopeAdapter } from './dashscope.js';
import { deepSeekAdapter } from './deepseek.js';
import { kimiAdapter } from './kimi.js';
import { lmStudioAdapter } from './lmstudio.js';
import { miniMaxAdapter } from './minimax.js';
import { openAICompatibleAdapter } from './openai-compatible.js';
import { openRouterAdapter } from './openrouter.js';
import { siliconFlowThinkingAdapter } from './siliconflow-thinking.js';
import type { ProviderAdapter, ProviderModelIdentity } from './types.js';
import { zhipuGlmAdapter } from './zhipu-glm.js';

const PROVIDER_ADAPTERS: ProviderAdapter[] = [
  kimiAdapter,
  lmStudioAdapter,
  deepSeekAdapter,
  zhipuGlmAdapter,
  dashScopeAdapter,
  openRouterAdapter,
  miniMaxAdapter,
  siliconFlowThinkingAdapter,
  openAICompatibleAdapter,
];

export function resolveProviderAdapter(identity: ProviderModelIdentity): ProviderAdapter {
  const explicit = identity.profile
    ? PROVIDER_ADAPTERS.find(adapter => adapter.id === identity.profile)
    : undefined;
  if (explicit) return explicit;
  return PROVIDER_ADAPTERS.find(adapter => adapter.matches(identity))!;
}
