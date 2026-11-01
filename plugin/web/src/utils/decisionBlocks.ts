/**
 * 左色条决策块（对象卡片/详情内的类型专属语义块）类串单源。
 *
 * 家族成员（收敛时点 2026-09-24，批次C）：
 * - Pitfall 决策字段块（琥珀·卡面）——ObjectList
 * - Friction 现象块（琥珀·卡面）——ObjectList
 * - Norm 方向键块（紫·卡面 truncate / 详情面 break-all）——ObjectList + FactReadingLayouts
 * - SubGoal 锚点块（黄绿·**仅详情面**）——FactReadingLayouts
 *   （2026-11 加入；**卡面已于 2026-11-02 退出本家族**，见 `DECISION_CARD_SHELL_CLASS` 注）
 *
 * 刻意不并入的左色条远亲（透明度与语义不同，属「状态通知」子族）：
 * - CognitionCenter 模块不可用红通知（border-red-400/25 + bg-red-500/5 + px-2.5 py-2）
 * - ObjectDetail 只读提示 zinc 块（border-zinc-400/25 + bg-zinc-500/5）
 *
 * 本家族为纯代码层约定（docs/ 无左色条/决策块锚点）；与判据面板「四边同为 1px」
 * Human 定案（specs/10:298）的关系：该定案作用域为判据面板，决策块保留左条强调。
 * 是否统一由 Human 裁决，收敛时不动视觉。
 *
 * **2026-11-02 更新：子目标卡面已并入判据面板那一侧**（Human 定案「样式对齐
 * workcase 的，左侧的线条不要加粗」）——它改用 `WORKCASE_SURFACE_GEOMETRY_CLASS`
 * 的四边同宽形态，故退出本家族。本家族现在只覆盖**卡面 amber/violet** 与
 * **详情面 neutral/lime** 四条壳；「决策块是否整体并入判据面板」这一争议对其余
 * 四条仍未裁决，本文件的立场仍是「收敛时不动视觉」。
 */

/**
 * 卡面壳：色相同系染色 + 同色相 2px 左条。
 *
 * `lime` 是 2026-11 为 28 号 SubGoal 加入的第三色相。加它的理由不是「新类型
 * 就该新颜色」，而是现有两色都已被占用且语义冲突：`amber` 在 Pitfall 与
 * Friction 上表示「需要处置的条目」，`violet` 在 Norm 上表示「成体系的规则」；
 * 子目标既非待处置也非规则体系，它是目标层的下级锚点——借用任一色都会让读者
 * 把子目标误读成那两类之一。lime 与 Goal 的 emerald 同属绿族而不等值，读作
 * 「同一目标层的下一级」。
 *
 * **加入成本已付**：`structure-single-source-contract` 的
 * `DECISION_SHELL_SEGMENTS` / `DECISION_TITLE_HUE_CLASS` 均按色相逐条登记，
 * 新增色相必须同步该守卫（否则守卫只验证旧两色、新色相可自由漂移）。
 *
 * **`lime` 已退出本常量（2026-11-02，Human 定案）**：子目标**卡面**的判据框改为
 * 「对齐 WorkCase」——四边同宽 1px、无左粗线、无染色底，直接复用
 * `WORKCASE_SURFACE_GEOMETRY_CLASS`。左色条一旦撤掉，这枚壳就不再属于本家族
 * （本家族的定义特征正是左色条），留着它只是一个没人消费的死常量，故整条删除。
 * **`DECISION_TITLE_HUE_CLASS.lime` 保留**：子目标**详情面**锚点块仍在用，
 * 该处不在本次定案范围内。子目标因此成为「卡面不用左色条、详情面仍用」的唯一
 * 类型——这是分岔而非漂移：卡面是扫读窗口，跟着判据面板的既定形态走；详情面是
 * 阅读面，保留类型色锚点。
 */
export const DECISION_CARD_SHELL_CLASS: Record<'amber' | 'violet', string> = {
  amber: 'min-w-0 rounded-md border border-amber-400/20 border-l-2 border-l-amber-400/70 bg-amber-500/[0.025] px-3.5 py-3',
  violet: 'min-w-0 rounded-md border border-violet-400/20 border-l-2 border-l-violet-400/70 bg-violet-500/[0.025] px-3.5 py-3',
};

/** 详情面壳（Norm 方向键）：中性壳 + 类型色左条——详情面不整面染色（卡/详情面分岔，与 specs/10:300 密度分岔同源）。 */
export const DECISION_DETAIL_NEUTRAL_SHELL_CLASS =
  'min-w-0 rounded-md border border-ldvh-border/80 border-l-2 border-l-violet-400/70 bg-ldvh-bg/65 px-3.5 py-3';

/** 详情面壳（SubGoal 锚点）：中性壳 + 黄绿左条——同上分岔纪律，只换类型色。 */
export const DECISION_DETAIL_LIME_SHELL_CLASS =
  'min-w-0 rounded-md border border-ldvh-border/80 border-l-2 border-l-lime-400/70 bg-ldvh-bg/65 px-3.5 py-3';

/** 标题色相（使用处补 ldvh-card-decision-title 与布局位如 min-w-0）。 */
export const DECISION_TITLE_HUE_CLASS: Record<'amber' | 'violet' | 'lime', string> = {
  amber: 'text-amber-700/85 dark:text-amber-200/85',
  violet: 'text-violet-700/85 dark:text-violet-200/85',
  lime: 'text-lime-700/85 dark:text-lime-200/85',
};

/** 琥珀正文色相（配 ldvh-card-decision-body；深字低饱和——同色相纪律 docs/01 §1.4 行311）。 */
export const DECISION_AMBER_BODY_HUE_CLASS = 'text-amber-950/70 dark:text-amber-100/75';

/** 紫方向键 code chip 色相（使用处补 ldvh-chip-sm min-w-0 shrink-0 + truncate/break-all）。 */
export const DECISION_VIOLET_CODE_CHIP_HUE_CLASS =
  'border-violet-400/35 bg-violet-500/10 font-mono text-violet-700 dark:text-violet-300';
