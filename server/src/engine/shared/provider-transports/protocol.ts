export type ProviderProtocol = 'openai-chat-completions' | 'anthropic-messages';

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
