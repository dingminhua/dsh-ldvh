import { Unplug } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { LDVH_ERROR_SURFACE_CLASS, LDVH_ERROR_TITLE_CLASS } from '@/utils/semanticColors';

export default function CommitBreakingBadge({ className = '' }: { className?: string }) {
  const { t } = useI18n();

  return (
    <span className={`${className} ldvh-chip-sm items-center gap-1 whitespace-nowrap ${LDVH_ERROR_SURFACE_CLASS} ${LDVH_ERROR_TITLE_CLASS}`}>
      <Unplug size={10} strokeWidth={2} aria-hidden="true" />
      <span>{t('changelog.breakingChange')}</span>
    </span>
  );
}
