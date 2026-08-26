import { providerHost } from './host.js';
import type { ProviderAdapter } from '../contracts/provider-adapter.js';
import { normalizeMiniMaxConfig } from '../config/minimax-config.js';

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
  normalizeRequest: (body, identity) => {
    if (!identity.model.toLowerCase().startsWith('minimax-')) return;
    const defaults = normalizeMiniMaxConfig({ generationDefaults: identity.generationDefaults })
      .generationDefaults;
    body.reasoning_split = true;
    if (defaults.temperature !== null) body.temperature = defaults.temperature;
    if (defaults.topP !== null) body.top_p = defaults.topP;
    normalizeThinking(body, identity.model, defaults.thinkingMode);
  },
};

function normalizeThinking(
  body: Record<string, unknown>, model: string, mode: 'auto' | 'enabled' | 'disabled',
): void {
  delete body.thinking;
  if (mode === 'auto') return;
  if (model.toLowerCase() !== 'minimax-m3') {
    throw new Error('MiniMax 显式 thinkingMode 仅适用于 MiniMax-M3；M2.x 始终思考');
  }
  body.thinking = { type: mode === 'disabled' ? 'disabled' : 'adaptive' };
}
