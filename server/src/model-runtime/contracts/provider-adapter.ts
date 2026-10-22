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

/** Model limits describe capacities, not the user's ordinary generation defaults. */
export interface ProviderGenerationLimits {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  reasoning?: boolean;
}

export interface ProviderAdapter {
  id: string;
  matches(identity: ProviderModelIdentity): boolean;
  capabilities: ProviderModelCapabilities;
  generationLimits?(identity: ProviderModelIdentity): ProviderGenerationLimits;
  /** Provider request ceilings also apply after custom parameters or framework budgets. */
  constrainOutputTokens?(tokens: number): number;
  normalizeRequest?(body: Record<string, unknown>, identity: ProviderModelIdentity): void;
  /** Optional verified provider control for a body-only finalization request. */
  disableThinking?(body: Record<string, unknown>, identity: ProviderModelIdentity): boolean;
  discoverRuntimeCapabilities?(
    identity: ProviderModelIdentity,
    fetchImpl: ProviderRuntimeFetch,
  ): Promise<ProviderRuntimeCapabilities | undefined>;
}
