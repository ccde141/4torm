import {
  isProviderType,
  isTransportId,
  type ProviderType,
  type TransportId,
} from '../contracts/provider-config.js';
import { providerTransportPolicy } from './provider-policy.js';

export interface ProviderSelectionInput {
  providerType?: unknown;
  transport?: unknown;
  protocol?: unknown;
  modelProfiles?: Record<string, string>;
}

export interface ResolvedProviderSelection {
  providerType: ProviderType;
  transport: TransportId;
  source: 'explicit' | 'legacy';
}

export interface ProviderSelectionDiagnostic {
  code: 'transport-corrected';
  providerType: ProviderType;
  configuredTransport: TransportId;
  effectiveTransport: TransportId;
}

export function resolveProviderSelection(
  input: ProviderSelectionInput,
  model: string,
  onDiagnostic?: (diagnostic: ProviderSelectionDiagnostic) => void,
): ResolvedProviderSelection {
  const explicitType = readExplicitProviderType(input.providerType);
  const explicitTransport = readExplicitTransport(input.transport);
  if (explicitType || explicitTransport) {
    const providerType = explicitType ?? providerTypeForTransport(explicitTransport!);
    const policy = providerTransportPolicy(providerType);
    const configuredTransport = explicitTransport ?? policy.defaultTransport;
    const transport = policy.supportedTransports.includes(configuredTransport)
      ? configuredTransport : policy.defaultTransport;
    if (transport !== configuredTransport) {
      onDiagnostic?.({
        code: 'transport-corrected', providerType, configuredTransport,
        effectiveTransport: transport,
      });
    }
    return {
      providerType,
      transport,
      source: 'explicit',
    };
  }
  return resolveLegacySelection(input, model);
}

function readExplicitProviderType(value: unknown): ProviderType | undefined {
  if (value === undefined) return undefined;
  if (!isProviderType(value)) throw new Error(`未知模型提供商类型：${String(value)}`);
  return value;
}

function readExplicitTransport(value: unknown): TransportId | undefined {
  if (value === undefined) return undefined;
  if (!isTransportId(value)) throw new Error(`未知模型传输协议：${String(value)}`);
  return value;
}

function providerTypeForTransport(transport: TransportId): ProviderType {
  if (transport === 'anthropic-messages') return 'anthropic';
  if (transport === 'ollama-native') return 'ollama';
  return 'openai-compatible';
}

function resolveLegacySelection(
  input: ProviderSelectionInput,
  model: string,
): ResolvedProviderSelection {
  const profile = input.modelProfiles?.[model];
  const providerType: ProviderType = profile === 'llama-cpp' ? 'llama-cpp'
    : profile === 'lmstudio' ? 'lm-studio'
      : input.protocol === 'anthropic-messages' ? 'anthropic' : 'openai-compatible';
  return {
    providerType,
    transport: providerType === 'anthropic' ? 'anthropic-messages' : 'openai-chat-completions',
    source: 'legacy',
  };
}
