export type ProviderProtocol = 'auto' | 'openai-chat-completions' | 'anthropic-messages';
export type ResolvedProviderProtocol = Exclude<ProviderProtocol, 'auto'>;

export function resolveProviderProtocol(
  baseUrl: string,
  configured: ProviderProtocol = 'auto',
): ResolvedProviderProtocol {
  if (configured !== 'auto') return configured;

  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === 'api.anthropic.com') return 'anthropic-messages';
  } catch {
    return 'openai-chat-completions';
  }

  return 'openai-chat-completions';
}
