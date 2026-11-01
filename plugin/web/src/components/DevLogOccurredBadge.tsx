import { CalendarClock } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { formatDateTime } from '@/utils/dateFormat';

/**
 * 29 §10.4 `occurred_at`（那条日志所记工作的**发生时间**）的卡头标签。
 *
 * ## 为什么它必须出现在卡面上，而 `created_at` 不必
 *
 * 29 §10.4 把两个时间**明确分工**：「按时间回查『那段时间在做什么』须用
 * `occurred_at`；判断『这条结论形成多久了』须用 `created_at`」。二者在存量并入时
 * 常常相差很远——一次过去的调优工作在很久之后才被整理成条目。
 *
 * 列表卡是**按时间回查**的入口（29 §12.1「时间线回查」：按 `occurred_at` 排序的
 * 条目清单），所以卡面要给的是发生时间。`created_at` 由详情页的身份区与
 * `change_log` 末条流水承载——它在详情里天然可见，且列表上多一枚「条目形成时间」
 * 只会与旁边那枚发生时间混读。
 *
 * ## 与卡脚「更新时间」chip 是两回事
 *
 * 卡脚 `ObjectUpdatedMeta` 读的是 `change_log` 末条（**这条条目最后一次被改**的
 * 时刻），与「这件工作什么时候做的」不同轴。故二者并不同义，也不能合成一枚。
 *
 * ## 形态
 *
 * 与 `SubGoalOrderBadge` / `FrictionOccurrenceBadge` 同规格：`ldvh-chip-sm`
 * （18px 定高、11px 字）+ 12px 图标 + 同色相。日期用 `formatDateTime`
 * （`YYYY-MM-DD HH:mm`）——与前两者相比它更长，故 `whitespace-nowrap`
 * 防止窄卡上折断成两行；不截断，因为半截时间比没有时间更误导。
 *
 * 缺失（29 §8 把它列为必填，缺失即载体不合规）时**不隐藏整枚 chip**，值渲染成
 * `·` 并给出可读的 `title`——同 `SubGoalOrderBadge` 的既有约定：卡头上突然少一枚
 * chip，读者无从分辨「这条没有发生时间」与「这个版本忘了画」。
 */
export default function DevLogOccurredBadge({ value }: { value: unknown }) {
  const { t } = useI18n();
  const raw = typeof value === 'string' ? value.trim() : '';
  const occurred = raw ? formatDateTime(raw) : '';
  const absent = !raw || occurred === '-';

  return (
    <span
      className="ldvh-chip-sm shrink-0 gap-1 whitespace-nowrap border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent"
      title={absent ? t('objectList.devlogOccurredAbsent') : t('objectList.devlogOccurredLabel')}
    >
      <CalendarClock size={12} aria-hidden="true" />
      <span>{absent ? '·' : occurred}</span>
    </span>
  );
}
