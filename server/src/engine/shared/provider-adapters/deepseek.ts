import { providerHost } from './host.js';
import type { ProviderAdapter } from './types.js';

export const deepSeekAdapter: ProviderAdapter = {
  id: 'deepseek',
  matches: identity => providerHost(identity.baseUrl) === 'api.deepseek.com',
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_content',
  },
  normalizeRequest: (body, identity) => {
    if (!usesThinkingMode(identity.model)) return;
    body.thinking = { type: 'enabled' };
    delete body.temperature;
    delete body.top_p;
    delete body.presence_penalty;
    delete body.frequency_penalty;
  },
};

function usesThinkingMode(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized === 'deepseek-reasoner' || normalized.startsWith('deepseek-v4');
}
