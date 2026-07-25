export interface ProviderModelIdentity {
  baseUrl: string;
  model: string;
  profile?: string;
}

export interface ProviderModelCapabilities {
  temperature: 'passthrough' | 'omit';
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  reasoningHistory: 'omit' | 'reasoning_content' | 'reasoning_details';
}

export interface ProviderAdapter {
  id: string;
  matches(identity: ProviderModelIdentity): boolean;
  capabilities: ProviderModelCapabilities;
  normalizeRequest?(body: Record<string, unknown>, identity: ProviderModelIdentity): void;
}
