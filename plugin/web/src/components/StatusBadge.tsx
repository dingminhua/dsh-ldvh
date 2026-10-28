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
    // 26 §9 / 27 号 §9：**收敛类**终态用中性灰——已废弃（记错了的账）与已退役
    // 是收敛而非警示。已销账**不在其列**：它是达成，走配色表的正向绿（Human
    // 定案 2026-11「已消账的icon应该是绿色的」；与下方 spark implemented 同例）。
    || (objectType === 'friction' && status === 'voided')
    // 26 §9：accepted（已接受、不可清偿）是「记对了但修不了」，属收敛而非警示，
    // 用中性灰；它不是废弃，语义由 status label 区分。
    || (objectType === 'friction' && status === 'accepted')
    || (objectType === 'norm' && status === 'retired')
    ? '#6b7280'
    // 20 §9：spark implemented（落实/交接）走正向达成绿（Human 定案
    // 2026-09-13），不再是中性灰——落实是正结果不是收敛。
    : getStatusColor(status);
  const compact = variant === 'compact' || size === 'xs';
  // compact 分支只走 `ldvh-chip-sm`——高度与行高由该语义类给出（18px / leading-3），
  // 不再手写 `h-[18px] leading-3` 重复同一几何（10 §5.5 单一来源纪律）。
  const sizeClasses = compact
    ? ''
    : size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';
  const display = statusLabel || getStatusLocale(status, locale);
  const tooltip = getObjectStatusHint(objectType, status, locale);

  return (
    <span
      key={resolved}
      className={`${compact ? 'ldvh-chip-sm' : 'ldvh-chip'} inline-flex items-center whitespace-nowrap ${variant === 'compact' ? 'rounded-md' : 'rounded-full'} font-medium ${sizeClasses}`}
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
