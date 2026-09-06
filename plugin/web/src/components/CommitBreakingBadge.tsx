import { Unplug } from 'lucide-react';
import { useI18n } from '@/i18n/context';

export default function CommitBreakingBadge({ className = '' }: { className?: string }) {
  const { t } = useI18n();

  return (
    <span className={`${className} inline-flex shrink-0 items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium leading-4 text-red-700 dark:text-red-300`}>
      <Unplug size={10} strokeWidth={2} aria-hidden="true" />
      <span>{t('changelog.breakingChange')}</span>
    </span>
  );
}
