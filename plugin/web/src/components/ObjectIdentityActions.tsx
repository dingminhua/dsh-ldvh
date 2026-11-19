import type { ReactNode } from 'react';
import CopyPathButton from '@/components/CopyPathButton';
import ObjectReferenceCopyButton from '@/components/ObjectReferenceCopyButton';
import StatusBadge from '@/components/StatusBadge';

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
      { }
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
      {(showCopyAction && (objectType === 'pitfall' || objectType === 'spark' || objectType === 'report' || objectType === 'friction' || objectType === 'norm' || objectType === 'subgoal' || objectType === 'goal')) && (
        <ObjectReferenceCopyButton projectId={projectId} objectId={target} label={copyLabel} copiedLabel={copiedLabel} />
      )}
      {(showCopyAction && objectType !== 'pitfall' && objectType !== 'spark' && objectType !== 'report' && objectType !== 'friction' && objectType !== 'norm' && objectType !== 'subgoal' && objectType !== 'goal') && (
        <CopyPathButton path={target} label={copyLabel} copiedLabel={copiedLabel} />
      )}
    </div>
  );
}
