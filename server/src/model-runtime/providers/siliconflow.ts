import type { ProviderAdapter } from '../contracts/provider-adapter.js';

export const siliconFlowAdapter: ProviderAdapter = {
  id: 'siliconflow',
  matches: () => false,
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_content',
  },
};
