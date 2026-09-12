import { getCategoryLabel } from '../i18n/locales.ts';

/**
 * 类型色与状态色分开：事实对象各占一个固定色相，便于跨列表、详情和图表识别。
 * Conventional commit 分类沿用下方的独立映射，不参与事实对象配色。
 */
export const CATEGORY_COLORS: Record<string, string> = {
  workcase: '#3b82f6', // blue
  adr: '#a855f7',     // purple
  pitfall: '#ef4444', // red
  spark: '#eab308',   // amber
  research: '#14b8a6',   // teal
  friction: '#f97316',   // orange — 26 号摩擦账本
  norm: '#8b5cf6',       // violet — 27 号事实规范（与 ADR 的 purple 色相族相邻但不同值）
  external_research: '#0ea5e9', // sky — Study 报告类型，与研究(teal)区分
  internal_audit: '#8b5cf6',   // violet — Study 报告类型
  technical_assessment: '#f59e0b', // amber — Study 报告类型
  comparison: '#06b6d4',      // cyan — Study 报告类型
  feat: '#3b82f6',      // blue
  fix: '#ef4444',       // red
  docs: '#6366f1',      // indigo
  style: '#a855f7',     // purple
  refactor: '#06b6d4',  // cyan
  test: '#eab308',      // yellow
  chore: '#6b7280',     // gray
  perf: '#22c55e',      // green
  ci: '#ec4899',        // pink
  build: '#92400e',     // brown
  release: '#7c3aed',   // violet
  spec: '#14b8a6',       // teal
  rule: '#f97316',       // orange
  other: '#6b7280',     // gray
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
}

export function getCategoryLocale(category: string, locale: string): string {
  return getCategoryLabel(category, locale);
}
