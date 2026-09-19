import { useState } from 'react';
import { useI18n } from '@/i18n/context';
import { getFieldLabel } from '@/i18n/locales';
import { type WorkCaseDetailData } from '@/utils/api';
import { WorkCaseCriteriaList, WORKCASE_CRITERIA_SURFACE_CLASS } from '@/components/WorkCaseCriteriaList';
import { workCaseCheckChipClass, workCaseCheckStateLabel } from '@/utils/workcaseCheckState';
import {
  ChangeLogReadingNode,
  FieldProblem,
} from '@/pages/object-detail/FactReadingLayouts';
import { FactAssociationsSection } from '@/pages/object-detail/FactAssociationsSection';
import {
  DetailInlineField,
  ReadingNodeSection,
  ResearchTextNodeContent,
  getReadingNodeNextState,
  type ReadingNodeState,
} from '@/pages/ObjectDetail';
import { fieldIssue } from '@/pages/object-detail/fieldIssues';
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

      {group === 'pending_gate1' && <DraftBody obj={obj} locale={locale} />}
      {group === 'executing' && <ExecutingBody obj={obj} locale={locale} />}
      {group === 'awaiting_gate2' && <AwaitingGate2Body obj={obj} locale={locale} />}
      {group === 'closed' && <ClosedBody obj={obj} locale={locale} />}

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
        <p className="ldvh-detail-semantic-body min-w-0 break-words">{value}</p>
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
      {issue ? <FieldProblem issue={issue} /> : <ResearchTextNodeContent value={value} />}
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
              <div className="ldvh-caption-strong break-words">
                {`${index + 1}. ${step.step ?? ''}`}
              </div>
              {step.done_criteria ? (
                <div className="mt-1 min-w-0">
                  <DetailInlineField
                    label={getFieldLabel('done_criteria', locale)}
                    value={<span className="ldvh-caption min-w-0 break-words">{step.done_criteria}</span>}
                  />
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
  if (!Array.isArray(checks) || checks.length === 0) return null;

  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseResultChecks')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <ul className="grid min-w-0 gap-3">
        {checks.map((check, index) => (
          <li key={index} className="min-w-0">
            <span className={`ldvh-chip-sm w-fit ${workCaseCheckChipClass(check.satisfied)}`}>
              {workCaseCheckStateLabel(check.satisfied, t)}
            </span>
            {check.evidence ? (
              <p className="ldvh-caption mt-1 min-w-0 break-words">{check.evidence}</p>
            ) : null}
          </li>
        ))}
      </ul>
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
      <div className={WORKCASE_CRITERIA_SURFACE_CLASS}>
        <WorkCaseCriteriaList
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
      <div className="divide-y divide-ldvh-border/60">
        {entries.map((entry, index) => (
          <div key={index} className="py-2.5 first:pt-0 last:pb-0">
            <div className="ldvh-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium text-ldvh-text-primary/80">
              <span aria-hidden="true" className="h-1 w-1 shrink-0 self-center rounded-full bg-ldvh-text-primary/55" />
              {entry.at ? <span className="tabular-nums">{entry.at}</span> : null}
              {entry.provider ? <><span aria-hidden="true">·</span><span>{entry.provider}</span></> : null}
              {entry.model ? <><span aria-hidden="true">·</span><span>{entry.model}</span></> : null}
            </div>
            {entry.summary ? (
              <p className="ldvh-detail-semantic-body mt-1 min-w-0 break-words">{entry.summary}</p>
            ) : null}
          </div>
        ))}
      </div>
    </ReadingNodeSection>
  );
}

/**
 * 对象身份与授权范围的正文段（21 §8：`gist` / `summary` / `serves` / `scope`）。
 *
 * 四个生命周期主体**共用**它。docs/10 §4.2 与 docs/01 §1.10 的同一条纪律：
 * 「条件字段可以随事实是否形成而省略，但已存在字段不能因对象处于某个进展分组
 * 而消失」。此前只有 DraftBody 渲染这三个字段，closed 详情因此看不到对象实际
 * 携带的 summary/serves/scope（缺陷 D11）——分组只应改变**强调**，不应改变
 * **在场字段集**。
 *
 * 10 §5.5 的字段分工在此落位：`gist` 与 `summary` **都**出现在详情，但形态不同——
 * `gist` 是 21 §8 定义的**纯文本**要点（≤200 字符、无 Markdown 标记），故按纯文本
 * 渲染；`summary` 是完整快照（可含 Markdown），故经 `ProseNode` 作 Markdown 节点。
 * 二者不可合并：合并会让 Human 无法判断自己读的是扫读要点还是执行者快照。
 */
function ResponsibilityNodes({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
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
        />
      ) : null}
      <ProseNode
        title={t('objectDetail.workcaseServes')}
        value={typeof obj.serves === 'string' ? obj.serves : ''}
        locale={locale}
        issue={fieldIssue(obj, 'serves')}
      />
      <ProseNode
        title={t('objectDetail.workcaseScope')}
        value={typeof obj.scope === 'string' ? obj.scope : ''}
        locale={locale}
        issue={fieldIssue(obj, 'scope')}
      />
    </>
  );
}

function DraftBody({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  return (
    <>
      <ResponsibilityNodes obj={obj} locale={locale} />
      <PlanNode obj={obj} locale={locale} />
      <ReviewsNode obj={obj} locale={locale} />
    </>
  );
}

function ExecutingBody({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const attempt = obj.attempt;

  return (
    <>
      <ResponsibilityNodes obj={obj} locale={locale} />
      {attempt ? (
        <ReadingNodeSection
          title={t('objectDetail.workcaseAttempt')}
          state={state}
          locale={locale}
          onToggle={() => setState((current) => getReadingNodeNextState(current))}
        >
          <div className="divide-y divide-ldvh-border/60">
            {attempt.controller ? (
              <DetailInlineField label={t('objectDetail.workcaseAttemptController')} value={attempt.controller} />
            ) : null}
            {attempt.attempt_id != null ? (
              <DetailInlineField label={t('objectDetail.workcaseAttemptId')} value={String(attempt.attempt_id)} />
            ) : null}
            {attempt.started_at ? (
              <DetailInlineField label={t('objectDetail.workcaseAttemptStartedAt')} value={attempt.started_at} />
            ) : null}
            {attempt.heartbeat_at ? (
              <DetailInlineField label={t('objectDetail.workcaseAttemptHeartbeat')} value={attempt.heartbeat_at} />
            ) : null}
          </div>
        </ReadingNodeSection>
      ) : null}
      <PlanNode obj={obj} locale={locale} />
      <ReviewsNode obj={obj} locale={locale} />
      {/* 此处原先还有一条 `obj.has_result_draft` 提示（着 awaiting_gate2 色）。
          它是**不可达代码**：派生规则里 `has_result_draft` 为真 ⇔ 正文已含「## 结果」
          节 ⇔ group 必为 `awaiting_gate2`（shared/workcaseLifecycle.ts），而本函数只在
          `group === 'executing'` 时渲染，故该分支的条件恒为假。同一提示已由
          `AwaitingGate2Body` 在其正确的分组内承载；保留它会误导为「executing 组也可能
          出现关闭准备窗口」，并让一条提示的着色入参与所在分组不一致。 */}
    </>
  );
}

function AwaitingGate2Body({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  return (
    <>
      <ResponsibilityNodes obj={obj} locale={locale} />
      <ProseNode
        title={t('objectDetail.workcaseResultDraft')}
        value={typeof obj.report_body === 'string' ? obj.report_body : ''}
        locale={locale}
      />
      <PlanNode obj={obj} locale={locale} />
      <ReviewsNode obj={obj} locale={locale} />
    </>
  );
}

function ClosedBody({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const result = obj.result;
  const outcome = obj.outcome;

  return (
    <>
      <ResponsibilityNodes obj={obj} locale={locale} />
      {outcome ? (
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
      ) : null}
      <ResultChecksNode obj={obj} locale={locale} />
      {result?.achieved_scope ? (
        <ProseNode
          title={t('objectDetail.workcaseAchievedScope')}
          value={result.achieved_scope}
          locale={locale}
        />
      ) : null}
      <ResidualNode obj={obj} locale={locale} />
      <PlanNode obj={obj} locale={locale} />
      <ReviewsNode obj={obj} locale={locale} />
      {obj.gate_1 ? (
        <Gate1Node obj={obj} locale={locale} />
      ) : null}
    </>
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
      <div className="divide-y divide-ldvh-border/60">
        {gate1.approver ? (
          <DetailInlineField label={t('objectDetail.workcaseGate1Approver')} value={gate1.approver} />
        ) : null}
        {gate1.approved_at ? (
          <DetailInlineField label={t('objectDetail.workcaseGate1ApprovedAt')} value={gate1.approved_at} />
        ) : null}
      </div>
    </ReadingNodeSection>
  );
}
