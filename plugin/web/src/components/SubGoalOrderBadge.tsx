import { ListOrdered } from 'lucide-react';
import { useI18n } from '@/i18n/context';

/**
 * 28 §8 `order`（列表显示次序）的卡头标签。
 *
 * ## 为什么在卡头而不再放在判据框里（Human 定案 2026-11-02）
 *
 * 原先把「次序」做成判据框内的一个小标题行（`次序 4` + 判据类型），Human 指认它该
 * 「放到上面，样式对齐其他的 icon」。理由站得住：`order` 是**扫读要素**——它回答
 * 「这一条在列表里排第几」，读者在比较**多条**子目标的先后，而判据框回答的是
 * 「这一条自己怎么算达成」。两者服务于不同的读法，混在一个框里让判据框承担了一个
 * 与判据无关的量。卡头那排 chip 正是「跨条比较、扫一眼」的层级，次序属于那里。
 *
 * ## 样式与其余卡头 chip 同规格（不是新发明一套）
 *
 * `ldvh-chip-sm`（18px 定高、11px 字）+ 12px 图标 + 同色相，与 `FrictionOccurrenceBadge`
 * 完全同形——那两个都是「一个字段值 + 一枚说明它的图标」。**单一来源**：任何一处需要
 * 在卡头呈现 `order`，都用本组件，不各自手写一枚。
 *
 * ## 缺失时的处置（28 §8：`order` 可缺失，是可调整的显示次序而非身份）
 *
 * 缺失**不隐藏整枚 chip**，而是保留图标、把值渲染成 `·`（与目标区子目标行
 * `GoalSection` 的同一约定），可读文本由 `title` 承担。为什么不干脆不渲染：卡头上
 * 突然少一枚 chip，读者无从分辨「这条没有次序」与「这个版本忘了画」——`·` 是
 * 「此处该有值而现在没有」的既有记号。**不补隐式编号**（28 §8 明文禁止）：`·`
 * 不是 0、不是上一条 +1，它只是空缺。
 */
export default function SubGoalOrderBadge({ value }: { value: unknown }) {
  const { t } = useI18n();
  // 只接受正整数（28 §8：`order` 为正整数或缺失）。闭集外的取值按缺失处置——
  // 把一个非法值原样印上卡头，会让它看起来是一条有效的显示次序。
  const order = typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

  return (
    <span
      className="ldvh-chip-sm shrink-0 gap-1 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent"
      title={order === null ? t('objectList.subGoalOrderAbsent') : t('objectList.subGoalOrderLabel')}
    >
      <ListOrdered size={12} aria-hidden="true" />
      <span>{order === null ? '·' : order}</span>
    </span>
  );
}
