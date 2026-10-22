import { useLocale } from '../../../i18n/LocaleContext';

/** Console copy belongs to Cyclone; shared locale selection remains an application service. */
export function useConsoleText() {
  const { locale } = useLocale();
  return (zh: string, en: string) => locale === 'en-US' ? en : zh;
}

export function formatConsoleTime(value: string, full = false): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return full ? date.toLocaleString() : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
