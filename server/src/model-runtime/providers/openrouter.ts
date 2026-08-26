import { providerHost } from './host.js';
import type { ProviderAdapter } from '../contracts/provider-adapter.js';

export const openRouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  matches: identity => providerHost(identity.baseUrl) === 'openrouter.ai',
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_details',
  },
};
