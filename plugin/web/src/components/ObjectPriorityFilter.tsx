import { useMemo } from 'react';
import type { FactCoverageStatus, ObjectStatusOption } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import PriorityIcon from '@/components/PriorityIcon';

// Spark 优先级档位（20 §8，2026-09-13 Human 裁定新增）：闭集 P0–P3。
// AI 综合判断出初值、Human 可按情况调整；仅 open 时出现，终态省略。
// WorkCase 无此字段（21 §160 闭集未含 priority）。
const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'];

interface ObjectPriorityFilterProps {
  activePriority: string | null;
  onChange: (priority: string | null) => void;
  options?: ObjectStatusOption[];
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
  loading = false,
  coverageStatus = 'complete',
}: ObjectPriorityFilterProps) {
  const { t, locale } = useI18n();
  const counts = useMemo(() => new Map(options.map((option) => [option.status, option.count])), [options]);
  const total = PRIORITY_ORDER.reduce((sum, priority) => sum + (counts.get(priority) ?? 0), 0);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" aria-label={t('objectList.priorityFilter')}>
      <span className="ldvh-meta shrink-0 text-ldvh-text-secondary">{t('objectList.priorityFilter')}</span>
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
