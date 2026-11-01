import type { ReactNode } from 'react';
import type { ServingWorkItem } from '@/utils/api';
import { summarizeServingSparkProgress, type ServingSparkProgress } from '@/utils/servingSparkProgress';

/**
 * 子目标卡与详情面的「火花落实」比值条（Human 定案 2026-11-02）。
 *
 * Human 原话：「sg 需要呈现一个进度条件，分母是关联的所有 spark，待处理+已落实，
 * 分子是已落实」。口径与理由见 `utils/servingSparkProgress.ts`（单点派生，卡与详情共用）。
 *
 * ## 为什么是「条 + 分数」而不是百分比文字
 *
 * 分数（`9 / 31`）才是可核对的东西——读者能按它去数名下的火花。百分比（`29%`）
 * 是**二次加工**：它把一个可数的比值压成一个看起来精密的数，而分子分母各自都还
 * 需要读者自己去找。故条只承担「大致多少」，精确值一律给分数。
 *
 * ## 为什么三种「算不出」要各说各的
 *
 * 分母为 0 有三种完全不同的原因，下一步动作也不同：
 * - `empty`（名下没有火花）→ 去拆解；
 * - `allDiscarded`（火花都处置掉了）→ 这条判据不再靠火花推进；
 * - `unavailable`（火花读不到）→ 去查读取。
 * 合成一句「暂无」会让读者把「读不到」当成「没有」（00 §5.6）。
 */
export default function ServingSparkProgressBar({
  rows,
  unreadable,
  progressLabel,
  emptyLabel,
  allDiscardedLabel,
  unavailableLabel,
  unknownStatusLabel,
  openLabel,
  implementedLabel,
}: {
  rows: readonly ServingWorkItem[];
  unreadable?: readonly string[];
  progressLabel: string;
  emptyLabel: string;
  allDiscardedLabel: string;
  unavailableLabel: string;
  unknownStatusLabel: (count: number) => string;
  openLabel: string;
  implementedLabel: string;
}) {
  const progress: ServingSparkProgress = summarizeServingSparkProgress(rows, unreadable);

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

  const { implemented, denominator, open, unknownStatus } = progress;
  // 分母为 0 时不画条（0/0 不是 0%）——只留一句说明与那行未计入的计数。
  const ratioPct = denominator > 0 ? Math.round((implemented / denominator) * 100) : 0;

  return (
    <section className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/85">{progressLabel}</span>
        <span className="ldvh-meta min-w-0 shrink-0 font-mono text-ldvh-text-primary">
          {implemented} / {denominator}
        </span>
        {/* 两档明细只在分母非空时给：它们加起来等于分母，读者可以自己对账。 */}
        {denominator > 0 && (
          <span className="ldvh-meta min-w-0 truncate text-ldvh-text-secondary/70">
            {implementedLabel} {implemented} · {openLabel} {open}
          </span>
        )}
      </div>
      {denominator > 0 && (
        // 两段条：已落实（右侧实心）+ 待处理（左侧浅底）。不用单色填充，
        // 因为读者要看的是「还剩几件」而不是「完成了百分之几」。
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

/** 三种「算不出」共用的弱提示形态——一句话，不画框、不占位成条。 */
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
