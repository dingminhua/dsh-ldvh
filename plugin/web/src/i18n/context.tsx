import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { UI_LOCALES, getStatusLocale, type Locale, type LocaleKey } from './locales';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: LocaleKey, params?: Record<string, string>) => string;
  getStatus: (status: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * 侧边栏 iframe（不透明源沙箱）兼容：better-sidebar 对与 GUI 同源的页面
 * 永不给 `allow-same-origin`，此时 `localStorage` 的**读取**即抛 `SecurityError`。
 * 本函数在 `I18nProvider` 初始化时同步执行（`useState` 初值），一旦抛出即令整个
 * React 树挂载失败——页面全白，且不产生任何可见错误边界。
 *
 * 实测（2026-09-27）：外层文档内嵌 `<iframe src="http://127.0.0.1:3299/ldvh/">`
 * 时，`#root` 长度为 0、控制台报 `SecurityError: Failed to read the 'localStorage'
 * property from 'Window'`，SPA 完全不渲染。同目录 `useTheme.ts` 与
 * `utils/projectContext.tsx` 对此情形早已降级为内存态，本处是**漏网的一处**。
 *
 * 降级语义：存储不可用时回落到默认语言（`zh`），与 `useTheme` 的「会话内存态」
 * 同纪律——功能不变，仅不跨会话记忆。
 */
function readStoredLocale(): Locale {
  try {
    return localStorage.getItem('ldvh-locale') === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(readStoredLocale);

  const handleSetLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    try {
      localStorage.setItem('ldvh-locale', newLocale);
    } catch {
      // 沙箱模式：内存态。选择当次有效，仅不跨会话记忆。
    }
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
