/**
 * 左色条决策块（对象卡片/详情内的类型专属语义块）类串单源。
 *
 * 家族成员（收敛时点 2026-09-24，批次C）：
 * - Pitfall 决策字段块（琥珀·卡面）——ObjectList
 * - Friction 现象块（琥珀·卡面）——ObjectList
 * - Norm 方向键块（紫·卡面 truncate / 详情面 break-all）——ObjectList + FactReadingLayouts
 *
 * 刻意不并入的左色条远亲（透明度与语义不同，属「状态通知」子族）：
 * - CognitionCenter 模块不可用红通知（border-red-400/25 + bg-red-500/5 + px-2.5 py-2）
 * - ObjectDetail 只读提示 zinc 块（border-zinc-400/25 + bg-zinc-500/5）
 *
 * 本家族为纯代码层约定（docs/ 无左色条/决策块锚点）；与判据面板「四边同为 1px」
 * Human 定案（specs/10:298）的关系：该定案作用域为判据面板，决策块保留左条强调。
 * 是否统一由 Human 裁决，收敛时不动视觉。
 */

/** 卡面壳：色相同系染色 + 同色相 2px 左条。 */
export const DECISION_CARD_SHELL_CLASS: Record<'amber' | 'violet', string> = {
  amber: 'min-w-0 rounded-md border border-amber-400/20 border-l-2 border-l-amber-400/70 bg-amber-500/[0.025] px-3.5 py-3',
  violet: 'min-w-0 rounded-md border border-violet-400/20 border-l-2 border-l-violet-400/70 bg-violet-500/[0.025] px-3.5 py-3',
};

/** 详情面壳（Norm 方向键）：中性壳 + 类型色左条——详情面不整面染色（卡/详情面分岔，与 specs/10:300 密度分岔同源）。 */
export const DECISION_DETAIL_NEUTRAL_SHELL_CLASS =
  'min-w-0 rounded-md border border-ldvh-border/80 border-l-2 border-l-violet-400/70 bg-ldvh-bg/65 px-3.5 py-3';

/** 标题色相（使用处补 ldvh-card-decision-title 与布局位如 min-w-0）。 */
export const DECISION_TITLE_HUE_CLASS: Record<'amber' | 'violet', string> = {
  amber: 'text-amber-700/85 dark:text-amber-200/85',
  violet: 'text-violet-700/85 dark:text-violet-200/85',
};

/** 琥珀正文色相（配 ldvh-card-decision-body；深字低饱和——同色相纪律 docs/01 §1.4 行311）。 */
export const DECISION_AMBER_BODY_HUE_CLASS = 'text-amber-950/70 dark:text-amber-100/75';

/** 紫方向键 code chip 色相（使用处补 ldvh-chip-sm min-w-0 shrink-0 + truncate/break-all）。 */
export const DECISION_VIOLET_CODE_CHIP_HUE_CLASS =
  'border-violet-400/35 bg-violet-500/10 font-mono text-violet-700 dark:text-violet-300';
