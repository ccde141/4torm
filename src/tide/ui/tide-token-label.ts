import type { Locale } from '../../i18n/locale';
import type { TideTokenUsage } from '../../api/tide';
import { useState } from 'react';

export interface TideUsageDisplay { scope: string; usage?: TideTokenUsage; }

export function projectTideUsage(
  previous: TideUsageDisplay, scope: string,
  usage: TideTokenUsage | undefined, busy: boolean,
): TideUsageDisplay {
  if (previous.scope !== scope) return { scope, usage };
  if (!previous.usage && usage) return { scope, usage };
  if (busy || !usage || previous.usage === usage) return previous;
  return { scope, usage };
}

/** 保留本会话最后一次实测；压缩和执行过程中的空快照不改变展示。 */
export function useTideUsage(
  scope: string, usage: TideTokenUsage | undefined, busy: boolean,
): TideTokenUsage | undefined {
  const [display, setDisplay] = useState<TideUsageDisplay>({ scope, usage });
  const next = projectTideUsage(display, scope, usage, busy);
  if (next !== display) setDisplay(next);
  return next.usage;
}

export function formatTideContextTokens(
  usage: TideTokenUsage | undefined, locale: Locale,
): string {
  if (!usage) return locale === 'en-US' ? 'Unknown' : '未知';
  return new Intl.NumberFormat(locale).format(usage.promptTokens);
}
