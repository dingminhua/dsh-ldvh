import { CircleAlert } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { hasUnavailableIndependentSubagentReview } from '@/shared/workcaseCapability';

export default function WorkCaseCapabilityStatusBadge({ source }: { source: unknown }) {
  const { t } = useI18n();
  if (!hasUnavailableIndependentSubagentReview(source)) return null;
  const hint = t('objectList.workcaseIndependentSubagentUnavailableHint');
  return (
    <span
      aria-label={hint}
      title={hint}
      className="ldvh-chip inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-md border border-amber-400/35 bg-amber-500/[0.07] px-[5px] text-[10px] font-sans font-medium leading-3 text-amber-800 dark:text-amber-100"
    >
      <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
      {t('objectList.workcaseIndependentSubagentUnavailable')}
    </span>
  );
}
