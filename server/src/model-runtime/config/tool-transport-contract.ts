import { resolveProviderSelection, type ProviderSelectionInput } from './provider-selection.js';
import type { TransportId } from '../contracts/provider-config.js';

const TOOL_TRANSPORT_PROBE_VERSION = 2;

export type ProviderProtocol = 'openai-chat-completions' | 'anthropic-messages';

export interface ToolTransportProvider extends ProviderSelectionInput {
  id: string;
  baseUrl: string;
  protocol?: 'auto' | ProviderProtocol;
}

export interface ToolTransportContract {
  protocol: ProviderProtocol;
  fingerprint: string;
}

function supportedProtocol(transport: TransportId): ProviderProtocol {
  if (transport === 'openai-chat-completions' || transport === 'anthropic-messages') return transport;
  throw new Error(`当前版本尚未实现模型传输协议：${transport}`);
}

export function resolveProviderProtocol(
  baseUrl: string,
  configured?: 'auto' | ProviderProtocol,
): ProviderProtocol {
  if (configured && configured !== 'auto') return configured;
  try {
    if (new URL(baseUrl).hostname.toLowerCase() === 'api.anthropic.com') return 'anthropic-messages';
  } catch {
    return 'openai-chat-completions';
  }
  return 'openai-chat-completions';
}

function normalizeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return baseUrl.trim().replace(/\/+$/, '');
  }
}

/** The probe and runtime use this same effective transport identity. */
export function resolveToolTransportContract(
  provider: ToolTransportProvider,
  model: string,
): ToolTransportContract {
  const selection = resolveProviderSelection(provider, model);
  const protocol = selection.source === 'explicit'
    ? supportedProtocol(selection.transport)
    : resolveProviderProtocol(provider.baseUrl, provider.protocol);
  const profile = provider.modelProfiles?.[model] ?? 'auto';
  const fingerprint = JSON.stringify(selection.source === 'explicit'
    ? [provider.id, normalizeBaseUrl(provider.baseUrl), selection.transport,
      selection.providerType, model, profile, TOOL_TRANSPORT_PROBE_VERSION]
    : [provider.id, normalizeBaseUrl(provider.baseUrl), protocol,
      model, profile, TOOL_TRANSPORT_PROBE_VERSION]);
  return { protocol, fingerprint };
}
