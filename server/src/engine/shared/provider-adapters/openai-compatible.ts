import type { ProviderAdapter } from './types.js';

export const openAICompatibleAdapter: ProviderAdapter = {
  id: 'openai-compatible',
  matches: () => true,
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'omit',
  },
};
