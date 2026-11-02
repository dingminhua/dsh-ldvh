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
   * - `inline`：聚焦页目标区**行内**形态——**数字在上、条在下**，无标题、无两档明细
   *   （Human 2026-11-03 定案）。
   *
   * 两种形态共用同一个 `summarizeServingSparkProgress`，因此**数值不可能不一致**；
   * 差别只在展示密度。
   *
   * 行内形态为什么砍掉指标名与两档明细：那一组横排会占掉子目标标题的宽度——
   * 窗口一窄，标题就被挤成一列字。指标名的完整说法仍在 `title` 与 `aria-label`
   * 上（「火花落实 9 / 30」），口径不丢；两档明细仍可在子目标卡与详情页读到。
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
      {/* 说明行**居中且弱化**（Human 2026-11-03 定案）：指标名 + 分数 + 两档明细是
          「这一块的注解」，不是这一块的标题。此前它左对齐贴边、且分数取主色（近黑），
          读起来像卡上的一个独立小标题——与它实际承担的角色（给下面那条条配一句
          说明）不匹配。

          故两处同改：**居中**（`justify-center` + `text-center`）——注解浮在满宽条的
          正上方，不再与上面的正文左缘咬合；**弱化**——分数由主色改为次级色，指标名
          与两档明细再降一档。

          口径没有因此丢失：完整说法仍在 `title` 与条的 `aria-label`（「火花落实
          9 / 30」）上；数字仍逐字可读、可与名下火花逐条核对。 */}
      <div className="flex min-w-0 items-baseline justify-center gap-2 text-center">
        <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/60">{progressLabel}</span>
        <span className="ldvh-meta min-w-0 shrink-0 font-mono text-ldvh-text-secondary">
          {implemented} / {denominator}
        </span>
        {/* 两档明细只在分母非空时给：它们加起来等于分母，读者可以自己对账。 */}
        {denominator > 0 && (
          <span className="ldvh-meta min-w-0 truncate text-ldvh-text-secondary/60">
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
 * 聚焦页目标区的**行内**形态：**数字在上、条在下**（Human 2026-11-03 定案），挂在
 * 子目标标题行右侧。
 *
 * ## 为什么竖排
 *
 * 横排那一组（指标名 + 条 + 分数 + 两档明细）会占掉子目标标题的宽度——窗口一窄，
 * 标题就被挤成一列字，甚至把进度组整个挤到下一行。故竖排：只占一行宽（96px），
 * 标题在自己的格子里换行，两列互不挤占。
 *
 * ## 为什么条必须等宽
 *
 * 目标区一屏并列四到八条子目标。读者在这一屏要比的是「哪条走得远、哪条没动」——
 * 那只有在**同一把尺子**上才成立。故条一律取同一个固定宽度（`w-24`，见下方实现处），
 * 不按分子分母各自缩放，也不给某条更宽的位置。
 *
 * 反过来说：条**不能**去吃满行宽。第一版正是 `flex-1`，在 1440px 的聚焦页里条长近
 * 2000px，于是 `9 / 30` 读起来像「几乎走完」、`0 / 1` 只剩一条细缝——同屏四条读出
 * 三种错觉，正是「等宽可比」想避免的那件事。
 *
 * ## 为什么三种「算不出」在这里只给短词
 *
 * 行内高度有限，完整那句（「名下没有火花——分母为空，不是 0%」）会把子目标标题挤成
 * 两行，反而让「哪几条子目标」更难扫。故行内只留短词（未拆解／已处置／读不到），
 * 完整理由挂在 `title` 上——鼠标停上去仍读得到，而**不读工具提示的人也不会看到一个
 * 假的 0%**，因为这里根本没有条。
 *
 * 这条与 `docs/01`「状态不得只由颜色承载」同向：短词本身是文字，颜色只是加强。
 *
 * ## 为什么数字要弱、要小、要居中（Human 2026-11-03 定案）
 *
 * 比值在这一行里是**附属信息**，不是主角——主角是子目标标题（怎么才算达成），
 * 标题答完才轮到「走到哪一步」。此前数字取 `ldvh-meta` + 主色（12px 近黑），
 * 视觉权重与标题相仿，读者的目光先被两个数字抓住，再去读标题——顺序反了。
 *
 * 故三处同改（**改的是权重，不是信息**）：
 * - **弱**：取次级色而非主色（`text-ldvh-text-secondary`），不再与标题争「最重要」；
 * - **小**：12px → 11px，一眼可辨但不再抢读；
 * - **居中**：数字在条的正上方居中（`items-center` + `text-center`）——左对齐时
 *   「9 / 30」压在条头，读起来像条的左侧标注；居中后它就是**这条的分数**。
 *
 * 口径没有因此丢失：完整说法仍在 `title` 与 `aria-label`（「火花落实 9 / 30」）。
 *
 * ## 为什么条更短（Human 2026-11-03 定案）
 *
 * 条由 128px（`w-32`）收至 96px（`w-24`）。此前那把「尺子」比目标区这一列实际需要
 * 的长度长出一截，而这一列是四条子目标**并排共用**的：尺子越长，每条子目标标题能
 * 拿到的宽度越少。收短后标题多出一截，条仍足以看出「走了多少」。
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
    // 短词占住**数字该在的那一格**：目标区里这一列是四条共用的标尺，短词落在同一
    // 位置，读者不会误以为这一行「进度条没画出来」是渲染漏了——它就是那个位置在
    // 说明「这里算不出」。下方**不画条**（分母为 0 时一条空条就是假的 0%）。
    return (
      <div className="flex w-24 shrink-0 flex-col items-center gap-1">
        <span className={`ldvh-meta w-full min-w-0 truncate text-center leading-6 ${tone}`} title={title}>
          {text}
        </span>
      </div>
    );
  }

  const { implemented, denominator, unknownStatus } = progress;
  // 分母为 0 时不画条（0/0 不是 0%）——与块形态同一纪律，只差展示密度。
  const ratioPct = denominator > 0 ? Math.round((implemented / denominator) * 100) : 0;
  return (
    // 竖排：**数字在上、条在下**（Human 2026-11-03 定案）。指标名与两档明细都不在
    // 这里——行内那几格横排会占掉子目标标题的宽度，窄屏下标题只能挤成一列字。
    // 口径名（进度条）仍由 `title` 与 `aria-label` 承担。
    <div className="flex w-24 shrink-0 flex-col items-center gap-1">
      <span
        // 数字**弱而小**（次级色 + 11px）：它是这一行的附属数字，不是主角——
        // 主角是标题。字号落到 11px 后标题拿到更多宽度，条也收短到 96px。
        //
        // `leading-6`：**行盒与子目标标题的行盒同高**（标题 `ldvh-body` = 14px/24px），
        // 数字的光心才落在标题的那条水平线上。`leading-4`（16px）时数字的光心比
        // 标题高 4px——两条基线错开，扫读时「这个数说的是哪一条」要靠位置去猜
        // （Human 2026-11-03：「这里没垂直居中」）。
        className="w-full min-w-0 shrink-0 truncate text-center font-mono text-[11px] leading-6 text-ldvh-text-secondary"
        title={`${progressLabel} ${implemented} / ${denominator}`}
      >
        {implemented} / {denominator}
      </span>
      {denominator > 0 ? (
        <div
          // 固定宽度（不是吃满剩余）：目标区整行宽达 2000px，把条拉满会让 9/30
          // 看起来像「几乎走完」，而 0/1 又变成一条细缝——比值反而更难读。
          // 固定 96px（`w-24`）让四条子目标仍共用同一把尺子。
          //
          // `-mt-1`：数字行盒由 16px 变 24px 后，条若顺延会被推到数字下方 10px，
          // 中间浮着一段空白。此处收回 4px——条仍挂在数字下方（离数字墨迹约 6px），
          // 整组高度不变（28px），行高不因这次对齐而长一截。
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
