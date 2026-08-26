import type { ProviderType, TransportId } from '../contracts/provider-config.js';
import type { ProviderVerificationState } from '../contracts/verification.js';
import { providerTransportPolicy } from '../config/provider-policy.js';
import type { ProviderConfigurationSchema } from '../contracts/provider-configuration.js';
import { LLAMA_CPP_CONFIGURATION_SCHEMA } from '../config/llama-cpp-schema.js';
import { OLLAMA_CONFIGURATION_SCHEMA } from '../config/ollama-schema.js';
import { DEEPSEEK_CONFIGURATION_SCHEMA } from '../config/deepseek-schema.js';
import { VLLM_CONFIGURATION_SCHEMA } from '../config/vllm-schema.js';
import { KIMI_CONFIGURATION_SCHEMA } from '../config/kimi-schema.js';
import { ZHIPU_CONFIGURATION_SCHEMA } from '../config/zhipu-schema.js';
import { DASHSCOPE_CONFIGURATION_SCHEMA } from '../config/dashscope-schema.js';
import { MINIMAX_CONFIGURATION_SCHEMA } from '../config/minimax-schema.js';

export type ProviderProbeStrategy = 'none' | 'openai-models' | 'llama-cpp-metadata' | 'lm-studio-metadata' | 'ollama-runtime' | 'vllm-runtime';

export interface ProviderDescriptor {
  id: ProviderType;
  label: string;
  defaultTransport: TransportId;
  supportedTransports: TransportId[];
  probeStrategy: ProviderProbeStrategy;
  verificationState: ProviderVerificationState;
  selectable: boolean;
  configuration?: ProviderConfigurationSchema;
}

export interface ProviderCatalog {
  version: number;
  providers: ProviderDescriptor[];
  presets: ProviderPresetDescriptor[];
}

export interface ProviderPresetDescriptor {
  id: string;
  label: string;
  baseUrl: string;
  protocol: 'openai-chat-completions' | 'anthropic-messages';
  providerType?: ProviderType;
  transport?: TransportId;
}

const PROVIDERS: ProviderDescriptor[] = [
  descriptor('openai-cloud', 'OpenAI', 'openai-models', 'transport-ready', false),
  descriptor('openai-compatible', 'OpenAI Compatible', 'openai-models', 'transport-ready', true),
  descriptor('deepseek', 'DeepSeek', 'openai-models', 'transport-ready', true, DEEPSEEK_CONFIGURATION_SCHEMA),
  descriptor('kimi', 'Kimi', 'openai-models', 'transport-ready', true, KIMI_CONFIGURATION_SCHEMA),
  descriptor('dashscope', 'Alibaba Cloud Model Studio', 'openai-models', 'transport-ready', true, DASHSCOPE_CONFIGURATION_SCHEMA),
  descriptor('zhipu', 'Zhipu AI', 'openai-models', 'transport-ready', true, ZHIPU_CONFIGURATION_SCHEMA),
  descriptor('openrouter', 'OpenRouter', 'openai-models', 'unverified', false),
  descriptor('minimax', 'MiniMax', 'openai-models', 'transport-ready', true, MINIMAX_CONFIGURATION_SCHEMA),
  descriptor('siliconflow', 'SiliconFlow', 'openai-models', 'unverified', false),
  descriptor('llama-cpp', 'llama.cpp', 'llama-cpp-metadata', 'context-ready', true, LLAMA_CPP_CONFIGURATION_SCHEMA),
  descriptor('anthropic', 'Anthropic', 'none', 'unverified', false),
  descriptor('lm-studio', 'LM Studio', 'lm-studio-metadata', 'context-ready', true),
  descriptor('ollama', 'Ollama', 'ollama-runtime', 'context-ready', true, OLLAMA_CONFIGURATION_SCHEMA),
  descriptor('vllm', 'vLLM', 'vllm-runtime', 'context-ready', true, VLLM_CONFIGURATION_SCHEMA),
  descriptor('sglang', 'SGLang', 'openai-models', 'unverified', false),
];

const PRESETS: ProviderPresetDescriptor[] = [
  preset('openai-compatible', 'OpenAI Compatible', '', 'openai-chat-completions', 'openai-compatible'),
  preset('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'openai-chat-completions', 'deepseek'),
  preset('kimi', 'Kimi', 'https://api.moonshot.cn/v1', 'openai-chat-completions', 'kimi'),
  preset('dashscope', 'Alibaba Cloud Model Studio', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai-chat-completions', 'dashscope'),
  preset('zhipu', 'Zhipu AI', 'https://open.bigmodel.cn/api/paas/v4', 'openai-chat-completions', 'zhipu'),
  preset('minimax', 'MiniMax', 'https://api.minimaxi.com/v1', 'openai-chat-completions', 'minimax'),
  preset('lm-studio', 'LM Studio', 'http://localhost:1234/v1', 'openai-chat-completions', 'lm-studio'),
  preset('llama-cpp', 'llama.cpp', 'http://localhost:8080/v1', 'openai-chat-completions', 'llama-cpp'),
  preset('ollama', 'Ollama', 'http://localhost:11434/v1', 'openai-chat-completions', 'ollama'),
  preset('vllm', 'vLLM', 'http://localhost:8000/v1', 'openai-chat-completions', 'vllm'),
];

function descriptor(
  id: ProviderType,
  label: string,
  probeStrategy: ProviderProbeStrategy,
  verificationState: ProviderVerificationState,
  selectable: boolean,
  configuration?: ProviderConfigurationSchema,
): ProviderDescriptor {
  const { defaultTransport, supportedTransports } = providerTransportPolicy(id);
  return { id, label, defaultTransport, supportedTransports, probeStrategy, verificationState, selectable, ...(configuration ? { configuration } : {}) };
}

function preset(
  id: string,
  label: string,
  baseUrl: string,
  protocol: ProviderPresetDescriptor['protocol'],
  providerType?: ProviderType,
): ProviderPresetDescriptor {
  return {
    id, label, baseUrl, protocol,
    ...(providerType ? { providerType, transport: defaultTransport(providerType) } : {}),
  };
}

function defaultTransport(providerType: ProviderType): TransportId {
  return PROVIDERS.find(provider => provider.id === providerType)!.defaultTransport;
}

export function getProviderCatalog(): ProviderCatalog {
  return structuredClone({
    version: 1,
    providers: PROVIDERS.map(provider => ({
      ...provider,
      supportedTransports: [...provider.supportedTransports],
    })),
    presets: PRESETS.map(presetEntry => ({ ...presetEntry })),
  });
}
