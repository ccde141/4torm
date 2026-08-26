import type { ProviderType } from './provider-config.js';

export interface ProviderModelIdentity {
  baseUrl: string;
  model: string;
  profile?: string;
  providerType?: ProviderType;
  runtimePolicy?: unknown;
  generationDefaults?: unknown;
  customRequestParameters?: unknown;
}

export interface ProviderModelCapabilities {
  temperature: 'passthrough' | 'omit';
  maxTokensField: 'max_tokens' | 'max_completion_tokens' | 'omit';
  defaultMaxOutputTokens?: number;
  reasoningHistory: 'omit' | 'reasoning' | 'reasoning_content' | 'reasoning_details';
}

export interface ProviderRuntimeCapabilities {
  contextWindowTokens: number;
  parallelSlots?: number;
  modalities?: { vision: boolean; audio: boolean; video: boolean };
}

export type ProviderRuntimeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderAdapter {
  id: string;
  matches(identity: ProviderModelIdentity): boolean;
  capabilities: ProviderModelCapabilities;
  normalizeRequest?(body: Record<string, unknown>, identity: ProviderModelIdentity): void;
  discoverRuntimeCapabilities?(
    identity: ProviderModelIdentity,
    fetchImpl: ProviderRuntimeFetch,
  ): Promise<ProviderRuntimeCapabilities | undefined>;
}
