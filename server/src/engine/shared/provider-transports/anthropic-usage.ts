interface AnthropicUsage {
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  usageComplete: boolean;
}

/** Anthropic reports uncached input and both cache input counters separately. */
export function parseAnthropicUsage(source: Record<string, unknown> = {}): AnthropicUsage {
  const keys = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const;
  const promptTokens = keys.reduce((total, key) => total + count(source[key]), 0);
  const completionTokens = count(source.output_tokens);
  return {
    usage: promptTokens || completionTokens || valid(source.input_tokens) || valid(source.output_tokens)
      ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } : undefined,
    usageComplete: valid(source.input_tokens) && valid(source.output_tokens)
      && keys.every(key => source[key] === undefined || valid(source[key])),
  };
}

function valid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function count(value: unknown): number { return valid(value) ? value : 0; }
