import type { Locale } from '../../../i18n/locale';
import { useState } from 'react';

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

export interface CycloneUsageDisplay { scope: string; usage?: CycloneUsage; }

/** 运行中的计量继续接收；展示在收口后更新，缺失回报不抹掉同一会话的已知值。 */
export function projectCycloneUsage(
  previous: CycloneUsageDisplay, scope: string,
  candidate: CycloneUsage | null | undefined, busy: boolean,
  stored?: CycloneUsage,
): CycloneUsageDisplay {
  if (previous.scope !== scope) return { scope, usage: stored ?? (!busy ? candidate ?? undefined : undefined) };
  if (!previous.usage && stored) return { scope, usage: stored };
  if (busy || !candidate || previous.usage === candidate) return previous;
  return { scope, usage: candidate };
}

export function useCycloneUsage(
  scope: string, live: CycloneUsage | null | undefined,
  stored: CycloneUsage | undefined, busy: boolean,
): CycloneUsage | undefined {
  const [display, setDisplay] = useState<CycloneUsageDisplay>({ scope, usage: stored });
  const next = projectCycloneUsage(display, scope, visibleCycloneUsage(live, stored), busy, stored);
  if (next !== display) setDisplay(next);
  return next.usage;
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
