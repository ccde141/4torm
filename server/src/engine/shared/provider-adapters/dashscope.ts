import { providerHost } from './host.js';
import type { ProviderAdapter } from './types.js';

export const dashScopeAdapter: ProviderAdapter = {
  id: 'dashscope',
  matches: identity => (
    isDashScopeHost(providerHost(identity.baseUrl))
    && isReasoningModel(identity.model)
  ),
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_content',
  },
  normalizeRequest: body => {
    body.enable_thinking = true;
    body.preserve_thinking = true;
  },
};

function isDashScopeHost(host: string): boolean {
  return host === 'dashscope.aliyuncs.com' || host === 'dashscope-intl.aliyuncs.com';
}

function isReasoningModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith('qwen3') || normalized.startsWith('qwq');
}
