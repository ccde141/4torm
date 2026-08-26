import type { ProviderType, TransportId } from '../contracts/provider-config.js';

export interface ProviderTransportPolicy {
  defaultTransport: TransportId;
  supportedTransports: TransportId[];
}

const CHAT: TransportId[] = ['openai-chat-completions'];

const POLICIES: Record<ProviderType, ProviderTransportPolicy> = {
  'openai-cloud': policy('openai-chat-completions', CHAT),
  'openai-compatible': policy('openai-chat-completions', CHAT),
  deepseek: policy('openai-chat-completions', CHAT),
  'llama-cpp': policy('openai-chat-completions', CHAT),
  anthropic: policy('anthropic-messages', ['anthropic-messages']),
  'lm-studio': policy('openai-chat-completions', CHAT),
  ollama: policy('openai-chat-completions', CHAT),
  vllm: policy('openai-chat-completions', CHAT),
  sglang: policy('openai-chat-completions', CHAT),
};

function policy(defaultTransport: TransportId, supportedTransports: TransportId[]): ProviderTransportPolicy {
  return { defaultTransport, supportedTransports };
}

export function providerTransportPolicy(providerType: ProviderType): ProviderTransportPolicy {
  const value = POLICIES[providerType];
  return { ...value, supportedTransports: [...value.supportedTransports] };
}
