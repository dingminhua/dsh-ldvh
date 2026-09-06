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
  const sizeClassName = size === 'lg'
    ? 'h-7 px-2'
    : size === 'sm'
      ? 'h-5 px-1.5'
      : size === 'xs'
        ? 'h-[18px] px-[5px] text-[10px] leading-3'
        : 'h-6 px-2';

  return (
    <span
      aria-label={label}
      title={label}
      className={`ldvh-chip inline-flex shrink-0 items-center justify-center rounded-md border font-sans font-medium ${sizeClassName} ${getPriorityIconClassName(priority)} ${className}`}
    >
      {priority}
    </span>
  );
}
