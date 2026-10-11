export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function latestProviderUsage(
  progress: { calls: number; latest: ProviderUsage | null } | undefined,
): ProviderUsage | null | undefined {
  return progress && progress.calls > 0 ? progress.latest : undefined;
}
