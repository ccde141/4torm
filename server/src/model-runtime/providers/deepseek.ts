import { providerHost } from './host.js';
import type { ProviderAdapter, ProviderGenerationLimits, ProviderModelIdentity } from '../contracts/provider-adapter.js';
import { normalizeDeepSeekConfig } from '../config/deepseek-config.js';
import { mergeCustomRequestParameters } from './custom-request-parameters.js';

export const deepSeekAdapter: ProviderAdapter = {
  id: 'deepseek',
  matches: identity => providerHost(identity.baseUrl) === 'api.deepseek.com',
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_content',
  },
  generationLimits: deepSeekGenerationLimits,
  disableThinking: body => {
    body.thinking = { type: 'disabled' };
    delete body.reasoning_effort;
    return true;
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

function deepSeekGenerationLimits(identity: ProviderModelIdentity): ProviderGenerationLimits {
  const defaults = normalizeDeepSeekConfig({ generationDefaults: identity.generationDefaults })
    .generationDefaults;
  const model = identity.model.toLowerCase();
  const knownV4 = model.startsWith('deepseek-v4') || model === 'deepseek-flash';
  const body: Record<string, unknown> = {};
  deepSeekAdapter.normalizeRequest?.(body, identity);
  const final = mergeCustomRequestParameters(body, identity.customRequestParameters);
  const thinking = final.thinking;
  const switchValue = thinking && typeof thinking === 'object' && !Array.isArray(thinking)
    ? (thinking as Record<string, unknown>).type : undefined;
  const effort = final.reasoning_effort;
  const reasoning = typeof effort === 'string' ? effort !== 'none'
    : switchValue === 'disabled' ? false : switchValue === 'enabled' ? true
      : defaults.thinkingMode !== 'auto' ? defaults.thinkingMode === 'enabled'
        : knownV4 || model === 'deepseek-reasoner' ? true
          : model === 'deepseek-chat' ? false : undefined;
  // https://api-docs.deepseek.com/api/create-chat-completion/ (V4 total output includes thinking).
  return {
    ...(knownV4 ? { contextWindowTokens: 1_048_576, maxOutputTokens: 393_216 } : {}),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

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
