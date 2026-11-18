import { Eye } from 'lucide-react';
import { useI18n } from '@/i18n/context';

export default function FrictionOccurrenceBadge({ value }: { value: unknown }) {
  const { t } = useI18n();
  if (typeof value !== 'object' || value === null) return null;
  const count = (value as { count?: unknown }).count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;

  return (
    <span
      className="ldvh-chip-sm shrink-0 gap-1 border-sky-400/35 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      title={t('cognition.recent.occurrenceCount', { count: String(count) })}
    >
      <Eye size={12} aria-hidden="true" />
      <span>{count}</span>
    </span>
  );
}
