import { useMemo } from 'react';
import type { FactCoverageStatus, ObjectStatusOption } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import SubGoalOrderBadge from '@/components/SubGoalOrderBadge';

interface ObjectServesFilterProps {
  activeServes: string | null;
  onChange: (serves: string | null) => void;
  options?: ObjectStatusOption[];
  servesOrders?: Record<string, number>;
  totalCount?: number;
  loading?: boolean;
  coverageStatus?: FactCoverageStatus;
}

function getButtonClass(active: boolean): string {
  return `ldvh-tab-button ${active ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`;
}

export default function ObjectServesFilter({
  activeServes,
  onChange,
  options = [],
  servesOrders = {},
  totalCount,
  loading = false,
  coverageStatus = 'complete',
}: ObjectServesFilterProps) {
  const { t } = useI18n();
  const counts = useMemo(() => new Map(options.map((option) => [option.status, option.count])), [options]);
  const tiered = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const total = typeof totalCount === 'number' ? totalCount : tiered;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" aria-label={t('objectList.servesFilter')}>
      <div className="ldvh-tab-list" role="group" aria-label={t('objectList.servesFilter')}>
        {options.map((option) => (
          <button
            key={option.status}
            type="button"
            onClick={() => onChange(option.status)}
            className={getButtonClass(activeServes === option.status)}
            title={option.status}
          >
            <SubGoalOrderBadge value={servesOrders[option.status]} />
            <span className="ldvh-tab-count">
              {loading ? '·' : formatCoverageCount(option.count, coverageStatus)}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={getButtonClass(activeServes === null)}
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
