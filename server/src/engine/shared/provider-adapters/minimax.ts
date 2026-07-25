import { providerHost } from './host.js';
import type { ProviderAdapter } from './types.js';

const MINIMAX_HOSTS = new Set(['api.minimax.io', 'api.minimaxi.com']);

export const miniMaxAdapter: ProviderAdapter = {
  id: 'minimax',
  matches: identity => (
    MINIMAX_HOSTS.has(providerHost(identity.baseUrl))
    && identity.model.toLowerCase().startsWith('minimax-')
  ),
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_details',
  },
  normalizeRequest: body => {
    body.reasoning_split = true;
  },
};
