import type { ProviderAdapter } from '../contracts/provider-adapter.js';

export const openAICompatibleAdapter: ProviderAdapter = {
  id: 'openai-compatible',
  matches: () => true,
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'omit',
  },
};
