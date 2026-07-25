import { providerHost } from './host.js';
import type { ProviderAdapter } from './types.js';

const KIMI_HOSTS = new Set(['api.moonshot.cn', 'api.kimi.com']);

export const kimiAdapter: ProviderAdapter = {
  id: 'kimi',
  matches: identity => (
    identity.model.toLowerCase().startsWith('kimi-')
    && KIMI_HOSTS.has(providerHost(identity.baseUrl))
  ),
  capabilities: {
    temperature: 'omit',
    maxTokensField: 'max_completion_tokens',
    reasoningHistory: 'reasoning_content',
  },
};
