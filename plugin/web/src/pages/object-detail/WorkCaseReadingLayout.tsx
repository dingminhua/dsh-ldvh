import { useState } from 'react';
import { useI18n } from '@/i18n/context';
import { getFieldLabel } from '@/i18n/locales';
import { type WorkCaseDetailData } from '@/utils/api';
import {
  WorkCaseCriteriaList,
  WORKCASE_ATTEMPT_SURFACE_CLASS,
  WORKCASE_CRITERIA_SURFACE_CLASS,
  WORKCASE_GATE1_SURFACE_CLASS,
  WORKCASE_RESULT_SURFACE_CLASS,
  WORKCASE_RESIDUAL_SURFACE_CLASS,
} from '@/components/WorkCaseCriteriaList';
import {
  WORKCASE_ITEM_ROW_CLASS,
  workCaseCheckChipClass,
  workCaseCheckStateLabel,
} from '@/utils/workcaseCheckState';
import {
  ChangeLogReadingNode,
  FieldProblem,
} from '@/pages/object-detail/FactReadingLayouts';
import { FactAssociationsSection } from '@/pages/object-detail/FactAssociationsSection';
import { StructuredTextProblems } from '@/pages/object-detail/FactReadingLayouts';
import {
  DetailInlineField,
  ReadingNodeSection,
  ResearchTextNodeContent,
  getReadingNodeNextState,
  type ReadingNodeState,
} from '@/pages/ObjectDetail';
import { fieldIssue } from '@/pages/object-detail/fieldIssues';
import type { LocaleKey } from '@/i18n/locales';
import { parseReviewSummary } from '@/shared/workcaseReviewSummary';
import type { StructuredTextIssue } from '@/shared/workcaseTextStructure';
import { h2SectionOf } from '@/shared/workcaseResultDraft';
import type { WorkCaseV5Group, WorkCaseV5Outcome } from '@/shared/workcaseLifecycle';

type LayoutT = ReturnType<typeof useI18n>['t'];

interface WorkCaseReadingLayoutProps {
  obj: WorkCaseDetailData;
  locale: string;
}

const OUTCOME_LABEL_KEY: Record<WorkCaseV5Outcome, Parameters<LayoutT>[0]> = {
  completed: 'objectDetail.workcaseOutcome.completed',
  partial: 'objectDetail.workcaseOutcome.partial',
  'not-achieved': 'objectDetail.workcaseOutcome.notAchieved',
  cancelled: 'objectDetail.workcaseOutcome.cancelled',
};

/** 21 号三态直读详情阅读面（v5）。外壳与正文段沿用其余六类阅读布局的既有
 * 承载（10 §5.3 语义详情、10 §12.7 长文须有折叠入口）：根容器
 * `mb-6 flex flex-col gap-5`、正文段 ReadingNodeSection、字段 DetailInlineField。
 *
 * 不在此渲染对象身份块：类型/状态/标题/时间/复制入口由 `ObjectIdentityHeader`
 * 统一承载（docs/01 §1.8.1 身份头部契约），详情页与右侧扩展阅读共用同一份。
 * 此前本布局自渲染了一个 group chip + 裸 `status:` + 复制按钮的重复身份行，
 * 与上游身份头部形成两套头部（缺陷 D9）。 */
export default function WorkCaseReadingLayout({ obj, locale }: WorkCaseReadingLayoutProps) {
  const { t } = useI18n();
  const group = (typeof obj.group === 'string' ? obj.group : obj.current_snapshot_projection?.group) as WorkCaseV5Group | undefined;

  return (
    <div className="mb-6 flex flex-col gap-5">
      {/* 进展分组是呈现派生值（specs/10 §5.5），由身份头部徽标承载（
          ObjectDetail 的 getObjectHeaderStatus 已把 group 传给它）。此处只在
          派生不可判定时披露缺口——不回退、不伪造分组。 */}
      {!group && (
        <p className="ldvh-body-muted rounded-md border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-red-400">
          {t('objectList.workcaseProgressGroupUnavailable')}
        </p>
      )}

      <WorkCaseBody obj={obj} locale={locale} />

      <FactAssociationsSection obj={obj} locale={locale} />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}

/**
 * `gist` 阅读节点（21 §8）：与 `ProseNode` **不同款**——`gist` 按 21 §8 是纯文本
 * （「≤200 字符、纯文本、无正文承载」），故**不**经 Markdown 渲染。
 *
 * 若走 `ResearchTextNodeContent`，`gist` 里的字面 `*`、`_`、`` ` ``、`#` 会被
 * 当作标记解析，把 Human 想读的字面文本吃掉或变形——而 21 §8 恰恰禁止在 `gist`
 * 中放 Markdown。用纯文本渲染使「字段契约」与「呈现形态」一致：写进去什么样，
 * 读出来什么样。
 *
 * **内容壳与 `ProseNode` 同款**（`ldvh-research-node-content`）：本详情页各字段节点
 * 的内容区统一套一层细边框 + 浅底的轻量面板（摘要/授权范围经 `ResearchTextNodeContent`、
 * 计划/结果判据/残留经 `WORKCASE_CRITERIA_SURFACE_CLASS`）。此前本节点直接输出裸
 * `<p>`，使「要点」的文字贴到卡片边缘、与相邻节点的内容区层级不一致——标题形态相同
 * 而内容表面不同，读起来像两种不同的节点。差异只在是否**经 Markdown 渲染**，
 * 不在内容表面；故此处补壳，并保持纯文本渲染不变。
 */
function GistNode({
  title,
  value,
  locale,
  issue,
}: {
  title: string;
  value: string;
  locale: string;
  issue?: ReturnType<typeof fieldIssue>;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  if (!value && !issue) return null;

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? (
        <FieldProblem issue={issue} />
      ) : (
        <div className="ldvh-research-node-content min-w-0">
          <p className="ldvh-detail-semantic-body min-w-0 break-words">{value}</p>
        </div>
      )}
    </ReadingNodeSection>
  );
}

/** 正文段统一走 ReadingNodeSection——与其余六类阅读布局同款可折叠节点。
 *
 * 正文一律经 `ResearchTextNodeContent`（Markdown 渲染，14px 阅读基准）：六类
 * 样板（ADR/Pitfall/Spark/Research/Friction/Norm）的正文节点全部用它。此前
 * 本布局在非 markdown 分支退回 `ldvh-card-decision-body`（12px 卡片扫描层级），
 * 违反 docs/01 §1.4 第 4 条「卡片判断项正文只用于 Card 的有限行数扫描窗口；
 * 详情页和阅读面板仍使用各自正文层级，不得随之缩小」（缺陷 D10）。 */
function ProseNode({
  title,
  value,
  locale,
  issue,
  field,
  structuredIssues,
}: {
  title: string;
  value: string;
  locale: string;
  issue?: ReturnType<typeof fieldIssue>;
  /** 该节点的字段名：给出时，就地显示它的**书写结构**问题（`21 §8`）。 */
  field?: 'scope' | 'summary';
  /** 全部结构问题（由 `WorkCaseBody` 统一算出后传入；本组件只筛自己那一份）。 */
  structuredIssues?: StructuredTextIssue[];
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  if (!value && !issue) return null;

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? <FieldProblem issue={issue} /> : <ResearchTextNodeContent value={value} />}
      {field ? <StructuredTextProblems issues={structuredIssues} field={field} /> : null}
    </ReadingNodeSection>
  );
}

/** plan 步骤：每步「步骤」+ 可验证的「完成判据」成对呈现，不复用列表卡的
 * 单行信息密度（10 §5.3 语义详情要求完整呈现字段）。 */
function PlanNode({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const plan = Array.isArray(obj.plan) ? obj.plan : [];
  if (plan.length === 0) return null;

  return (
    <ReadingNodeSection
      title={t('objectDetail.workcasePlan')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <div className={WORKCASE_CRITERIA_SURFACE_CLASS}>
        <ol className="grid min-w-0 gap-3">
          {plan.map((step, index) => (
            <li key={index} className="min-w-0">
              {/* 步骤标题取 `ldvh-body`（14px/24px，`docs/01 §1.4` 正文档）——
                  此前用 `ldvh-caption-strong`（12px/500），与下方的判据正文**同字号**，
                  读者分不清哪个是步骤、哪个是判据（Human 2026-09-24：「计划与判据的
                  表现再修改一下」）。步骤是这一条的主对象，应高于其判据。 */}
              <div className="ldvh-body min-w-0 break-words font-medium text-ldvh-text-primary">
                {`${index + 1}. ${step.step ?? ''}`}
              </div>
              {step.done_criteria ? (
                /* 判据标签**内联**到正文行首，不再独占一行（原经 `DetailInlineField`
                   渲染为「标签行 + 正文行」两行，而标签每步都相同——重复信息占据与正文
                   同等的视觉权重）。内联后形态为「完成判据：<正文>」，与仓内其它判据
                   呈现（`done criteria` 的语义即「这一条怎么算完成」）一致。 */
                <div className="ldvh-caption mt-1 min-w-0 break-words">
                  <span className="ldvh-caption-strong text-ldvh-text-secondary">
                    {`${getFieldLabel('done_criteria', locale)}：`}
                  </span>
                  {step.done_criteria}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </ReadingNodeSection>
  );
}

/** result.criteria_checks：satisfied 是布尔（21 §8），按可读文本 + 可区分形态
 * 呈现——10 §12.8 禁止用颜色或图标单独承载状态，故必须带文字判读。
 * 三态映射与列表卡/收件箱共用 `workCaseCheckState*`（单一实现，防口径漂移）。 */
function ResultChecksNode({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const checks = obj.result?.criteria_checks;
  // 判据文本须由 `plan[i].step` 给出（见下方注释），故本节点也读 `plan`。
  const plan = Array.isArray(obj.plan) ? obj.plan : [];
  if (!Array.isArray(checks) || checks.length === 0) return null;

  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseResultChecks')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {/* 判据文本取自 `plan[i].step` 并与之**按下标配对**（Human 2026-09-24）。
       *
       * 依据：`21 §8` 的 `result.criteria_checks[]` 只有 `{satisfied, evidence}`，
       * **不含判据文本**——故「这条对应哪一步」只能由 `plan[i].step` 给出。实测本例
       * `plan` 4 步与 `checks` 4 条一一对应。
       * 此前本节点只显示「[状态] + 证据」，258 字的证据悬空，读者不知它核的是哪一条。
       * 列表卡早已按此法配对（`WorkCaseClosedSummary`），详情面此前未跟上。 */}
      <div className={WORKCASE_RESULT_SURFACE_CLASS}>
      <ul className="grid min-w-0 gap-3">
        {checks.map((check, index) => {
          const stepTitle = typeof plan[index]?.step === 'string' ? plan[index].step : '';
          return (
            <li key={index} className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={`ldvh-chip-sm w-fit ${workCaseCheckChipClass(check.satisfied)}`}>
                  {workCaseCheckStateLabel(check.satisfied, t)}
                </span>
                {stepTitle ? (
                  <span className="ldvh-body min-w-0 break-words font-medium text-ldvh-text-primary">
                    {stepTitle}
                  </span>
                ) : null}
              </div>
              {check.evidence ? (
                <p className="ldvh-caption mt-1 min-w-0 break-words">{check.evidence}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      </div>
    </ReadingNodeSection>
  );
}

/** result.residual 是数组（21 §8 §9.3），按列表呈现而非段落。 */
function ResidualNode({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const residual = Array.isArray(obj.result?.residual) ? obj.result.residual : [];
  if (residual.length === 0) return null;

  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseResidual')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {/* 琥珀承载面（Human 裁定 2026-09-24 试点；`docs/04:82`「关闭提案使用琥珀色
          提案色调」）。此前本节点与「计划与判据」共用同一个**蓝**面——两块语义完全不
          同（残留＝还剩什么，待处置；判据＝成功标准，预期），底色却一致，读者无法靠
          视觉区分。`docs/04:80` 要求语义块「共同服从其背景色系」，残留属「等待/建议」
          （琥珀）一族，不属「标准与预期」（蓝）。
          面与正文色成对换：`tone="residual"` 使圆点与正文同为琥珀系，避免「琥珀底 + 蓝字」。 */}
      <div className={WORKCASE_RESIDUAL_SURFACE_CLASS}>
        <WorkCaseCriteriaList
          tone="residual"
          items={residual.map((item, index) => ({ key: String(index), statement: String(item ?? '') }))}
        />
      </div>
    </ReadingNodeSection>
  );
}

/** 21 §8：复核节点概要流水。呈现归 10 §5.3「变更历史（摘要形态）」——
 * 复核详情不入对象，故此处只列节点概要（时间、署名、结论）。 */
function ReviewsNode({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const entries = Array.isArray(obj.reviews) ? obj.reviews : [];
  if (entries.length === 0) return null;

  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseReviews')}
      state={state}
      locale={locale}
      headerMeta={<span className="ldvh-meta-muted">{entries.length}</span>}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {/* 补 `ldvh-research-node-content` 壳（2026-09-24 修）。
       *
       * 此前本节点**无壳**，故 `ldvh-detail-semantic-body`（下方 `entry.summary` 所用）
       * 落到全局限定 13px/22px，而**同一页**其它节点的同类落到壳内限定 14px/24px ——
       * **同一个类在同一页给两个字号**，这是 Human 观察到「字体大大小小」最直接的来源。
       * 补壳后与 `ProseNode` / `BodySectionNode` 同基准（`docs/01 §1.4` 第 9 条：
       * Markdown 阅读区正文基准 14px）。 */}
      <div className="ldvh-research-node-content divide-y divide-ldvh-border/60">
        {entries.map((entry, index) => (
          <div key={index} className="py-2.5 first:pt-0 last:pb-0">
            <div className="ldvh-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium text-ldvh-text-primary/80">
              <span aria-hidden="true" className="h-1 w-1 shrink-0 self-center rounded-full bg-ldvh-text-primary/55" />
              {entry.at ? <span className="tabular-nums">{entry.at}</span> : null}
              {entry.provider ? <><span aria-hidden="true">·</span><span>{entry.provider}</span></> : null}
              {entry.model ? <><span aria-hidden="true">·</span><span>{entry.model}</span></> : null}
            </div>
            {entry.summary ? (
              /* 按七要素分块（Human 2026-09-24：「复核记录需要格式化，当前无法阅读」）。
               *
               * 依据 `21 §8`：`reviews[].summary` 是「**结构化概要**，至少含 `02 §15`
               * 判据**七要素**（对象／基线／方法／覆盖／未覆盖／发现／保证边界）」。
               * 数据本身按该七项书写，但此前**整段输出** —— 实测 12 条中 11 条超过
               * 400 字（中位 519、最长 596），七项被埋在一段话里，读者无法定位任何一项。
               *
               * 解析不出的记录（要素不全或写法不符）**原样整段呈现**，不假装已结构化——
               * 降级是如实的，读者仍能读到全文。 */
              <ReviewSummaryBody summary={entry.summary} />
            ) : null}
          </div>
        ))}
      </div>
    </ReadingNodeSection>
  );
}

/**
 * 已证实范围（`21 §8`：`result.achieved_scope`）。
 *
 * 语义属 `docs/04:80` 的「**绿色结果**」一族，故包绿面（同族的「残留责任」按
 * `docs/04:82` 另用琥珀）。此前经中性 `ProseNode` 渲染——与同族的判据核对、残留
 * 在视觉上互不相关（Human 2026-09-24：「已证实范围 都要处理一下」）。
 *
 * 正文色随面走：`docs/04:80` 要求「标题、正文与弱元信息共同服从其背景色系，
 * 不得回退成通用近黑色」。
 */
function AchievedScopeNode({ value, locale }: { value: string; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseAchievedScope')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <div className={`${WORKCASE_RESULT_SURFACE_CLASS} ldvh-body text-emerald-900/85 dark:text-emerald-100/85`}>
        <div className="ldvh-inline-markdown min-w-0 break-words">
          <ResearchTextNodeContent value={value} />
        </div>
      </div>
    </ReadingNodeSection>
  );
}

/**
 * 一条复核记录的 `summary`（`21 §8` 引 `02 §15` 七要素）。
 *
 * 按七要素拆成分块：**要素名（弱信息，`ldvh-meta-muted`）+ 内容**，各项之间用与
 * 仓内条目行一致的细分割线分隔（`WORKCASE_ITEM_ROW_CLASS`，四块共用同一串类名）。
 *
 * 降级规则（如实，不假装）：要素少于 2 项时**整段呈现**——那说明该记录的写法不在
 * 七要素约定内，强行分块会切出无意义的碎片；此时读者仍能读到全文。
 */
function ReviewSummaryBody({ summary }: { summary: string }) {
  const { t } = useI18n();
  const parsed = parseReviewSummary(summary);

  if (parsed.items.length < 2) {
    return <p className="ldvh-detail-semantic-body mt-1 min-w-0 break-words">{summary}</p>;
  }

  return (
    <div className="mt-1 min-w-0">
      {parsed.items.map((item, index) => (
        <div key={`${item.key}-${index}`} className={WORKCASE_ITEM_ROW_CLASS}>
          <span className="ldvh-meta-muted mr-1.5 shrink-0">
            {t(`objectDetail.reviewElement.${item.key}` as LocaleKey)}
          </span>
          <span className="ldvh-detail-semantic-body min-w-0 break-words">
            {item.value || t('objectDetail.reviewElementEmpty')}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 对象身份与授权范围的正文段（21 §8：`gist` / `summary` / `scope`）。
 *
 * 四个生命周期主体**共用**它。10 §4.2 与 01 §1.10 的同一条纪律：
 * 「条件字段可以随事实是否形成而省略，但已存在字段不能因对象处于某个进展分组
 * 而消失」。此前只有 DraftBody 渲染这些字段，closed 详情因此看不到对象实际
 * 携带的 summary/scope（缺陷 D11）——分组只应改变**强调**，不应改变
 * **在场字段集**。
 *
 * `serves` 不在本段：它是身份类锚点，由详情头的 ServesSgBadge 承载
 * （标签序 Human 定案 2026-09-13：类型 → 优先级 → SG → 修改次数），四个派生
 * 主体共用同一详情头，故「不因分组消失」对它同样成立。正文不再重复呈现同一
 * 信息。详见段内注释。
 *
 * 10 §5.5 的字段分工在此落位：`gist` 与 `summary` **都**出现在详情，但形态不同——
 * `gist` 是 21 §8 定义的**纯文本**要点（≤200 字符、无 Markdown 标记），故按纯文本
 * 渲染；`summary` 是完整快照（可含 Markdown），故经 `ProseNode` 作 Markdown 节点。
 * 二者不可合并：合并会让 Human 无法判断自己读的是扫读要点还是执行者快照。
 */
function ResponsibilityNodes({
  obj,
  locale,
  structuredIssues,
}: {
  obj: WorkCaseDetailData;
  locale: string;
  structuredIssues?: StructuredTextIssue[];
}) {
  const { t } = useI18n();
  return (
    <>
      {/* 不在调用点用 `typeof obj.gist === 'string'` 把门——那会在 `gist` 类型不符
         时把节点连同 `fieldIssue` 一起吞掉，正是 D11 那类「字段有问题却看不到」
          的形态。改为恒调用，由 GistNode 内部按「有值或有 issue」决定是否渲染，
          与下方 serves/scope 同款。 */}
      <GistNode
        title={getFieldLabel('gist', locale)}
        value={typeof obj.gist === 'string' ? obj.gist : ''}
        locale={locale}
        issue={fieldIssue(obj, 'gist')}
      />
      {obj.summary ? (
        <ProseNode
          title={getFieldLabel('summary', locale)}
          value={typeof obj.summary === 'string' ? obj.summary : ''}
          locale={locale}
          issue={fieldIssue(obj, 'summary')}
          field="summary"
          structuredIssues={structuredIssues}
        />
      ) : null}
      {/* `serves` 不在正文重复呈现：它在详情头已由 ServesSgBadge 呈现
          （ObjectDetail.tsx 的标签序：类型 → 优先级 → SG → 修改次数，Human
          定案 2026-09-13），正文再列一次是同一信息的第二处出现。标题栏承载
          身份类锚点、正文承载内容类字段，分工不重叠。

          这**不削弱** 10 §4.2「已存在字段不能因分组而消失」：`serves` 是
          身份锚点，四个派生主体共用同一个详情头，故四个分组下它都在场；
          本轮改的只是「在场于何处」，不是「是否在场」。

          字段异常的可见性也不受影响：`serves` 形状不符时由详情页的
          FieldIssuesSection（10 §5.3 的来源回指面）按 path 报告，该面板
          独立于本节点；此前正文节点的 fieldIssue 是同一问题的第二处出口。 */}
      <ProseNode
        title={t('objectDetail.workcaseScope')}
        value={typeof obj.scope === 'string' ? obj.scope : ''}
        locale={locale}
        issue={fieldIssue(obj, 'scope')}
        field="scope"
        structuredIssues={structuredIssues}
      />
    </>
  );
}

/**
 * 详情正文：**单一固定序列**，不按进展分组切换（`docs/01 §1.10` 内容结构第 2 条：
 * 「只按字段是否实际存在省略节点，**不按状态或 Card 分组切换结构**」）。
 *
 * **本节是回归规范，不是重新设计。** 此前是 `DraftBody` / `ExecutingBody` /
 * `AwaitingGate2Body` / `ClosedBody` **四套各拼一份节点序列**，与上述规范条直接冲突；
 * 后果是同一字段在不同阶段出现在不同位置、甚至缺席（如 `gate_1` 只在 closed 组出现，
 * 而 21 §8 规定它「批准后必填」——open 期本就有值却看不到）。
 *
 * **节点集严格由 21 §8 字段表推导**（Human 裁定 2026-09-24：无字段则无节点）：
 * 当前情况（summary · status）→ 目标（gist）→ 授权范围（scope）→ 计划与工作项（plan[]）
 * → 执行批准（gate_1）→ 执行中（attempt）→ 复核（reviews[]）→ 结果与验证
 * （result.criteria_checks · result.achieved_scope）→ 残留（result.residual[]）
 * → 终态判定（outcome）→ 关联（relations[]）→ 变更流水（change_log[]）。
 *
 * **刻意不设的节点（规范 01/04 曾列出，但 21 §8 无字段承载）**：
 * 「成功标准」（21 §8 无此字段，最接近的是 `plan[].done_criteria`，那是计划节点的内容）、
 * 「主控自检」（无字段）、「外部网址」（21 §8 第 128/313/456 行**明文不设 `urls`**）。
 * 规范 01/04 与 21 号在此冲突，依 Human 裁定以 21 号为准——**缺字段不空留位**，
 * 那会让读者以为「本应有而没有」。
 *
 * **复核不分「方案复核 / 结果复核」**：21 §8 只有一个 `reviews[]`，无阶段区分字段，
 * 故只设一个「复核」节点；按阶段拆成两个节点会凭空制造 21 号没有的语义。
 */
function WorkCaseBody({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const result = obj.result;
  // `scope` / `summary` 的**书写结构**问题（`21 §8`）。写入口早已算出这些违规，但结果
  // 到不了呈现面——读者只看到「读不了」而看不到原因（Human 2026-09-24）。
  // 服务端已按同一套规则投影为 `structured_text_issues`（见 `shared/workcaseTextStructure`）。
  const structuredIssues = Array.isArray(obj.structured_text_issues)
    ? (obj.structured_text_issues as StructuredTextIssue[])
    : [];
  const hasResult =
    (Array.isArray(result?.criteria_checks) && result.criteria_checks.length > 0) ||
    (typeof result?.achieved_scope === 'string' && result.achieved_scope.length > 0) ||
    (Array.isArray(result?.residual) && result.residual.length > 0);

  return (
    <>
      {/* 1 当前情况 / 2 目标 / 3 授权范围 */}
      <ResponsibilityNodes obj={obj} locale={locale} structuredIssues={structuredIssues} />

      {/* 4 计划与工作项 */}
      <PlanNode obj={obj} locale={locale} />

      {/* 4' 正文「## 执行」节 —— 该节**无 frontmatter 字段承载**（21 §8 的正文 H2
          闭集里，摘要/授权范围/计划三节与字段节点内容重复故不另设，而「执行」与
          「结果」两节只能从正文读）。`docs/01 §1.10` 内容结构第 5 条要求正文完整
          渲染、不截断；Human 2026-09-24：「详情页面需要有统一的设计语言」。 */}
      <BodySectionNode obj={obj} locale={locale} heading="执行" />

      {/* 5 执行批准 —— 按字段有无渲染，不按分组。此前只在 closed 组出现，
          而 21 §8 规定「批准后必填」，故 open 期本就有值却被藏起来。 */}
      {obj.gate_1 ? <Gate1Node obj={obj} locale={locale} /> : null}

      {/* 6 执行中 —— 同上：`attempt` 出现 ⇔ status = open，按字段有无渲染。 */}
      <AttemptNode obj={obj} locale={locale} />

      {/* 7 复核 —— 21 §8 只有一个 reviews[]，不分方案/结果两级 */}
      <ReviewsNode obj={obj} locale={locale} />

      {/* 7' 正文「## 结果」节 —— 与下方字段节点**并存不重复**：字段是结构化结论
          （逐条核对 / 已证实范围 / 残留责任），正文是该结论的叙述形态；两者是同一
          事实的两种承载，`21 §8` 要求它们同时存在（载体内聚）。 */}
      <BodySectionNode obj={obj} locale={locale} heading="结果" />

      {/* 8 结果与验证 / 9 残留 —— 同一字段组的两部分，按字段有无渲染。 */}
      {hasResult ? (
        <>
          <ResultChecksNode obj={obj} locale={locale} />
          {typeof result?.achieved_scope === 'string' && result.achieved_scope.trim().length > 0 ? (
            <AchievedScopeNode value={result.achieved_scope} locale={locale} />
          ) : null}
          <ResidualNode obj={obj} locale={locale} />
        </>
      ) : null}

      {/* 10 终态判定 */}
      <OutcomeNode obj={obj} locale={locale} />
    </>
  );
}

/**
 * 正文某个 H2 节的原文（`21 §8` 正文 H2 闭集：摘要 / 授权范围 / 计划 / 执行 / 结果）。
 *
 * 只用于**没有字段承载**的两节（执行 / 结果）：摘要、授权范围、计划分别由
 * `summary` / `scope` / `plan` 的字段节点呈现，而 `21 §8` 要求字段值在正文逐字
 * 出现（载体内聚），故再设正文节点只会重复同一内容。
 *
 * 节缺失时整节点不渲染（`docs/01 §1.10`：只按字段/内容实际存在省略节点）。
 */
function BodySectionNode({
  obj,
  locale,
  heading,
}: {
  obj: WorkCaseDetailData;
  locale: string;
  heading: '执行' | '结果';
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const value = h2SectionOf(obj.report_body, heading);
  if (value.length === 0) return null;
  const titleKey =
    heading === '执行' ? 'objectDetail.workcaseBodyExecutionSection' : 'objectDetail.workcaseBodyResultSection';
  return (
    <ReadingNodeSection
      title={t(titleKey)}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <ResearchTextNodeContent value={value} />
    </ReadingNodeSection>
  );
}

/** 执行中（`attempt`，21 §8：执行期必填 `{attempt_id, started_at, controller, heartbeat_at}`）。 */
function AttemptNode({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const attempt = obj.attempt;
  if (!attempt) return null;
  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseAttempt')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {/* 青色承载面（`docs/04:80`「青色工作与主控」）。同 Gate 1：此前无面、「太素」。 */}
      <div className={WORKCASE_ATTEMPT_SURFACE_CLASS}>
        <div className="divide-y divide-ldvh-border/60">
          {attempt.controller ? (
            <DetailInlineField
              label={t('objectDetail.workcaseAttemptController')}
              value={<span className="text-cyan-900/85 dark:text-cyan-100/85">{attempt.controller}</span>}
            />
          ) : null}
          {attempt.attempt_id != null ? (
            <DetailInlineField
              label={t('objectDetail.workcaseAttemptId')}
              value={<span className="ldvh-meta text-cyan-900/85 dark:text-cyan-100/85">{String(attempt.attempt_id)}</span>}
            />
          ) : null}
          {attempt.started_at ? (
            <DetailInlineField
              label={t('objectDetail.workcaseAttemptStartedAt')}
              value={<span className="ldvh-meta text-cyan-900/85 dark:text-cyan-100/85">{attempt.started_at}</span>}
            />
          ) : null}
          {attempt.heartbeat_at ? (
            <DetailInlineField
              label={t('objectDetail.workcaseAttemptHeartbeat')}
              value={<span className="ldvh-meta text-cyan-900/85 dark:text-cyan-100/85">{attempt.heartbeat_at}</span>}
            />
          ) : null}
        </div>
      </div>
    </ReadingNodeSection>
  );
}

/** 终态判定（`outcome`，21 §8：`closed` 时必填，闭集四值）。按字段有无渲染。 */
function OutcomeNode({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const outcome = obj.outcome;
  if (!outcome) return null;
  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseOutcome')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <span className="ldvh-chip inline-flex items-center rounded-md border border-ldvh-border bg-ldvh-bg px-2 py-0.5 text-ldvh-text-primary">
        {t(OUTCOME_LABEL_KEY[outcome])}
      </span>
    </ReadingNodeSection>
  );
}

function Gate1Node({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const gate1 = obj.gate_1;
  if (!gate1) return null;

  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseGate1')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {/* 紫色承载面（`docs/04:80`「紫色目标与批准」）。此前本节点是**全页唯一无面**
          的块之一——裸 `divide-y` 键值对，Human 2026-09-24 指出「太素」。 */}
      <div className={WORKCASE_GATE1_SURFACE_CLASS}>
        <div className="divide-y divide-ldvh-border/60">
          {gate1.approver ? (
            <DetailInlineField
              label={t('objectDetail.workcaseGate1Approver')}
              value={<span className="text-violet-800/85 dark:text-violet-200/85">{gate1.approver}</span>}
            />
          ) : null}
          {gate1.approved_at ? (
            <DetailInlineField
              label={t('objectDetail.workcaseGate1ApprovedAt')}
              value={<span className="ldvh-meta text-violet-800/85 dark:text-violet-200/85">{gate1.approved_at}</span>}
            />
          ) : null}
        </div>
      </div>
    </ReadingNodeSection>
  );
}
