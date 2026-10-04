import { Target } from 'lucide-react';
import { getFieldLabel } from '@/i18n/locales';

/** serves（20 §6：goal.md 子目标的 SG-n 轻量锚点，条件出现）归一为列表。
 * 规范当前为单值 string；渲染兼容 string[]，规范演进为数组时无需改前端。 */
function normalizeServesSgList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }
  return [];
}

/** 子目标锚点标签：紧跟事实对象类型标签的 chip（卡片与详情头共用呈现）。
 *
 * **靶心图标为什么是 `size={11}` 而不是与邻居相同的 `12`**（Human 2026-10-05 指出
 * 「SG-3 的图标比别的大」后实测定案）：
 *
 * chip 内图标的**声明尺寸**原本全站统一为 `size={12}`，但 lucide 各图标的图形在
 * 24×24 viewBox 内的占比不同——`Target`（靶心，同心圆环）的 `getBBox()` 是 20×20，
 * `History`（活动数 chip 的时钟）是 18×18。于是同一 12px 框里：
 *   靶心墨迹 = 20/24 × 12 = **10.0px**，时钟 = 18/24 × 12 = **9.0px** —— 差 11%；
 * 且靶心是三层圆环（描边密集），视觉重量进一步放大，肉眼能一眼看出「它比较大」。
 *
 * 对齐到时钟的 9.0px 需 `9 × 24 / 20 = 10.8`；取整数 11 时墨迹 9.17px，与 9.0px
 * 差 1.9%（不可辨），故取 11。
 *
 * **单点登记**：全站 chip 内只有这两种图标（普查：`Target` 74 处、`History` 80 处），
 * 故只此处需补偿。将来若在 chip 内新增图标，须同样按**墨迹**（`getBBox()/24 × size`）
 * 而非声明尺寸对齐，否则会再现本处「声明一致而观感不一致」的形态。 */
export default function ServesSgBadge({ value, locale }: { value: unknown; locale: string }) {
  const values = normalizeServesSgList(value);
  if (values.length === 0) return null;
  const label = getFieldLabel('serves', locale);
  return (
    <>
      {values.map((sg) => (
        <span
          key={sg}
          className="ldvh-chip-sm gap-1 border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400"
          title={`${label} · ${sg}`}
        >
          <Target size={11} aria-hidden="true" />
          <span>{sg}</span>
        </span>
      ))}
    </>
  );
}
