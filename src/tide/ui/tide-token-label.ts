import type { Locale } from '../../i18n/locale';
import type { TideTokenUsage } from '../../api/tide';

export function formatTideContextTokens(
  usage: TideTokenUsage | undefined, locale: Locale,
): string {
  if (!usage) return locale === 'en-US' ? 'Unknown' : '未知';
  return new Intl.NumberFormat(locale).format(usage.promptTokens);
}
