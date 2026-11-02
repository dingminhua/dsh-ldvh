/**
 * 目标区（Goal Section）——聚焦页的第一个模块。
 *
 * 承载 Goal(25) 真实投影：目标陈述 + 子目标列表（28 号对象，按 `parent_goal`
 * 反查派生——不在 goal.md 内存副本，28 §8.1）。
 *
 * 只读、无写入口；本区仅是目标的可视投影，不构成第二事实源（00 §3.3）。
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchCognitionGoal, ApiRequestError, type ServingWorkItem } from '@/utils/api';
import { getObjectStatusLocale } from '@/i18n/locales';
import { useI18n } from '@/i18n/context';
import { copyText } from '@/utils/clipboard';
import { LDVH_ERROR_TEXT_CLASS } from '@/utils/semanticColors';
import { getTypeSurfaceTint } from '@/utils/typeSurface';
import { WORKCASE_SURFACE_GEOMETRY_CLASS } from '@/components/WorkCaseCriteriaList';
import StatusBadge from '@/components/StatusBadge';
import SubGoalOrderBadge from '@/components/SubGoalOrderBadge';
import {
  SubGoalCriterionSurface,
  SubGoalServingWorkZone,
} from '@/components/SubGoalCardParts';
import ServingSparkProgressBar from '@/components/ServingSparkProgressBar';

/** 区头键盘可达的展开/收起（与聚焦页其它模块区头一致的交互）。 */
function toggleOnKeyboard(event: KeyboardEvent<HTMLDivElement>, toggle: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggle();
}

/** 聚焦页目标区的一条子目标（2026-11-03 改版）。 */
type SubGoalRowData = {
  id: string;
  text: string;
  status?: string;
  criterion?: string;
  object_uid?: string;
  order?: number;
  serving_work?: ServingWorkItem[];
  serving_unreadable?: string[];
  legacy?: boolean;
};

/**
 * 目标区里的**一条子目标**。
 *
 * ## 形态：复用子目标卡，除标题外默认收起
 *
 * 常显：次序 chip + 标题 + 状态 chip + 进度组（数字在上、条在下）+ 展开按钮。
 * 收起：判据面（`criterion`）与名下的工作（分类型的关联行）——点开即得。
 *
 * 进度组**收起态与展开态都在**：读者不展开时也要能看出这条走到哪一步了——否则
 * 收起态只剩一句标题，等于把「我走到哪一步了」这个本区的核心问题也一起收起
 * （`docs/02` §4.0：本区回答「这个项目要做什么？我走到哪一步了？」）。比值可数
 * （`9 / 30`），不给百分比：分数能按着名下的火花逐条核对，百分比不能。
 *
 * ## 为什么展开区就是子目标卡的那两块
 *
 * 判据面与名下工作区直接复用 `components/SubGoalCardParts`——它们与子目标列表
 * 卡读的是同一批字段，各写一份必分叉（分叉时没有机械判据说哪边才是对的）。
 *
 * 展开区**不给「达成条件」「对齐说明」两个小标题**（Human 2026-11-03 圈出后去掉）：
 * 判据面本身就带类型色，小标题是复述；对齐说明那一段（为何服务于目标陈述）不进
 * 本区——它是**理由**不是**判定**，留在子目标详情页读（28 §12.1 的核对点在详情页）。
 *
 * 展开区**不重复给进度**：比值常显在标题行上，同一条子目标不出现第二个比值
 * （`docs/10` §5.5「同类信息只有一处」）。两档明细仍在子目标卡与详情页可读。
 *
 * 进度组同样复用子目标卡的 `ServingSparkProgressBar`（行内形态），不在此处另写
 * 一份：比值的**口径**是单点派生（`utils/servingSparkProgress.ts`），连**呈现**也
 * 只应有一处。
 */
function SubGoalRow({ subGoal, onOpen }: { subGoal: SubGoalRowData; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);

  // legacy 行（旧段遗留、尚无对象）没有 object_uid，也就没有可反查的身份：
  // 给它画条等于把「还没有对象」说成「没有火花」（docs/02 §4.0）。
  const hasObject = Boolean(subGoal.object_uid);

  return (
    <li className="min-w-0 py-2">
      {/* 第一行：次序 chip + 标题 + 状态 + 进度组 + 展开按钮。
          标题是这一行的主要内容——按 docs/01 §1.5 约束 5，承载内容与可点阅读的
          文本至少 `ldvh-body`。

          **不整行换行**（`flex-wrap` 关掉）：整行换行会把进度组与展开按钮甩到标题
          下一行，四条子目标于是错成两种行高，扫读时「哪条走得远」对不上。改为
          **标题在自己的格子里换行**（`min-w-0 flex-1 break-words`），右边两格固定
          宽度不动——窗口再窄，窄掉的是标题，不是标尺。

          **行内的垂直基准是标题那一条线**（Human 2026-11-03 定案）：行内每一件
          东西——次序 chip、状态 chip、进度组的数字、展开按钮的文字——都落在标题
          的光心上。为此：
          - 数字的行盒与标题同高（`leading-6`）；此前 `leading-4` 使数字的光心
            比标题高 4px，两条基线错开；
          - chip 外裹 24px 盒子（`h-6`），使它 18px 的盒心落在标题线上；
          - 展开按钮内边距取 `py-0.5`，其 20px 内容盒居中后正落在标题线上。

          行仍取 `items-start`（不 `items-center`）：标题换行时，各项须对齐标题的
          **首行**，而不是整块居中到两行中间。 */}
      <div className="flex min-w-0 items-start gap-x-2 gap-y-1">
        {/* 次序 chip：外裹一枚 **24px 高**的盒子（`h-6`），使它自己的 18px 盒心
            落在标题那条线上。裸放时它 18px、顶对齐，比标题的光心高 3px——三枚小
            元素各偏一点，整行读起来就是「没对齐」（Human 2026-11-03）。 */}
        <span className="flex h-6 shrink-0 items-center">
          <SubGoalOrderBadge value={subGoal.order} />
        </span>
        {/* 标题可点下钻（28 号 §1 的 V1：从目标下钻到子目标）。整行**不**可点——
            行内还有展开按钮，整行可点会让「展开」与「进详情」抢同一个点击。 */}
        <button
          type="button"
          onClick={onOpen}
          disabled={!hasObject}
          className={`ldvh-body min-w-0 flex-1 break-words text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50 ${hasObject ? 'cursor-pointer hover:text-ldvh-accent' : 'cursor-default'}`}
        >
          {subGoal.text}
        </button>
        {/* 状态词经 `getObjectStatusLocale` 本地化，不渲染 raw 枚举；判据类型
            （`criterion_kind`）是判定口径，不上呈现面（Human 2026-11-02「只保留判法
            即可」）。 */}
        {subGoal.status && subGoal.status !== 'active' && (
          // 同样裹 24px 盒子：状态 chip 与次序 chip 落在标题的同一条线上。
          <span className="flex h-6 shrink-0 items-center">
            <StatusBadge
              status={subGoal.status}
              statusLabel={getObjectStatusLocale('subgoal', subGoal.status, locale)}
              objectType="subgoal"
              size="xs"
              variant="compact"
            />
          </span>
        )}
        {/* 迁移中的旧段行：显式标出，不与会话中的对象行混为一谈（25 §7 / 28 §14.2）。 */}
        {subGoal.legacy && (
          <span className="flex h-6 shrink-0 items-center">
            <span
              className="ldvh-chip-sm shrink-0 border-ldvh-border bg-transparent text-ldvh-text-secondary"
              title={t('goalDetail.subGoalLegacy')}
            >
              legacy
            </span>
          </span>
        )}
        {/* 进度组（**收起态与展开态都常显**）：**数字在上、条在下**——竖排只占一行
            宽，标题在自己的格子里换行，互不挤占。走的是子目标卡**同一个**组件
            （`ServingSparkProgressBar` 的行内形态），不另写一份呈现——两份并存必
            有一份失真（25 §7 同一纪律）。

            为什么常显（不随展开收起）：比值是这一行的**标题级数字**——读者扫目标区
            问的是「哪条走得远、哪条没动」。展开只该**增加**信息，不该让行的标题级
            数字在展开时从标题行跳进别的区块（那会让「行 ↔ 比值」的对应断掉）。

            三种「算不出」（未拆解／已处置／读不到）在此各有**短词 + 完整说明**
            ——空集是歧义不是进度 0（28 §8.1），读不到不等于没有（00 §5.6）。
            收起态若什么都不给，读者会把它读成「这条没有进度信息」，那也是一句假话。*/}
        {hasObject && (
          <div className="flex min-w-0 shrink-0 items-center">
            <ServingSparkProgressBar
              rows={subGoal.serving_work ?? []}
              unreadable={subGoal.serving_unreadable}
              progressLabel={t('objectList.subGoalSparkProgress')}
              emptyLabel={t('objectList.subGoalSparkProgressEmpty')}
              allDiscardedLabel={t('objectList.subGoalSparkProgressAllDiscarded')}
              unavailableLabel={t('objectList.subGoalSparkProgressUnavailable')}
              unknownStatusLabel={(count) => t('objectList.subGoalSparkProgressUnknown', { count: String(count) })}
              variant="inline"
              inlineLabels={{
                empty: t('focusV2.subGoalProgressEmpty'),
                allDiscarded: t('focusV2.subGoalProgressAllDiscarded'),
                unavailable: t('focusV2.subGoalProgressUnavailable'),
                emptyTitle: t('objectList.subGoalSparkProgressEmpty'),
                allDiscardedTitle: t('objectList.subGoalSparkProgressAllDiscarded'),
                unavailableTitle: t('objectList.subGoalSparkProgressUnavailable'),
              }}
            />
          </div>
        )}
        {/* 展开/收起按钮：与子目标卡内「展开其余 N 条」同一枚形态（`SubGoalDisclosureButton`），
            但这里的语义是「展开本行的判据与名下工作」。

            `py-0.5`：按钮内容盒（`ldvh-meta` 的 20px 行盒）居中后，光心正落在标题
            那条线上；`py-1` 时内容盒低 2px，按钮文字比标题低半行——同一行里两处文字
            错开半行，是最容易被眼睛抓住的那种不齐。按钮仍有 24px 高（≥ WCAG 2.2
            的 24×24 最小目标尺寸）。 */}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left ldvh-meta text-ldvh-text-secondary/85 transition-colors hover:bg-ldvh-border/25 hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
        >
          {expanded
            ? <ChevronUp size={12} aria-hidden="true" className="shrink-0" />
            : <ChevronDown size={12} aria-hidden="true" className="shrink-0" />}
          <span className="min-w-0 truncate">{t(expanded ? 'focusV2.subGoalCollapse' : 'focusV2.subGoalExpand')}</span>
        </button>
      </div>

      {/* 展开区：**判据面 + 名下的工作**（Human 2026-11-03 定案）——与子目标卡
          那两块同源、同形（`components/SubGoalCardParts`）：同一批字段、同一套判据
          面形态，各写一份必分叉。

          不给「达成条件」「对齐说明」小标题（圈出后去掉）：判据面自带类型色，小标题
          是复述；对齐说明是**理由**不是判定，留在子目标详情页读。

          不重复给进度：比值常显在标题行上，同一条子目标不出现第二个比值
          （`docs/10` §5.5）。故名下工作区以 `showProgress={false}` 调用。

          legacy 行没有对象，也没有可反查的身份：不给它画名下工作（那会把「还没有
          对象」说成「名下没有工作」）。 */}
      {expanded && (
        <div className="mt-2 flex min-w-0 flex-col gap-2 pl-0">
          {subGoal.criterion && (
            <SubGoalCriterionSurface criterion={subGoal.criterion} />
          )}
          {hasObject && (
            <SubGoalServingWorkZone
              rows={subGoal.serving_work ?? []}
              unreadable={subGoal.serving_unreadable}
              showProgress={false}
            />
          )}
        </div>
      )}
    </li>
  );
}

export default function GoalSection() {
  const { t } = useI18n();
  const navigate = useNavigate();
  // Sub-goals are SubGoal OBJECTS now (28), not lines in goal.md: the projection
  // carries identity (`object_uid`), lifecycle (`status`) and the criterion kind,
  // so the list can show where each sub-goal stands without a drill-down. Rows
  // still recovered from the migrated-away section are flagged `legacy` so they
  // never read as a second authority (28 §14.2).
  const [goal, setGoal] = useState<{
    title: string;
    status: string;
    statement: string;
    sub_goals: {
      id: string;
      text: string;
      status?: string;
      criterion_kind?: string;
      /**
       * 28 §8 `criterion`：「出现哪类材料即说明达成」——子目标唯一回答「怎么才算
       * 达成」的字段（`text` 只是短标题，不承载完整判据）。
       *
       * 此前后端投影不传这一字段，本区因此只答得出「有几条子目标、走没走」，答不出
       * 「这条要怎么才算达成」。2026-11-03 随目标区改版补上，与子目标卡读同一份
       * 权威文本。
       */
      criterion?: string;
      object_uid?: string;
      /** 28 §8：可选显示次序（缺失合法，不承担身份）。 */
      order?: number;
      /** 名下工作行（`serves` 反查，28 §8.1 派生）——本行的火花落实比值取它。 */
      serving_work?: ServingWorkItem[];
      /** 反查时读不到的类型；「读不到」不得并入空集（00 §5.6）。 */
      serving_unreadable?: string[];
      legacy?: boolean;
    }[];
  } | null>(null);
  const [goalMissing, setGoalMissing] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalExpanded, setGoalExpanded] = useState(true);
  const [copied, setCopied] = useState<'adjust' | 'create' | null>(null);

  async function handleCopy(text: string, kind: 'adjust' | 'create') {
    await copyText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500);
  }

  useEffect(() => {
    let cancelled = false;
    fetchCognitionGoal()
      .then((data) => {
        if (cancelled || !data.goal) return;
        setGoal(data.goal);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.code === 'goal_missing') setGoalMissing(true);
        else if (err instanceof ApiRequestError) setGoalError(err.message);
        else setGoalError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 目标陈述按本类型色（goal = emerald）上色。面与正文必须**成对**取用：
  // 只贴 `surface` 会让正文沿用中性近黑，色相面与正文分家（docs/01 §1.6、
  // `utils/typeSurface.ts` 头注）。几何仍取 WorkCase 判据面那一个常量——
  // 四边同宽 1px、rounded-lg、px-3 py-2，本区只接管色相。
  const statementTint = getTypeSurfaceTint('goal');

  return (
    <section className="mb-4 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      {/* 区头：与聚焦页其它四个模块**逐字同构**——裸图标 + 区块标题 + 计数 +
          右侧折叠按钮，一条行、无底托、无副标题（2026-11-03 改版）。

          **为什么撤掉底托与副标题**：目标区此前是唯一给区头图标加「h-7 w-7 底托」
          的模块，也是唯一写两行标题的模块；与「待决定事项 / 推进中事项 / 近期
          动态 / Spark 健康度」四块并排时，这一块自成一套规格。全站区头只有一种
          形态，独异即噪音——它们涨的是「这块比较特别」的错觉，而不是信息。

          **详情入口仍在标题上（2026-11-02 Human 定案不撤回）**：`/goal` 路由全仓
          只有这一处入口，撤掉 `Maximize2` 后必须由标题承担。区别在于：原先靠一行
          文字副标题（`focusV2.goalSectionHint`）说明「标题可点」，现在改由标题
          右侧一枚 12px 的进入箭头承担——它正是全站「进入详情」的既有符号
          （docs/01 §1.9：进入箭头默认弱灰、hover 切 accent），比一句「点标题看
          完整详情」更短，也不再往区头里塞第二段文字。 */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={goalExpanded}
        aria-controls="cognition-goal-content"
        onClick={() => setGoalExpanded((expanded) => !expanded)}
        onKeyDown={(event) => toggleOnKeyboard(event, () => setGoalExpanded((expanded) => !expanded))}
        className={`-mx-1 flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 transition-colors hover:bg-ldvh-bg/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50 ${goalExpanded ? 'mb-4' : ''}`}
      >
        <Target size={16} className="shrink-0 text-ldvh-accent" aria-hidden="true" />
        <h3 className="ldvh-section-title min-w-0">
          <span
            role="link"
            tabIndex={goal ? 0 : -1}
            onClick={(event) => {
              // 标题是详情入口；区头整行的点击是折叠，二者不同义——不让冒泡
              // 把「进详情」折叠成「收起」。
              event.stopPropagation();
              if (!goal) return;
              navigate('/goal');
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              if (!goal) return;
              navigate('/goal');
            }}
            className={`group/goal inline-flex min-w-0 items-center gap-1 rounded-sm transition-colors ${goal ? 'cursor-pointer hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50' : ''}`}
            title={goal ? t('goalDetail.openDetail') : undefined}
          >
            <span className="min-w-0 truncate">{t('focusV2.goalTitle')}</span>
            {/* 进入箭头：全站「这里有详情」的既有符号（docs/01 §1.9——默认弱灰、
                hover 切 accent）。默认 `w-0 opacity-0`（宽度也收掉，否则它即使
                透明仍占位，会在「目标」与计数之间留下一道空隙，读成
                「目标 › 4」这样的面包屑），hover/focus 时展开。
                对键盘用户，`:focus-visible` 同样会把它唤出来。 */}
            {goal && (
              <ChevronRight
                size={13}
                aria-hidden="true"
                className="w-0 shrink-0 text-ldvh-text-secondary/50 opacity-0 transition-all duration-150 group-hover/goal:w-3 group-hover/goal:text-ldvh-accent group-hover/goal:opacity-100 group-focus-visible/goal:w-3 group-focus-visible/goal:opacity-100"
              />
            )}
          </span>
        </h3>
        {goal && (
          <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{goal.sub_goals.length}</span>
        )}
        <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
          <button
            type="button"
            aria-expanded={goalExpanded}
            aria-controls="cognition-goal-content"
            onClick={(event) => {
              event.stopPropagation();
              setGoalExpanded((expanded) => !expanded);
            }}
            className="ldvh-icon-button"
            title={t(goalExpanded ? 'focusV2.collapseSection' : 'focusV2.expandSection')}
          >
            {goalExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            <span className="sr-only">{t(goalExpanded ? 'focusV2.collapseSection' : 'focusV2.expandSection')}</span>
          </button>
        </span>
      </div>

      {/* 目标内容 + 子目标列表：仅在展开时渲染（无标题，区块内直接是目标内容） */}
      {goalExpanded && (
        <div id="cognition-goal-content">
          {goalMissing && (
            // 还没有目标：给的是一个「粘上就能用」的触发器，故做成一枚可点的
            // 虚线面板（与 ProjectFiles / Diagnostics 的空态同一范式），而不是
            // 两句裸文字——裸文字看不出「这里能点」。
            <button
              type="button"
              onClick={() => void handleCopy(t('focusV2.promptSetGoal'), 'create')}
              className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-dashed border-ldvh-border bg-ldvh-bg/40 px-3 py-3 text-left transition-colors hover:border-ldvh-accent/50 hover:bg-ldvh-bg/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
              title={t('focusV2.promptSetGoal')}
            >
              <span className="ldvh-body-muted">{t('focusV2.hintCreateGoal')}</span>
              <span className="ldvh-caption text-ldvh-text-secondary/60">
                {copied === 'create' ? t('focusV2.btnCopied') : t('focusV2.hintCreateExample')}
              </span>
            </button>
          )}
          {goalError && <p className={`ldvh-body-muted ${LDVH_ERROR_TEXT_CLASS}`}>{goalError}</p>}
          {goal?.statement && (
            <div className={WORKCASE_SURFACE_GEOMETRY_CLASS} style={statementTint.surface}>
              <p className="ldvh-body min-w-0 break-words" style={statementTint.body}>
                {goal.statement}
              </p>
            </div>
          )}

          {goal && goal.sub_goals.length > 0 && (
            // 子目标行：复用**子目标卡**的呈现语言（卡头件 + 标题托盘 + 判据面 +
            // 名下工作区），但除标题外**默认收起**（Human 定案 2026-11-03）。
            //
            // ## 为什么复用卡样式而不是各写一套
            //
            // 聚焦页目标区与子目标列表卡读的是**同一批字段**（标题、判据、对齐、
            // 名下工作）。若各写一份，「判据长什么样」「空集歧义怎么提示」这些
            // 呈现决定就会分叉——而分叉时没有机械判据说哪边才是对的。这与 25 §7
            // 「目标只有一条陈述」同一纪律：两份并存必有一份失真。
            //
            // 故判据面与名下工作区下沉到 `components/SubGoalCardParts`，两处同源调用。
            //
            // ## 为什么默认收起
            //
            // 聚焦页一屏要并列回答五件事（目标、待决、推进中、动态、火花健康）。
            // 目标区若把四条子目标的判据与名下工作全展开，它就是整页最重的一块，
            // 把「待决定事项」这类**需要立即行动**的模块压到下面——而聚焦页的首要
            // 职责是让人知道「现在该动什么」，不是「长期意图的完整档案」。
            //
            // 收起不等于删：判据与名下工作一行不少地在那里，点开即得。子目标的完整
            // 档案仍在 `/objects/subgoal/<uid>` 详情页，聚焦页这条展开只是省一次跳转。
            <ul className="mt-3 min-w-0 divide-y divide-ldvh-border/70">
              {goal.sub_goals.map((sg) => (
                <SubGoalRow
                  key={sg.id}
                  subGoal={sg}
                  onOpen={() => navigate(`/objects/subgoal/subgoal-${sg.object_uid}`)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
