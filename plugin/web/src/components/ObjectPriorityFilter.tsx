import { useMemo } from 'react';
import type { FactCoverageStatus, ObjectStatusOption } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import PriorityIcon from '@/components/PriorityIcon';

// Spark 优先级档位（20 §8，2026-09-13 Human 裁定新增）：闭集 P0–P3。
// AI 综合判断出初值、Human 可按情况调整；仅 open 时出现，终态省略。
// 其它类型无此字段。
const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'];

interface ObjectPriorityFilterProps {
  activePriority: string | null;
  onChange: (priority: string | null) => void;
  options?: ObjectStatusOption[];
  /** 当前池的列表条数（含未分档项）。「全部」用它，不用各档之和。 */
  totalCount?: number;
  loading?: boolean;
  coverageStatus?: FactCoverageStatus;
}

function getButtonClass(active: boolean): string {
  return `ldvh-tab-button ${active ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`;
}

export default function ObjectPriorityFilter({
  activePriority,
  onChange,
  options = [],
  totalCount,
  loading = false,
  coverageStatus = 'complete',
}: ObjectPriorityFilterProps) {
  const { t, locale } = useI18n();
  const counts = useMemo(() => new Map(options.map((option) => [option.status, option.count])), [options]);
  const tiered = PRIORITY_ORDER.reduce((sum, priority) => sum + (counts.get(priority) ?? 0), 0);
  // **「全部」的口径是列表实际条数，不是各档位之和**（2026-11-14 修）：
  // 20 §8 允许 priority 缺失（「允许暂缺（未分档），不因缺失拒绝创建或更新」），
  // 未分档的 Spark 不落进 P0–P3 任何一格。若「全部」取各档之和，就会出现
  // 「全部 2」而列表实际 3 条——读者会以为筛掉了东西，实际是那条未分档的
  // 没被任何档位认领。故「全部」用外部传入的列表条数，各档位仍只统计已分档项。
  const total = typeof totalCount === 'number' ? totalCount : tiered;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" aria-label={t('objectList.priorityFilter')}>
      <div className="ldvh-tab-list" role="group" aria-label={t('objectList.priorityFilter')}>
        {PRIORITY_ORDER.map((priority) => (
          <button
            key={priority}
            type="button"
            onClick={() => onChange(priority)}
            className={getButtonClass(activePriority === priority)}
          >
            <PriorityIcon source={{ priority }} type="spark" locale={locale} size="xs" />
            <span className="ldvh-tab-count">
              {loading ? '·' : formatCoverageCount(counts.get(priority) ?? 0, coverageStatus)}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={getButtonClass(activePriority === null)}
        >
          {t('objectList.all')}
          <span className="ldvh-tab-count">{loading ? '·' : formatCoverageCount(total, coverageStatus)}</span>
        </button>
      </div>
    </div>
  );
}

function formatCoverageCount(count: number, coverageStatus: FactCoverageStatus): string {
  if (coverageStatus === 'unavailable' || coverageStatus === 'type_not_integrated') return '—';
  return coverageStatus === 'partial' ? `${count}+` : String(count);
}
