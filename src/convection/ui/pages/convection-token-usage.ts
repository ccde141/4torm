import type { Locale } from '../../../i18n/locale';

export interface ConvectionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

type UsageRound = 'public' | 'chair';
export type ConvectionUsagePending = Partial<Record<UsageRound, ConvectionUsage | null>>;

interface UsageFields {
  id: string;
  tokenUsage?: ConvectionUsage;
  publicLatestTokenUsage?: ConvectionUsage;
  chairTokenUsage?: ConvectionUsage;
  /** UI-only candidates; a reply or context change publishes them at its finish boundary. */
  usagePending?: ConvectionUsagePending;
}

export function beginConvectionUsage<T extends UsageFields>(sessions: T[], sessionId: string, round: UsageRound): T[] {
  return sessions.map(session => session.id !== sessionId || session.usagePending?.[round] !== undefined
    ? session : { ...session, usagePending: { ...session.usagePending, [round]: null } });
}

export function applyConvectionUsage<T extends UsageFields>(
  sessions: T[], sessionId: string, round: UsageRound,
  usage: ConvectionUsage | null,
): T[] {
  const field = round === 'public' ? 'publicLatestTokenUsage' : 'chairTokenUsage';
  return sessions.map(session => {
    if (session.id !== sessionId || !usage) return session;
    return session.usagePending?.[round] !== undefined
      ? { ...session, usagePending: { ...session.usagePending, [round]: usage } }
      : { ...session, [field]: usage };
  });
}

/** List snapshots may omit metering while the same conversation is being rewritten. */
export function mergeConvectionSessions<T extends UsageFields>(current: T[], incoming: T[],
  pending?: { sessionId: string; round: UsageRound }): T[] {
  const previous = new Map((pending ? beginConvectionUsage(current, pending.sessionId, pending.round) : current)
    .map(session => [session.id, session]));
  return incoming.map(session => {
    const before = previous.get(session.id);
    if (!before) return pending?.sessionId === session.id
      ? { ...session, usagePending: { [pending.round]: session[pending.round === 'public'
        ? 'publicLatestTokenUsage' : 'chairTokenUsage'] ?? null } } : session;
    const usagePending = { ...before.usagePending };
    if (usagePending.public !== undefined) usagePending.public ??= session.publicLatestTokenUsage ?? null;
    if (usagePending.chair !== undefined) usagePending.chair ??= session.chairTokenUsage ?? null;
    return { ...session, usagePending,
      publicLatestTokenUsage: before.usagePending?.public !== undefined ? before.publicLatestTokenUsage
        : session.publicLatestTokenUsage ?? before.publicLatestTokenUsage,
      chairTokenUsage: before.usagePending?.chair !== undefined ? before.chairTokenUsage
        : session.chairTokenUsage ?? before.chairTokenUsage };
  });
}

/** Only a settled operation publishes its latest real candidate; missing usage never erases a known count. */
export function restoreConvectionUsage<T extends UsageFields>(sessions: T[], sessionId: string,
  stored: Pick<UsageFields, 'publicLatestTokenUsage' | 'chairTokenUsage'>, pending?: UsageRound | null): T[] {
  return sessions.map(session => {
    if (session.id !== sessionId) return session;
    const next = { ...session, usagePending: { ...session.usagePending } };
    for (const round of ['public', 'chair'] as const) {
      const field = round === 'public' ? 'publicLatestTokenUsage' : 'chairTokenUsage';
      if (round === pending) next.usagePending[round] = next.usagePending[round] ?? stored[field] ?? null;
      else {
        next[field] = stored[field] ?? next.usagePending[round] ?? next[field];
        delete next.usagePending[round];
      }
    }
    return next;
  });
}

function shortTokens(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : `${value}`;
}

export function formatConvectionUsage(
  usage: ConvectionUsage | undefined,
  textEstimate: number,
  locale: Locale,
): { label: string; compactLabel: string; title: string } {
  if (usage) return {
    label: `${shortTokens(usage.promptTokens)} tokens`,
    compactLabel: shortTokens(usage.promptTokens),
    title: locale === 'en-US'
      ? `Latest model request: ${usage.promptTokens} input tokens reported by provider`
      : `最近一次模型请求：提供商报告输入 ${usage.promptTokens} token`,
  };
  return {
    label: locale === 'en-US' ? 'Token unknown' : 'Token 未知',
    compactLabel: locale === 'en-US' ? 'Unknown' : '未知',
    title: locale === 'en-US'
      ? `Provider did not report usage. Visible message text estimate: about ${textEstimate} tokens.`
      : `提供商未报告实际用量。仅可见消息正文估算约 ${textEstimate} token。`,
  };
}
