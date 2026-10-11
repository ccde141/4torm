import type { Locale } from '../../../i18n/locale';

export interface ConvectionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface UsageFields {
  id: string;
  tokenUsage?: ConvectionUsage;
  publicLatestTokenUsage?: ConvectionUsage;
  chairTokenUsage?: ConvectionUsage;
}

export function applyConvectionUsage<T extends UsageFields>(
  sessions: T[], sessionId: string, round: 'public' | 'chair',
  usage: ConvectionUsage | null,
): T[] {
  const field = round === 'public' ? 'publicLatestTokenUsage' : 'chairTokenUsage';
  return sessions.map(session => session.id === sessionId
    ? { ...session, [field]: usage ?? undefined } : session);
}

function shortTokens(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : `${value}`;
}

export function formatConvectionUsage(
  usage: ConvectionUsage | undefined,
  textEstimate: number,
  locale: Locale,
): { label: string; title: string } {
  if (usage) return {
    label: `${shortTokens(usage.promptTokens)} tokens`,
    title: locale === 'en-US'
      ? `Latest model request: ${usage.promptTokens} input tokens reported by provider`
      : `最近一次模型请求：提供商报告输入 ${usage.promptTokens} token`,
  };
  return {
    label: locale === 'en-US' ? 'Token unknown' : 'Token 未知',
    title: locale === 'en-US'
      ? `Provider did not report usage. Visible message text estimate: about ${textEstimate} tokens.`
      : `提供商未报告实际用量。仅可见消息正文估算约 ${textEstimate} token。`,
  };
}
