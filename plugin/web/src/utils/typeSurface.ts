import type { CSSProperties } from 'react';
import { getCategoryColor } from './categoryColors.ts';

/**
 * **类型色语义面**（单一来源）——把「这一块正文属于哪一类对象」这一天维度，
 * 用该对象自己的类型色表达在卡体主块上。
 *
 * ## 立此模块的由来（Human 定案 2026-11-02）
 *
 * Human 指着两张截图里被圈出的卡体主块说：「圈出来的要和类型的颜色对上，也就是
 * 同一个色系的」。两张截图分别是**子目标卡**（类型色 lime `#84cc16`）与**开发日志卡**
 * （类型色 magenta `#ca21a0`），而它们的卡体主块当时都是**同一个蓝面**——
 * `WORKCASE_CRITERIA_SURFACE_CLASS`（蓝边框 + 蓝淡底 + 蓝灰正文）。
 *
 * 那个蓝面本身没错：2026-11-02 早先的定案是「子目标判据框样式对齐 workcase 的」，
 * 对齐时照抄了 WorkCase 的**整面**（含蓝）。但蓝是 **WorkCase 自己的类型色**，不是
 * 「判据面通用色」。照抄整面等于把「WorkCase 是蓝的」这条副属性当成了这一类面的定义
 * ——于是子目标与开发日志的卡体主块都在替 WorkCase 声明身份，而卡头那枚类型 chip 说的是
 * 另一件事。同一屏上两个色相各说各话，读者要先怀疑哪一个。
 *
 * ## 分工
 *
 * - **几何**仍取自 `WORKCASE_SURFACE_GEOMETRY_CLASS`（四边同宽 1px、`rounded-lg`、
 *   `px-3 py-2`）——2026-11-02 的「对齐 workcase」定案在**几何**上继续成立，本模块只
 *   接管色相。
 * - **色相**取自 `CATEGORY_COLORS[type]`（类型色的唯一来源），故本面与卡头类型 chip、
 *   侧栏图标、详情身份图标**天然同源**，不需要第二张色表。
 *
 * ## 为什么用 `color-mix()` 而不是再写一张 9 类 × 2 模式的 Tailwind 色表
 *
 * 备选方案是照 `FRICTION_IMPACT_CHIP_CLASS` 那样登记 `{类型: 'border-x-400/25
 * bg-x-500/5 text-x-900/70 dark:text-x-100/75'}`。否决理由有两条，都不是口味问题：
 *
 * 1. **Tailwind 的色相板与类型色不是同一套值**。类型色是 hex（`devlog` = `#ca21a0`，
 *    色相 315°），最近的 Tailwind 色是 `fuchsia`（292°）或 `pink`（330°）。用类名就得
 *    二选一，二者都在 15° 以上偏离 Human 那句「同一个色系」的要求——而卡头 chip 用的是
 *    精确 hex，两者并排会读出**两种紫红**。
 * 2. **正文档位需要「该色相更深但低饱和」**（`docs/01` §1.6 对彩色语义面的要求）。
 *    9 类 × 明暗两档 = 18 条手调字面量，下一次调档只会改到其中一部分——这正是本仓
 *    反复出现的「两处各写一套」病。
 *
 * `color-mix()` 让「同一个色系」由**计算**保证而不是由抄写保证：边框与底色按类型色
 * 稀释，正文按类型色与 `--ldvh-text-primary` 混合——后者在明暗主题间自动翻转，故正文
 * 在浅色下是「深一档的同色相」、在暗色下是「亮一档的同色相」，两种模式都读得清，且
 * 不需要 `dark:` 分支。
 *
 * ## 保证边界（如实声明）
 *
 * - 本模块只保证**色相家族一致**。对比度由混合比例决定，未对每个类型色逐一实测
 *   （见 `docs/11` 的未覆盖项）；若某类型色在某一主题下读不清，调的是这里的比例常量，
 *   不是某个消费方。
 * - `color-mix()` 需要 Chromium 111+ / Safari 16.2+ / Firefox 113+。不支持时这三个
 *   属性整条失效：边框退回 `currentColor`、底色透明、正文继承 `--ldvh-text-primary`。
 *   即**降级成无染色的可读块**，不是坏块——这是选它而不选「远端色表」的另一个理由。
 */

/** 边框处类型色的占比（%）：比背景重，用作面的边界。 */
export const TYPE_SURFACE_BORDER_MIX = 30;
/** 背景处类型色的占比（%）：极淡，只用来提示色相，不盖过页面底色。 */
export const TYPE_SURFACE_BACKGROUND_MIX = 5;
/** 正文处类型色的占比（%）：其余部分与 `--ldvh-text-primary` 混合，保证可读。 */
export const TYPE_SURFACE_TEXT_MIX = 58;

/** 类型色（未登记的类型退回 `CATEGORY_COLORS.other`，与卡头 chip 的兜底同源）。 */
function typeColorOf(type: string): string {
  return getCategoryColor(type);
}

/**
 * 卡体主块的类型色语义面：`surface` 给承载块，`body` 给块内正文。
 *
 * 两者必须**成对使用**——只贴 `surface` 会让正文沿用中性近黑，色相面与正文分家
 * （`docs/01` §1.6 明确要求「标题、正文与背景必须属于同一色相」）。
 */
export function getTypeSurfaceTint(type: string): { surface: CSSProperties; body: CSSProperties } {
  const color = typeColorOf(type);
  return {
    surface: {
      borderColor: `color-mix(in oklab, ${color} ${TYPE_SURFACE_BORDER_MIX}%, transparent)`,
      backgroundColor: `color-mix(in oklab, ${color} ${TYPE_SURFACE_BACKGROUND_MIX}%, transparent)`,
    },
    body: {
      color: `color-mix(in oklab, ${color} ${TYPE_SURFACE_TEXT_MIX}%, rgb(var(--ldvh-text-primary)))`,
    },
  };
}
