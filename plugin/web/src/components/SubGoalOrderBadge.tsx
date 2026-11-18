import { ListOrdered } from 'lucide-react';
import { useI18n } from '@/i18n/context';

export default function SubGoalOrderBadge({ value }: { value: unknown }) {
  const { t } = useI18n();
  const order = typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

  return (
    <span
      className="ldvh-chip-sm shrink-0 gap-1 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent"
      title={order === null ? t('objectList.subGoalOrderAbsent') : t('objectList.subGoalOrderLabel')}
    >
      <ListOrdered size={12} aria-hidden="true" />
      <span>{order === null ? '·' : order}</span>
    </span>
  );
}
