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
  openLabel: string;
  implementedLabel: string;
  /**
   * 呈现形态（2026-11-02 新增 `inline`）：
   * - `block`（默认）：卡片与详情面的完整形态——标题 + 分数 + 两档明细 + 条。
   * - `inline`：聚焦页目标区**行内**形态——条 + 分数同排，无标题、无两档明细。
   *
   * 两种形态共用同一个 `summarizeServingSparkProgress`，因此**数值不可能不一致**；
   * 差别只在展示密度。目标区一行只有 20px 高，塞进两档明细会把子目标标题挤成
   * 两行——那反而让「哪几条子目标」这件事更难扫。
   */
  variant?: 'block' | 'inline';
  /**
   * `inline` 专用的**短词**（未拆解／已处置／读不到）与它们各自的完整说明。
   *
   * 短词是行内唯一可容纳的形态；完整说明挂 `title`，鼠标停上去仍读得到。二者
   * 必须同时给出——只给短词会让「读不到」看起来像一个状态而不是一个读取故障。
   */
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

/**
 * 聚焦页目标区的**行内**形态（2026-11-02）：条占满行宽、分数落在右端。
 *
 * ## 为什么条必须等宽
 *
 * 目标区一屏并列四到八条子目标。读者在这一屏要比的是「哪条走得远、哪条没动」——
 * 那只有在**同一把尺子**上才成立。故条一律占满该行剩余宽度（`flex-1`），不按
 * 分子分母各自缩放，也不给某条更宽的位置。宽度随容器走、四条一起变，仍可比。
 *
 * ## 为什么三种「算不出」在这里只给短词
 *
 * 行内只有 20px 高，完整那句（「名下没有火花——分母为空，不是 0%」）会把子目标
 * 标题挤成两行，反而让「哪几条子目标」更难扫。故行内只留短词（未拆解／已处置／
 * 读不到），完整理由挂在 `title` 上——鼠标停上去仍读得到，而**不读工具提示的人
 * 也不会看到一个假的 0%**，因为这里根本没有条。
 *
 * 这条与 `docs/01`「状态不得只由颜色承载」同向：短词本身是文字，颜色只是加强。
 */
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
      <p className={`ldvh-meta min-w-0 ${tone}`} title={title}>
        {text}
      </p>
    );
  }

  const { implemented, denominator, unknownStatus } = progress;
  // 分母为 0 时不画条（0/0 不是 0%）——与块形态同一纪律，只差展示密度。
  const ratioPct = denominator > 0 ? Math.round((implemented / denominator) * 100) : 0;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {denominator > 0 ? (
        <div
          // 固定宽度（不是吃满剩余）：目标区整行宽达 2000px，把条拉满会让 9/30
          // 看起来像「几乎走完」，而 0/1 又变成一条细缝——比值反而更难读。
          // 固定 128px 让四条子目标仍共用同一把尺子，且分数就落在条尾旁边。
          className="flex h-1 w-32 shrink-0 overflow-hidden rounded-full bg-ldvh-border/70"
          role="img"
          aria-label={`${progressLabel} ${implemented} / ${denominator}`}
        >
          <div className="h-full shrink-0 bg-ldvh-accent/85" style={{ width: `${ratioPct}%` }} />
        </div>
      ) : (
        <span className="w-32 shrink-0" aria-hidden="true" />
      )}
      <span className="ldvh-meta shrink-0 font-mono text-ldvh-text-primary">
        {implemented} / {denominator}
      </span>
      {unknownStatus > 0 && (
        <span
          className="ldvh-meta shrink-0 text-amber-700 dark:text-amber-300"
          title={unknownStatusLabel(unknownStatus)}
        >
          +{unknownStatus}
        </span>
      )}
    </div>
  );
}
