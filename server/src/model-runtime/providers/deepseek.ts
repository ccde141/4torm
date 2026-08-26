import { providerHost } from './host.js';
import type { ProviderAdapter } from '../contracts/provider-adapter.js';
import { normalizeDeepSeekConfig } from '../config/deepseek-config.js';

export const deepSeekAdapter: ProviderAdapter = {
  id: 'deepseek',
  matches: identity => providerHost(identity.baseUrl) === 'api.deepseek.com',
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_content',
  },
  normalizeRequest: (body, identity) => {
    const defaults = normalizeDeepSeekConfig({ generationDefaults: identity.generationDefaults })
      .generationDefaults;
    const thinking = effectiveThinking(identity.model, defaults.thinkingMode);
    if (defaults.thinkingMode !== 'auto') {
      body.thinking = { type: defaults.thinkingMode };
    } else {
      delete body.thinking;
    }
    if (thinking) {
      removeIgnoredSampling(body);
      if (defaults.reasoningEffort !== 'auto') body.reasoning_effort = defaults.reasoningEffort;
      else delete body.reasoning_effort;
      return;
    }
    if (defaults.temperature !== null) body.temperature = defaults.temperature;
    if (defaults.topP !== null) body.top_p = defaults.topP;
    delete body.reasoning_effort;
  },
};

function effectiveThinking(
  model: string,
  mode: 'auto' | 'enabled' | 'disabled',
): boolean {
  if (mode !== 'auto') return mode === 'enabled';
  const normalized = model.toLowerCase();
  return normalized === 'deepseek-reasoner' || normalized.startsWith('deepseek-v4');
}

function removeIgnoredSampling(body: Record<string, unknown>): void {
  delete body.temperature;
  delete body.top_p;
  delete body.presence_penalty;
  delete body.frequency_penalty;
}
