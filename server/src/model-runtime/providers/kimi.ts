import { providerHost } from './host.js';
import type { ProviderAdapter } from '../contracts/provider-adapter.js';
import { normalizeKimiConfig } from '../config/kimi-config.js';

const KIMI_HOSTS = new Set(['api.moonshot.ai', 'api.moonshot.cn', 'api.kimi.com']);

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
  normalizeRequest: (body, identity) => {
    const defaults = normalizeKimiConfig({ generationDefaults: identity.generationDefaults })
      .generationDefaults;
    normalizeThinking(body, identity.model, defaults.thinkingMode, defaults.reasoningEffort);
  },
};

function normalizeThinking(
  body: Record<string, unknown>,
  model: string,
  mode: 'auto' | 'enabled' | 'disabled',
  effort: 'auto' | 'low' | 'high' | 'max',
): void {
  const family = kimiFamily(model);
  delete body.thinking;
  delete body.reasoning_effort;
  if (family === 'k3') return normalizeK3(body, mode, effort);
  if (effort !== 'auto') throw new Error('Kimi reasoningEffort 仅适用于 Kimi K3');
  if (family === 'k2.7-code' && mode === 'disabled') {
    throw new Error('Kimi K2.7 Code 不能关闭思考');
  }
  if (family === 'k2.7-code') {
    body.thinking = { type: 'enabled', keep: 'all' };
  }
  if (family === 'k2.6' && mode !== 'auto') {
    body.thinking = mode === 'enabled' ? { type: 'enabled', keep: 'all' } : { type: 'disabled' };
  }
  if (family === 'other' && mode !== 'auto') {
    throw new Error(`Kimi 模型 ${model} 未验证显式思考模式`);
  }
}

function normalizeK3(
  body: Record<string, unknown>,
  mode: 'auto' | 'enabled' | 'disabled',
  effort: 'auto' | 'low' | 'high' | 'max',
): void {
  if (mode === 'disabled') throw new Error('Kimi K3 不能关闭思考');
  if (effort !== 'auto') body.reasoning_effort = effort;
}

function kimiFamily(model: string): 'k3' | 'k2.6' | 'k2.7-code' | 'other' {
  const normalized = model.toLowerCase();
  if (normalized === 'kimi-k3' || normalized.startsWith('kimi-k3-')) return 'k3';
  if (normalized === 'kimi-k2.6' || normalized.startsWith('kimi-k2.6-')) return 'k2.6';
  if (normalized === 'kimi-k2.7-code' || normalized.startsWith('kimi-k2.7-code-')) return 'k2.7-code';
  return 'other';
}
