import { useI18n } from '@/i18n/context';
import type { WorkCaseV5Group } from '@/shared/workcaseLifecycle';

interface WorkCaseProgressTrackProps {
  group?: WorkCaseV5Group | null;
  showUnavailable?: boolean;
  className?: string;
}

/** 21 号三态直读派生组的轻量进度指示（无 v4 相位/步骤链）。 */
export default function WorkCaseProgressTrack({
  group,
  showUnavailable = false,
  className = 'mt-2.5',
}: WorkCaseProgressTrackProps) {
  const { t } = useI18n();
  if (!group) {
    if (!showUnavailable) return null;
    return (
      <div
        role="status"
        className={`${className} ldh-card-decision-body flex min-w-0 items-center gap-2 text-ldvh-text-secondary`}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current/65" aria-hidden="true" />
        <span className="min-w-0 break-words">{t('objectList.workcaseStageUnavailable')}</span>
      </div>
    );
  }

  const label = t(`objectList.workcaseGroup.${group}`);
  const toneClass: Record<WorkCaseV5Group, string> = {
    pending_gate1: 'text-amber-500 dark:text-amber-400',
    executing: 'text-sky-500 dark:text-sky-400',
    awaiting_gate2: 'text-violet-500 dark:text-violet-400',
    closed: 'text-zinc-500 dark:text-zinc-400',
  };

  return (
    <div className={`${className} ldh-card-decision-body flex min-w-0 items-center gap-2 ${toneClass[group]}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      <span className="min-w-0 break-words">{label}</span>
    </div>
  );
}
