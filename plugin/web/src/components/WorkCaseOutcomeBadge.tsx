// 卡头的 `outcome` 徽标（10 §5.5，Human 裁定 2026-09-30）。
//
// 「已关闭」卡的卡头在**状态徽标之后**呈现这一枚徽标——它是 `outcome` 在卡面上的
// **唯一去处**（原「结论行」已按 2026-09-29 裁定删除，核对计数不再单列）。
//
// 三条边界（同 §5.5 的登记）：
//   ① **不承载展开**——点击不展开任何内容；`result.achieved_scope`、逐条判据的证据与
//      `result.residual` 都不上卡（前两者归语义详情 10 §5.3，后者是 §5.3 已登记的例外）；
//   ② **不算状态词汇**——与 21 号状态机并列呈现，不参与派生分组、不进筛选与收件箱；
//   ③ 配色沿用既有四档（绿／琥珀／红／中性），不新造色。
import type { LocaleKey } from '@/i18n/locales';
import { useI18n } from '@/i18n/context';
import type { WorkCaseDetailData } from '@/utils/api';

/**
 * 四档配色——**与卡头其它徽标同一尺度**（`10 §5.5` 的「样式与既有徽标一致」）：
 * 边框 `/30`、底色 `/10`、字色 `-600`（暗色档 `-400`），与 SG 徽标、修改次数徽标同形。
 * 尺寸与圆角**不在此处自定**——由共享 class `ldvh-chip-sm` 统一给出（`h-[18px]`／
 * `text-[10px]`／`rounded-md`／`px-1.5`），避免与邻居并排时高低不一。
 */
export const WORKCASE_OUTCOME_BADGE_CLASS: Record<string, string> = {
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  partial: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'not-achieved': 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  cancelled: 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary',
};

const NEUTRAL = 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary';

export default function WorkCaseOutcomeBadge({ source }: { source: Pick<WorkCaseDetailData, 'outcome'> }) {
  const { t } = useI18n();
  const outcome = source.outcome;
  if (!outcome) return null;
  return (
    <span
      data-workcase-outcome={outcome}
      title={t(`objectList.workcaseOutcome.${outcome}` as LocaleKey)}
      className={`ldvh-chip-sm ${WORKCASE_OUTCOME_BADGE_CLASS[outcome] ?? NEUTRAL}`}
    >
      {t(`objectList.workcaseOutcome.${outcome}` as LocaleKey)}
    </span>
  );
}
