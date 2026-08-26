import { providerHost } from './host.js';
import type { ProviderAdapter } from '../contracts/provider-adapter.js';
import { normalizeZhipuConfig } from '../config/zhipu-config.js';

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
  normalizeRequest: (body, identity) => {
    const defaults = normalizeZhipuConfig({ generationDefaults: identity.generationDefaults }).generationDefaults;
    normalizeThinking(body, identity.model, defaults.thinkingMode, defaults.reasoningEffort);
    if (defaults.temperature !== null) body.temperature = defaults.temperature;
    if (defaults.topP !== null) body.top_p = defaults.topP;
  },
};

function normalizeThinking(
  body: Record<string, unknown>, model: string,
  mode: 'auto' | 'enabled' | 'disabled', effort: 'auto' | 'low' | 'high' | 'max',
): void {
  delete body.reasoning_effort;
  const thinking = supportsThinking(model);
  if (!thinking && mode !== 'auto') throw new Error(`智谱模型 ${model} 未验证显式思考模式`);
  if (thinking) body.thinking = mode === 'disabled'
    ? { type: 'disabled' }
    : { type: 'enabled', clear_thinking: false };
  else delete body.thinking;
  if (effort === 'auto') return;
  if (!supportsReasoningEffort(model)) throw new Error('智谱 reasoningEffort 仅适用于 GLM-5.2 和 GLM-5.3');
  if (mode === 'disabled') throw new Error('智谱关闭思考时不能设置 reasoningEffort');
  body.reasoning_effort = effort;
}

function supportsThinking(model: string): boolean {
  const value = model.toLowerCase();
  return value.startsWith('glm-5') || ['glm-4.5', 'glm-4.6', 'glm-4.7'].some(prefix => value.startsWith(prefix));
}

function supportsReasoningEffort(model: string): boolean {
  const value = model.toLowerCase();
  return value === 'glm-5.2' || value.startsWith('glm-5.2-')
    || value === 'glm-5.3' || value.startsWith('glm-5.3-');
}
