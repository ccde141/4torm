export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenUsageMeta {
  tk?: number;
  pt?: number;
  ct?: number;
}

export function tokenUsageToMeta(usage?: TokenUsage): TokenUsageMeta {
  if (!usage) return {};
  return {
    tk: usage.totalTokens,
    pt: usage.promptTokens,
    ct: usage.completionTokens,
  };
}

export function tokenUsageFromMeta(meta: TokenUsageMeta): TokenUsage | undefined {
  if (meta.tk == null) return undefined;
  return {
    promptTokens: meta.pt ?? 0,
    completionTokens: meta.ct ?? 0,
    totalTokens: meta.tk,
  };
}

function shortTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : `${tokens}`;
}

export function formatTokenUsage(usage?: TokenUsage): { label: string; title: string } {
  if (!usage) return { label: '--', title: '尚无模型返回的实际用量' };
  const prompt = shortTokens(usage.promptTokens);
  const completion = shortTokens(usage.completionTokens);
  const total = shortTokens(usage.totalTokens);
  if (usage.promptTokens === 0 && usage.completionTokens === 0 && usage.totalTokens > 0) {
    return {
      label: total,
      title: `历史实际总量 ${total} tokens；输入/输出明细将在下次回复后补齐`,
    };
  }
  return {
    label: total,
    title: `实际用量：输入 ${prompt} + 输出 ${completion} = ${total} tokens`,
  };
}
