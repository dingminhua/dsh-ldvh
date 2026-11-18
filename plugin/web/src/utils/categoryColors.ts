import { getCategoryLabel } from '../i18n/locales.ts';

export const CATEGORY_COLORS: Record<string, string> = {
  pitfall: '#ef4444',
  spark: '#eab308',
  report: '#14b8a6',
  friction: '#f97316',
  norm: '#8b5cf6',
  goal: '#10b981',
  subgoal: '#84cc16',
  external_research: '#0ea5e9',
  internal_audit: '#8b5cf6',
  technical_assessment: '#f59e0b',
  comparison: '#06b6d4',
  feat: '#3b82f6',
  fix: '#ef4444',
  docs: '#6366f1',
  style: '#a855f7',
  refactor: '#06b6d4',
  test: '#eab308',
  chore: '#6b7280',
  perf: '#22c55e',
  ci: '#ec4899',
  build: '#92400e',
  release: '#7c3aed',
  spec: '#14b8a6',
  rule: '#f97316',
  other: '#6b7280',
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
}

export function getCategoryLocale(category: string, locale: string): string {
  return getCategoryLabel(category, locale);
}
