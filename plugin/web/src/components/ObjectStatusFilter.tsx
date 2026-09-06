import { useMemo } from 'react';
import type { ObjectStatusOption } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { getObjectStatusLocale } from '@/i18n/locales';

const STATUS_FILTER_ORDER = [
  'draft',
  'active',
  'in_progress',
  'blocked',
  'pending',
  'completed',
  'cancelled',
  'proposed',
  'accepted',
  'open',
  'settled',
  'unclosed',
  'discarded',
  'archived',
  'retired',
  'rejected',
  'deprecated',
  'suspended',
];

const statusOrderIndex = new Map(STATUS_FILTER_ORDER.map((status, index) => [status, index]));

const FALLBACK_STATUSES_BY_TYPE: Record<string, string[]> = {
  adr: ['active', 'retired'],
  pitfall: ['draft', 'active', 'discarded'],
  spark: ['open', 'unclosed', 'settled', 'discarded'],
  study: ['active', 'retired'],
};

interface ObjectStatusFilterProps {
  type: string;
  activeStatus: string | null;
  onChange: (status: string | null) => void;
  options?: ObjectStatusOption[];
  total?: number;
  loading?: boolean;
  className?: string;
}

function sortStatusOptions(options: ObjectStatusOption[]): ObjectStatusOption[] {
  return [...options].sort((a, b) => {
    const aIndex = statusOrderIndex.get(a.status) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = statusOrderIndex.get(b.status) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    if (a.count !== b.count) return b.count - a.count;
    return a.status.localeCompare(b.status);
  });
}

function getButtonClass(active: boolean): string {
  return `ldvh-tab-button ${active ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`;
}

export function getFallbackStatuses(type: string, activeStatus: string | null): string[] {
  const fallback = FALLBACK_STATUSES_BY_TYPE[type] ?? [];
  if (!activeStatus || fallback.includes(activeStatus)) return fallback;
  return [activeStatus, ...fallback];
}

function CountPlaceholder() {
  return (
    <span aria-hidden="true" className="ldvh-tab-count inline-flex items-center justify-center gap-0.5 align-middle">
      <span className="h-1 w-1 animate-pulse rounded-full bg-current opacity-35" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-current opacity-35 [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-current opacity-35 [animation-delay:300ms]" />
    </span>
  );
}

export default function ObjectStatusFilter({
  type,
  activeStatus,
  onChange,
  options = [],
  total = 0,
  loading = false,
  className = '',
}: ObjectStatusFilterProps) {
  const { t, locale } = useI18n();

  const sortedOptions = useMemo(() => sortStatusOptions(options), [options]);
  const fallbackStatuses = useMemo(() => getFallbackStatuses(type, activeStatus), [type, activeStatus]);
  const displayOptions = useMemo(() => {
    if (!(type in FALLBACK_STATUSES_BY_TYPE)) return sortedOptions;
    const counts = new Map(sortedOptions.map((option) => [option.status, option.count]));
    const statuses = [...new Set([...fallbackStatuses, ...sortedOptions.map((option) => option.status)])];
    return statuses.map((status) => ({ status, count: counts.get(status) ?? 0 }));
  }, [fallbackStatuses, sortedOptions, type]);

  if (loading && sortedOptions.length === 0) {
    return (
      <div className={`ldvh-tab-list ${className}`} aria-label={t('objectList.statusFilter')} aria-busy="true">
        {fallbackStatuses.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onChange(status)}
            className={getButtonClass(activeStatus === status)}
          >
            {getObjectStatusLocale(type, status, locale)}
            <CountPlaceholder />
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={getButtonClass(activeStatus === null)}
        >
          {t('objectList.all')}
          <CountPlaceholder />
        </button>
      </div>
    );
  }

  if (displayOptions.length <= 1 && !(type in FALLBACK_STATUSES_BY_TYPE)) return null;

  return (
    <div className={`ldvh-tab-list ${className}`} aria-label={t('objectList.statusFilter')}>
      {displayOptions.map((option) => (
        <button
          key={option.status}
          type="button"
          onClick={() => onChange(option.status)}
          className={getButtonClass(activeStatus === option.status)}
        >
          {getObjectStatusLocale(type, option.status, locale)}
          <span className="ldvh-tab-count">{option.count}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={getButtonClass(activeStatus === null)}
      >
        {t('objectList.all')}
        <span className="ldvh-tab-count">{total}</span>
      </button>
    </div>
  );
}
