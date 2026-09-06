import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { UI_LOCALES, getStatusLocale, type Locale, type LocaleKey } from './locales';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: LocaleKey, params?: Record<string, string>) => string;
  getStatus: (status: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem('ldvh-locale');
    return (saved === 'en' ? 'en' : 'zh') as Locale;
  });

  const handleSetLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem('ldvh-locale', newLocale);
  }, []);

  const t = useCallback((key: LocaleKey, params?: Record<string, string>): string => {
    let text: string = UI_LOCALES[locale][key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v);
      }
    }
    return text;
  }, [locale]);

  const getStatus = useCallback((status: string): string => {
    return getStatusLocale(status, locale);
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale: handleSetLocale, t, getStatus }}>
      {children}
    </I18nContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
