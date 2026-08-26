import type { ProviderAdapter } from '../contracts/provider-adapter.js';

export const siliconFlowThinkingAdapter: ProviderAdapter = {
  id: 'siliconflow-thinking',
  matches: () => false,
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_content',
  },
  normalizeRequest: body => {
    body.enable_thinking = true;
  },
};
