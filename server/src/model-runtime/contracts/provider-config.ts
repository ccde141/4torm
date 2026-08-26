export const PROVIDER_TYPES = [
  'openai-cloud',
  'openai-compatible',
  'deepseek',
  'kimi',
  'dashscope',
  'zhipu',
  'openrouter',
  'minimax',
  'siliconflow',
  'llama-cpp',
  'anthropic',
  'lm-studio',
  'ollama',
  'vllm',
  'sglang',
] as const;

export type ProviderType = typeof PROVIDER_TYPES[number];

export const TRANSPORT_IDS = [
  'openai-chat-completions',
  'openai-responses',
  'anthropic-messages',
  'ollama-native',
] as const;

export type TransportId = typeof TRANSPORT_IDS[number];
export type ModelInputModality = 'text' | 'image' | 'audio' | 'video';

export interface ProviderModelConfig {
  id: string;
  name?: string;
  contextWindowTokens?: number;
  contextTokenLimit?: number;
  maxOutputTokens?: number;
  input?: ModelInputModality[];
  reasoning?: boolean;
  tools?: boolean;
  runtimeParams?: Record<string, unknown>;
}

export interface ModelProviderConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  transport: TransportId;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: ProviderModelConfig[];
}

export function isProviderType(value: unknown): value is ProviderType {
  return typeof value === 'string' && (PROVIDER_TYPES as readonly string[]).includes(value);
}

export function isTransportId(value: unknown): value is TransportId {
  return typeof value === 'string' && (TRANSPORT_IDS as readonly string[]).includes(value);
}
