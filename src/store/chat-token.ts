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

export function formatTokenUsage(usage?: TokenUsage, locale: Locale = 'zh-CN'): { label: string; title: string } {
  if (!usage) return { label: '--', title: locale === 'en-US'
    ? 'Latest usage unavailable' : '本次用量未知' };
  if (usage.promptTokens === 0 && usage.completionTokens === 0 && usage.totalTokens > 0) {
    const total = shortTokens(usage.totalTokens);
    return {
      label: '--',
      title: locale === 'en-US'
        ? `Historical total ${total} tokens · latest unavailable`
        : `历史总量 ${total} tokens · 本次未知`,
    };
  }
  const prompt = shortTokens(usage.promptTokens);
  const completion = shortTokens(usage.completionTokens);
  const total = shortTokens(usage.totalTokens);
  return {
    label: prompt,
    title: locale === 'en-US'
      ? `Input ${prompt} · output ${completion} · total ${total} tokens`
      : `输入 ${prompt} · 输出 ${completion} · 合计 ${total} tokens`,
  };
}
import type { Locale } from '../i18n/locale';
