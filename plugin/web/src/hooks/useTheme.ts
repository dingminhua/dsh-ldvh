import { useState, useEffect, useCallback } from 'react';

type ThemeMode = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'ldvh-theme-mode';

function readStoredMode(): ThemeMode | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : null;
  } catch {
    return null;
  }
}

function persistMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    void 0;
  }
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode) {
  const resolved = mode === 'system' ? getSystemTheme() : mode;
  const html = document.documentElement;
  html.classList.remove('light', 'dark');
  html.classList.add(resolved);
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredMode() ?? 'system');

  useEffect(() => {
    applyTheme(mode);
    persistMode(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const cycleTheme = useCallback(() => {
    setMode(prev => {
      if (prev === 'system') return 'light';
      if (prev === 'light') return 'dark';
      return 'system';
    });
  }, []);

  const resolved = mode === 'system' ? getSystemTheme() : mode;

  return {
    mode,
    resolved,
    isDark: resolved === 'dark',
    setMode,
    cycleTheme,
  };
}
