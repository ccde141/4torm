type SupportedLocale = 'zh-CN' | 'en-US';

export interface SkippedInputNotice {
  prefix: string;
  names: string;
  reason: string;
}

const SKIP_REASON: Record<SupportedLocale, string> = {
  'zh-CN': '因人类插话取消，未执行；请根据新的要求重新决定后续操作。',
  'en-US': 'Cancelled by human steering; not executed. Reconsider the next action based on the new request.',
};

function skippedName(entry: string): string {
  const separator = entry.indexOf(':');
  return (separator >= 0 ? entry.slice(0, separator) : entry).trim();
}

export function summarizeSkippedInputNotice(entries: string[], locale: SupportedLocale): SkippedInputNotice | null {
  const names = [...new Set(entries.map(skippedName).filter(Boolean))];
  if (!names.length) return null;
  const english = locale === 'en-US';
  const separator = english ? '; ' : '；';
  const prefix = english ? 'Skipped tools: ' : '已跳过的工具：';
  const opening = english ? ' (' : '（';
  const closing = english ? ')' : '）';
  return { prefix, names: names.join(separator), reason: `${opening}${SKIP_REASON[locale]}${closing}` };
}

export function formatSkippedInputNotice(entries: string[], locale: SupportedLocale): string {
  const notice = summarizeSkippedInputNotice(entries, locale);
  return notice ? `${notice.prefix}${notice.names}${notice.reason}` : '';
}
