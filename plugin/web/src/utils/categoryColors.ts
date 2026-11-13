import { getCategoryLabel } from '../i18n/locales.ts';

/**
 * 类型色与状态色分开：事实对象各占一个固定色相，便于跨列表、详情和图表识别。
 * Conventional commit 分类沿用下方的独立映射，不参与事实对象配色。
 */
export const CATEGORY_COLORS: Record<string, string> = {
  adr: '#a855f7',     // purple
  pitfall: '#ef4444', // red
  spark: '#eab308',   // amber
  research: '#14b8a6',   // teal
  friction: '#f97316',   // orange — 26 号摩擦账本
  norm: '#8b5cf6',       // violet — 27 号事实规范（与 ADR 的 purple 色相族相邻但不同值）
  goal: '#10b981',       // emerald — 25 号项目目标（achieved 达成=正向绿色语义）
  subgoal: '#84cc16',    // lime — 28 号子目标（目标层下级锚点：green 族相邻 goal 以示从属，值不同以免混读）
  devlog: '#2c9e43',     // 青绿色（green 偏 teal）— 29 号开发日志（与后端 TYPE_COLORS.devlog 同值）。
                         // 色相 132°：Human 定案改用冷色系（此前为 magenta #ca21a0 / 315°）。
                         // 冷色带里只有绿色带可用——青色带(≈195°)距状态天蓝 #0284c7(200°) 仅 5°、
                         // 靛蓝带(≈238°)距独立复核 #818cf8(235°) 仅 3°，都会与状态色同屏撞读；
                         // 绿色带内本值距最近类型色 goal(160°) 28°、距状态绿 #059669(161°) 29°，
                         // 均留足间隔（契约阈值 20°）。不用中性灰——灰已属终态/收敛状态族，
                         // 类型色借灰会把「这是什么类型」与「它处于什么状态」混读。
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
