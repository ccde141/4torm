import { providerHost } from './host.js';
import type { ProviderAdapter } from '../contracts/provider-adapter.js';
import { normalizeDashScopeConfig } from '../config/dashscope-config.js';

export const dashScopeAdapter: ProviderAdapter = {
  id: 'dashscope',
  matches: identity => (
    isDashScopeHost(providerHost(identity.baseUrl))
    && isReasoningModel(identity.model)
  ),
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'reasoning_content',
  },
  normalizeRequest: (body, identity) => {
    const defaults = normalizeDashScopeConfig({ generationDefaults: identity.generationDefaults })
      .generationDefaults;
    delete body.enable_thinking;
    delete body.preserve_thinking;
    delete body.thinking_budget;
    normalizeThinking(body, identity.model, defaults.thinkingMode, defaults.thinkingBudgetTokens);
    if (defaults.temperature !== null) body.temperature = defaults.temperature;
    if (defaults.topP !== null) body.top_p = defaults.topP;
  },
};

function normalizeThinking(
  body: Record<string, unknown>, model: string,
  mode: 'auto' | 'enabled' | 'disabled', budget: number | null,
): void {
  if (mode !== 'auto' && !isReasoningModel(model)) {
    throw new Error(`百炼模型 ${model} 未验证显式思考模式`);
  }
  if (mode !== 'auto') body.enable_thinking = mode === 'enabled';
  if (budget === null) return;
  if (!isReasoningModel(model)) throw new Error('百炼 thinkingBudgetTokens 仅适用于 Qwen 思考模型');
  if (mode === 'disabled') throw new Error('百炼关闭思考时不能设置 thinkingBudgetTokens');
  body.thinking_budget = budget;
}

function isDashScopeHost(host: string): boolean {
  return host === 'dashscope.aliyuncs.com' || host === 'dashscope-intl.aliyuncs.com';
}

function isReasoningModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith('qwen3') || normalized.startsWith('qwq');
}
