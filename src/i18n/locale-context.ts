import { createContext } from 'react';
import type { Locale, MessageKey, MessageValues } from './locale';

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, values?: MessageValues) => string;
}

// Stable identity across message and provider HMR updates. A new context here
// would disconnect an existing provider from freshly updated consumers.
export const LocaleContext = createContext<LocaleContextValue | null>(null);
