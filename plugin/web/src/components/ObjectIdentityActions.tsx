import type { ReactNode } from 'react';
import CopyPathButton from '@/components/CopyPathButton';
import ObjectReferenceCopyButton from '@/components/ObjectReferenceCopyButton';
import StatusBadge from '@/components/StatusBadge';

/**
 * The identity-row action cluster shared by fact cards, full details, and
 * secondary reading. Keeping the status badge and copy affordance in one
 * component prevents each surface from drifting in visual spacing.
 */
export default function ObjectIdentityActions({
  status,
  statusLabel,
  objectType,
  projectId,
  target,
  statusLeadingBadges,
  statusBadge,

  actionBadges,
  copyLabel,
  copiedLabel,
  showCopyAction = true,
  compact = false,
}: {
  status?: string;
  statusLabel?: string;
  objectType?: string;
  projectId?: string;
  target?: string;
  statusLeadingBadges?: ReactNode;
  /**
   * **替代**默认 `StatusBadge` 的整枚替换口（不与之并排）。
   *
   * 为什么需要：WorkCase 的「已关闭」卡按 Human 裁定 2026-09-30 把状态词与结论词**合并
   * 成一枚**徽标（`已关闭 · 完成` 等），其配色由 `outcome` 决定——而 `StatusBadge` 的取色
   * 只认 `status`（`getStatusColor`），给不出按结论取色的结果。故此处开一个**只替换、不叠加**
   * 的口子：提供 `statusBadge` 时不再渲染默认状态徽标。
   *
   * 边界：本口子只服务「状态词与结论词合并」这一种形态，**不得**用它绕过 `StatusBadge`
   * 的既定配色去做任意样式替换——其他类型与其他状态的卡一律不传它。
   */
  statusBadge?: ReactNode;
  actionBadges?: ReactNode;
  copyLabel?: string;
  copiedLabel?: string;
  showCopyAction?: boolean;
  compact?: boolean;
}) {
  if (!statusLeadingBadges && !status && !statusBadge && !actionBadges && !showCopyAction) return null;

  return (
    <div className={`flex ${compact ? 'h-[18px]' : 'h-7'} shrink-0 items-center gap-1`}>
      {statusLeadingBadges}
      {/* 合并徽标与默认状态徽标**互斥**：给了合并的就不再画默认的（两者并排会把同一件事说两遍）。 */}
      {statusBadge ?? (status && (
        <StatusBadge
          status={status}
          statusLabel={statusLabel}
          objectType={objectType}
          size={compact ? 'xs' : undefined}
          variant={compact ? 'compact' : undefined}
        />
      ))}
      {actionBadges}
      {(showCopyAction && (objectType === 'workcase' || objectType === 'adr' || objectType === 'pitfall' || objectType === 'spark' || objectType === 'research' || objectType === 'friction' || objectType === 'norm' || objectType === 'goal')) && (
        <ObjectReferenceCopyButton projectId={projectId} objectId={target} label={copyLabel} copiedLabel={copiedLabel} />
      )}
      {(showCopyAction && objectType !== 'workcase' && objectType !== 'adr' && objectType !== 'pitfall' && objectType !== 'spark' && objectType !== 'research' && objectType !== 'friction' && objectType !== 'norm' && objectType !== 'goal') && (
        <CopyPathButton path={target} label={copyLabel} copiedLabel={copiedLabel} />
      )}
    </div>
  );
}
