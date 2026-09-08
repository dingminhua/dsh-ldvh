import { getObjectPriority, getPriorityIconClassName, getPriorityLabel, type ObjectSignalSource, type SignalObjectType } from '@/utils/objectSignals';

export default function PriorityIcon({
  source,
  type,
  locale,
  size = 'md',
  className = '',
}: {
  source: ObjectSignalSource;
  type?: SignalObjectType;
  locale: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const priority = getObjectPriority(source, type);
  if (!priority) return null;

  const label = getPriorityLabel(priority, locale) ?? priority;
  // xs 挡用紧凑 chip（10px）；其余用标准 chip（12px）。
  const compact = size === 'xs';
  const sizeClassName = compact
    ? 'h-[18px] leading-3'
    : size === 'lg'
      ? 'h-7 px-2'
      : size === 'sm'
        ? 'h-5 px-1.5'
        : 'h-6 px-2';

  return (
    <span
      aria-label={label}
      title={label}
      className={`${compact ? 'ldvh-chip-sm' : 'ldvh-chip'} inline-flex shrink-0 items-center justify-center rounded-md border font-sans font-medium ${sizeClassName} ${getPriorityIconClassName(priority)} ${className}`}
    >
      {priority}
    </span>
  );
}
