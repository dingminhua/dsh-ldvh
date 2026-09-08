import { Unplug } from 'lucide-react';
import { useI18n } from '@/i18n/context';

export default function CommitBreakingBadge({ className = '' }: { className?: string }) {
  const { t } = useI18n();

  return (
    <span className={`${className} ldvh-chip-sm items-center gap-1 whitespace-nowrap border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300`}>
      <Unplug size={10} strokeWidth={2} aria-hidden="true" />
      <span>{t('changelog.breakingChange')}</span>
    </span>
  );
}
