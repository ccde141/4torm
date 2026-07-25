import { resolveProviderAdapter } from './provider-adapters/registry.js';
import type { ProviderModelCapabilities, ProviderModelIdentity } from './provider-adapters/types.js';

export type { ProviderModelCapabilities, ProviderModelIdentity } from './provider-adapters/types.js';

export function resolveProviderModelCapabilities(
  identity: ProviderModelIdentity,
): ProviderModelCapabilities {
  return resolveProviderAdapter(identity).capabilities;
}

export function normalizeChatRequestBody(
  identity: ProviderModelIdentity,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const body = { ...source };
  const adapter = resolveProviderAdapter(identity);
  const capabilities = adapter.capabilities;
  if (capabilities.temperature === 'omit') delete body.temperature;
  if (capabilities.maxTokensField === 'max_completion_tokens' && body.max_tokens !== undefined) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  adapter.normalizeRequest?.(body, identity);
  return body;
}
