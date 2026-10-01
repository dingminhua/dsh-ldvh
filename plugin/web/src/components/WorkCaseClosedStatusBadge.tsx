// 卡头的**合并徽标**：状态词 + 中心圆点 + 结论词（Human 裁定 2026-09-30）。
//
// 「已关闭」卡的卡头此前画**两处**：右侧一枚状态徽标（`已关闭`）＋ 左侧徽标序列末位一枚
// `outcome` 徽标（已完成／部分达成／未达成／已取消）。Human 2026-09-30 裁定合并为一枚、
// 放右侧、以中心圆点连接，**配色由结论决定**——故本组件取代原 `WorkCaseOutcomeBadge`
// 与「已关闭」状态徽标两处，两者不再单独出现。
//
// 三条边界：
//   ① **不承载展开**——点击不展开任何内容；`result.achieved_scope`、逐条判据的证据与
//      `result.residual` 都不上卡（前两者归语义详情 10 §5.3，后者是 §5.3 已登记的例外）；
//   ② **只用于 WorkCase 的「已关闭」卡**（Human 裁定：只改 wc 的已关闭卡）——其余类型与
//      其余状态仍走 `StatusBadge`，本组件不得被套用到它们；
//   ③ **四值各显其真**（Human 在「统一写完成」与「保持四值」之间选择了后者）：**不得**
//      把 `partial`／`not-achieved` 显示成「完成」——那会让卡头说一句载体否认的话
//      （`21 §9.3`：`partial` ＝ 部分判据达成、其余有明确未达成范围）。
import type { LocaleKey } from '@/i18n/locales';
import { useI18n } from '@/i18n/context';
import type { WorkCaseDetailData } from '@/utils/api';

/**
 * 四档配色——**与卡头其它徽标同一尺度**（`10 §5.5` 的「样式与既有徽标一致」）：
 * 边框 `/30`、底色 `/10`、字色 `-600`（暗色档 `-400`），与 SG 徽标、修改次数徽标同形。
 * 尺寸与圆角**不在此处自定**——由共享 class `ldvh-chip-sm` 统一给出（`h-[18px]`／
 * `text-[10px]`／`rounded-md`／`px-1.5`），避免与邻居并排时高低不一。
 */
export const WORKCASE_CLOSED_STATUS_BADGE_CLASS: Record<string, string> = {
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  partial: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'not-achieved': 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  cancelled: 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary',
};

const NEUTRAL = 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary';

/**
 * 状态词与结论词之间的**中心圆点**。
 *
 * 为什么不放进 i18n：它是标点，不是词——两种语言都用同一个符号，放进词表只会制造一个
 * 永远只有一个取值的键。两侧各留一个空格，使读屏与复制都把三段读成一体。
 */
export const WORKCASE_CLOSED_STATUS_SEPARATOR = ' · ';

export default function WorkCaseClosedStatusBadge({
  statusLabel,
  source,
}: {
  /** 状态词（`已关闭`）——由调用方经 `getObjectStatusLocale` 取得，**不在本组件内另取一份**
   *  （两处各取一次是同一信息的两处来源，改一处必漂移）。 */
  statusLabel: string;
  source: Pick<WorkCaseDetailData, 'outcome'>;
}) {
  const { t } = useI18n();
  const outcome = source.outcome;
  if (!outcome) return null;
  const outcomeLabel = t(`objectList.workcaseClosedOutcome.${outcome}` as LocaleKey);
  return (
    <span
      data-workcase-closed-status={outcome}
      title={`${statusLabel}${WORKCASE_CLOSED_STATUS_SEPARATOR}${outcomeLabel}`}
      className={`ldvh-chip-sm ${WORKCASE_CLOSED_STATUS_BADGE_CLASS[outcome] ?? NEUTRAL}`}
    >
      {statusLabel}
      {WORKCASE_CLOSED_STATUS_SEPARATOR}
      {outcomeLabel}
    </span>
  );
}
