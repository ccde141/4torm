import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  readStoredLocale,
  resolveMessage,
  writeStoredLocale,
  type Locale,
} from './locale';
import { LocaleContext, type LocaleContextValue } from './locale-context';

function initialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try { return readStoredLocale(window.localStorage); } catch { return DEFAULT_LOCALE; }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try { writeStoredLocale(window.localStorage, locale); } catch { /* unavailable storage */ }
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => resolveMessage(locale, key, values),
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}
