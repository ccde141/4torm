import { providerHost } from './host.js';
import type { ProviderAdapter } from './types.js';

export const zhipuGlmAdapter: ProviderAdapter = {
  id: 'zhipu-glm',
  matches: identity => (
    providerHost(identity.baseUrl) === 'open.bigmodel.cn'
    && identity.model.toLowerCase().startsWith('glm-5')
  ),
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_content',
  },
  normalizeRequest: body => {
    body.thinking = { type: 'enabled', clear_thinking: false };
  },
};
