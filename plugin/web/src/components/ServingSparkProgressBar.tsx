import type { ReactNode } from 'react';
import type { ServingWorkItem } from '@/utils/api';
import { summarizeServingSparkProgress, type ServingSparkProgress } from '@/utils/servingSparkProgress';

export default function ServingSparkProgressBar({
  rows,
  unreadable,
  progressLabel,
  emptyLabel,
  allDiscardedLabel,
  unavailableLabel,
  unknownStatusLabel,
  variant = 'block',
  inlineLabels,
}: {
  rows: readonly ServingWorkItem[];
  unreadable?: readonly string[];
  progressLabel: string;
  emptyLabel: string;
  allDiscardedLabel: string;
  unavailableLabel: string;
  unknownStatusLabel: (count: number) => string;
  variant?: 'block' | 'inline';
  inlineLabels?: {
    empty: string;
    allDiscarded: string;
    unavailable: string;
    emptyTitle: string;
    allDiscardedTitle: string;
    unavailableTitle: string;
  };
}) {
  const progress: ServingSparkProgress = summarizeServingSparkProgress(rows, unreadable);

  if (variant === 'inline' && inlineLabels !== undefined) {
    return (
      <InlineBar
        progress={progress}
        progressLabel={progressLabel}
        unknownStatusLabel={unknownStatusLabel}
        labels={inlineLabels}
      />
    );
  }

  if (progress.kind === 'unavailable') {
    return (
      <Notice className="text-amber-700 dark:text-amber-300" title={unavailableLabel}>
        {progress.reason}
      </Notice>
    );
  }
  if (progress.kind === 'empty') {
    return <Notice className="text-ldvh-text-secondary" title={emptyLabel}>{emptyLabel}</Notice>;
  }
  if (progress.kind === 'allDiscarded') {
    return <Notice className="text-ldvh-text-secondary" title={allDiscardedLabel}>{allDiscardedLabel}</Notice>;
  }

  const { implemented, denominator, unknownStatus } = progress;
  const ratioPct = denominator > 0 ? Math.round((implemented / denominator) * 100) : 0;

  return (
    <section className="flex min-w-0 flex-col gap-1">
      { }
      <div className="flex min-w-0 items-baseline justify-center gap-2 text-center">
        <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/60">{progressLabel}</span>
        <span className="ldvh-meta min-w-0 shrink-0 font-mono text-ldvh-text-secondary/70">
          {implemented} / {denominator}
        </span>
      </div>
      {denominator > 0 && (
        <div
          className="flex h-1.5 w-full min-w-0 overflow-hidden rounded-full bg-ldvh-border/70"
          role="img"
          aria-label={`${progressLabel} ${implemented} / ${denominator}`}
        >
          <div className="h-full shrink-0 bg-ldvh-accent/85" style={{ width: `${ratioPct}%` }} />
        </div>
      )}
      {unknownStatus > 0 && (
        <span className="ldvh-meta min-w-0 text-amber-700 dark:text-amber-300">
          {unknownStatusLabel(unknownStatus)}
        </span>
      )}
    </section>
  );
}

function Notice({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className: string;
  title: string;
}) {
  return (
    <p className={`ldvh-meta min-w-0 break-words ${className}`} title={title}>
      {children}
    </p>
  );
}

function InlineBar({
  progress,
  progressLabel,
  unknownStatusLabel,
  labels,
}: {
  progress: ServingSparkProgress;
  progressLabel: string;
  unknownStatusLabel: (count: number) => string;
  labels: {
    empty: string;
    allDiscarded: string;
    unavailable: string;
    emptyTitle: string;
    allDiscardedTitle: string;
    unavailableTitle: string;
  };
}) {
  if (progress.kind !== 'ratio') {
    const [text, title, tone] = progress.kind === 'empty'
      ? [labels.empty, labels.emptyTitle, 'text-ldvh-text-secondary/70']
      : progress.kind === 'allDiscarded'
        ? [labels.allDiscarded, labels.allDiscardedTitle, 'text-ldvh-text-secondary/70']
        : [labels.unavailable, labels.unavailableTitle, 'text-amber-700 dark:text-amber-300'];
    return (
      <div className="flex w-24 shrink-0 flex-col items-center gap-1">
        <span className={`ldvh-meta w-full min-w-0 truncate text-center leading-6 ${tone}`} title={title}>
          {text}
        </span>
      </div>
    );
  }

  const { implemented, denominator, unknownStatus } = progress;
  const ratioPct = denominator > 0 ? Math.round((implemented / denominator) * 100) : 0;
  return (
    <div className="flex w-24 shrink-0 flex-col items-center gap-1">
      <span
        className="w-full min-w-0 shrink-0 truncate text-center font-mono text-[11px] leading-6 text-ldvh-text-secondary"
        title={`${progressLabel} ${implemented} / ${denominator}`}
      >
        {implemented} / {denominator}
      </span>
      {denominator > 0 ? (
        <div
          className="-mt-1 flex h-1 w-full shrink-0 overflow-hidden rounded-full bg-ldvh-border/70"
          role="img"
          aria-label={`${progressLabel} ${implemented} / ${denominator}`}
        >
          <div className="h-full shrink-0 bg-ldvh-accent/85" style={{ width: `${ratioPct}%` }} />
        </div>
      ) : (
        <span className="-mt-1 h-1 w-full shrink-0" aria-hidden="true" />
      )}
      {unknownStatus > 0 && (
        <span
          className="ldvh-meta w-full min-w-0 shrink-0 truncate text-amber-700 dark:text-amber-300"
          title={unknownStatusLabel(unknownStatus)}
        >
          +{unknownStatus}
        </span>
      )}
    </div>
  );
}
