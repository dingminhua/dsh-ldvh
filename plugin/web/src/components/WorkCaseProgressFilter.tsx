import { useMemo } from 'react';
import { useI18n } from '@/i18n/context';
import { getWorkCaseGroupLabel } from '@/i18n/locales';
import type { FactCoverageStatus, WorkCaseLifecycleOption, WorkCaseListGroup, WorkCaseV5Filter } from '@/utils/api';

/**
 * WorkCase 列表筛选（21 号三态直读派生五档）：
 * pending_gate1 / executing / awaiting_gate2 / closed / all。
 * 选项源为后端 getWorkCaseLifecycleOptions 的 lifecycleOptions 计数。
 */
const WORKCASE_LIFECYCLE_ORDER: WorkCaseV5Filter[] = [
  'pending_gate1',
  'executing',
  'awaiting_gate2',
  'closed',
  'all',
];

interface WorkCaseProgressFilterProps {
  activeGroup: WorkCaseListGroup | null;
  onChange: (group: WorkCaseListGroup | null) => void;
  options?: WorkCaseLifecycleOption[];
  total?: number;
  loading?: boolean;
  coverageStatus?: FactCoverageStatus;
}

function getButtonClass(active: boolean): string {
  return `ldvh-tab-button ${active ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`;
}

function formatCoverageCount(count: number, coverageStatus: FactCoverageStatus): string {
  if (coverageStatus === 'unavailable' || coverageStatus === 'type_not_integrated') return '—';
  return coverageStatus === 'partial' ? `${count}+` : String(count);
}

export default function WorkCaseProgressFilter({
  activeGroup,
  onChange,
  options = [],
  total = 0,
  loading = false,
  coverageStatus = 'complete',
}: WorkCaseProgressFilterProps) {
  const { t, locale } = useI18n();
  const counts = useMemo(
    () => new Map(options.map((option) => [option.group, option.count])),
    [options],
  );

  return (
    <div className="ldvh-tab-list" role="group" aria-label={t('objectList.lifecycleFilter')}>
      {WORKCASE_LIFECYCLE_ORDER.map((group) =>
        group === 'all' ? (
          <button
            key={group}
            type="button"
            onClick={() => onChange(null)}
            className={getButtonClass(activeGroup === null)}
          >
            {t('objectList.all')}
            <span className="ldvh-tab-count">
              {loading ? '·' : formatCoverageCount(total, coverageStatus)}
            </span>
          </button>
        ) : (
          <button
            key={group}
            type="button"
            onClick={() => onChange(group)}
            className={getButtonClass(activeGroup === group)}
          >
            {getWorkCaseGroupLabel(group, locale)}
            <span className="ldvh-tab-count">
              {loading ? '·' : formatCoverageCount(counts.get(group) ?? 0, coverageStatus)}
            </span>
          </button>
        ),
      )}
    </div>
  );
}
