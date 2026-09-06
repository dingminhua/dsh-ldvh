import { useTheme } from '@/hooks/useTheme';
import { getStatusColor } from '@/utils/statusColors';
import { getObjectStatusHint, getStatusLocale } from '@/i18n/locales';
import { useI18n } from '@/i18n/context';

interface StatusBadgeProps {
  status: string;
  statusLabel?: string;  // Localized display text
  objectType?: string;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'pill' | 'compact';
}

export default function StatusBadge({ status, statusLabel, objectType = '', size = 'sm', variant = 'pill' }: StatusBadgeProps) {
  const { resolved } = useTheme();
  const { locale } = useI18n();
  const color = (objectType === 'spark' && status === 'discarded')
    || (objectType === 'adr' && status === 'retired')
    || (objectType === 'pitfall' && status === 'discarded')
    || (objectType === 'workcase' && status === 'discarded')
    ? '#6b7280'
    : getStatusColor(status);
  const sizeClasses = variant === 'compact'
    ? 'h-[18px] px-[5px] text-[10px] leading-3'
    : size === 'xs'
      ? 'px-1.5 py-0.5 text-[10px] leading-3'
      : size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';
  const display = statusLabel || getStatusLocale(status, locale);
  const tooltip = getObjectStatusHint(objectType, status, locale);

  return (
    <span
      key={resolved}
      className={`ldvh-chip inline-flex items-center whitespace-nowrap ${variant === 'compact' ? 'rounded-md' : 'rounded-full'} font-sans font-medium ${sizeClasses}`}
      style={{
        color,
        backgroundColor: `${color}18`,
        border: `1px solid ${color}30`,
      }}
      title={tooltip || undefined}
    >
      {display}
    </span>
  );
}
