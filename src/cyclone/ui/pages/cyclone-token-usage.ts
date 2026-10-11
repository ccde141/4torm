import type { Locale } from '../../../i18n/locale';

export interface CycloneUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Undefined means no live event yet; null means the latest call did not report usage. */
export function visibleCycloneUsage(
  live: CycloneUsage | null | undefined,
  stored: CycloneUsage | undefined,
): CycloneUsage | null | undefined {
  return live === undefined ? stored : live;
}

export function formatCycloneUsage(
  usage: CycloneUsage | null | undefined,
  locale: Locale,
): { label: string; title: string } {
  if (!usage) return {
    label: locale === 'en-US' ? 'Token unknown' : 'Token 未知',
    title: locale === 'en-US' ? 'Provider did not report actual token usage'
      : '提供商未报告实际 token 用量',
  };
  const count = usage.promptTokens;
  return {
    label: `${count >= 1_000 ? `${(count / 1_000).toFixed(1)}K` : count} tokens`,
    title: locale === 'en-US'
      ? `Latest model request: ${count} input tokens reported by provider`
      : `最近一次模型请求：提供商报告输入 ${count} token`,
  };
}
