import { useState, useEffect, useCallback } from 'react';

type ThemeMode = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'ldvh-theme-mode';

/**
 * 侧边栏 iframe（不透明源沙箱）兼容：better-sidebar 对与 GUI 同源的页面
 * 永不给 allow-same-origin，localStorage 访问会抛 SecurityError。降级为
 * 会话内存态（每次进入侧栏回默认 system 主题），正常模式行为不变。
 */
function readStoredMode(): ThemeMode | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : null;
  } catch {
    return null;
  }
}

function persistMode(mode: ThemeMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* 沙箱模式：内存态 */ }
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

  // 初始化 + 同步 DOM
  useEffect(() => {
    applyTheme(mode);
    persistMode(mode);
  }, [mode]);

  // 监听系统主题变化
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
