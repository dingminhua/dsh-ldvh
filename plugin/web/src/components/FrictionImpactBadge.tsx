import { getFieldLabel, getFieldValueLabel } from '@/i18n/locales';
import { FRICTION_IMPACT_CHIP_CLASS } from '@/utils/semanticColors';

/** 26 §8 impact（影响评级闭集 light/medium/heavy）的标签：类型标签 → 优先级 →
 * SG → **影响** → 修改次数 序列中的一枚裸 chip（无字段名前缀）。
 *
 * **为什么抽成组件**（Human 2026-11 指出「详情里表现的方式要和 card 一致」）：
 * 同一字段在三处出现——列表卡卡头（`ObjectList` 的 `ObjectCardFrame`）、聚焦页
 * （`CognitionCenter` 复用同一个 `ObjectCardFrame`）、详情页身份头部
 * （`ObjectDetail` 的 `ObjectCardFrame`）——三处都必须**同形**：同位置（头部标签区，
 * 与 PriorityIcon/ServesSgBadge 同行同序）、同尺寸（`ldvh-chip-sm` 且无图标）、
 * 同色相（共享 `FRICTION_IMPACT_CHIP_CLASS`）。
 *
 * 此前详情页把它放进 footer 的元信息行，形态是「字段名: 值」的 `HeaderDateMeta`
 * ——与 card 的裸 chip 不同形，故 Human 一眼看出不一致。本组件是该字段呈现的
 * **单一来源**：任何一处需要呈现 impact，都用它，不得各自手写 chip。 */
export default function FrictionImpactBadge({ value, locale }: { value: unknown; locale: string }) {
  if (typeof value !== 'string') return null;
  const impact = value.trim();
  if (!impact) return null;
  const chipClass = FRICTION_IMPACT_CHIP_CLASS[impact];
  // 闭集外的取值不渲染——26 §8 只定义 light/medium/heavy；渲染未知值为空色 chip
  // 会在界面上给出一个没有语义的色块。
  if (!chipClass) return null;
  return (
    <span
      className={`ldvh-chip-sm shrink-0 ${chipClass}`}
      title={`${getFieldLabel('impact', locale)}: ${getFieldValueLabel('impact', impact, locale)}`}
    >
      {getFieldValueLabel('impact', impact, locale)}
    </span>
  );
}
