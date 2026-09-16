import { useState } from 'react';
import { useI18n } from '@/i18n/context';
import { getFieldLabel } from '@/i18n/locales';
import { type WorkCaseDetailData } from '@/utils/api';
import { WorkCaseCriteriaList, WORKCASE_CRITERIA_SURFACE_CLASS } from '@/components/WorkCaseCriteriaList';
import ObjectReferenceCopyButton from '@/components/ObjectReferenceCopyButton';
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
import { useProjectScope } from '@/utils/projectContext';

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

const GROUP_LABEL_KEY: Record<WorkCaseV5Group, Parameters<LayoutT>[0]> = {
  pending_gate1: 'objectList.workcaseGroup.pending_gate1',
  executing: 'objectList.workcaseGroup.executing',
  awaiting_gate2: 'objectList.workcaseGroup.awaiting_gate2',
  closed: 'objectList.workcaseGroup.closed',
};

/** 21 号三态直读详情阅读面（v5）。外壳与正文段沿用其余六类阅读布局的既有
 * 承载（10 §5.3 语义详情、10 §12.7 长文须有折叠入口）：根容器
 * `mb-6 flex flex-col gap-5`、正文段 ReadingNodeSection、字段 DetailInlineField。 */
export default function WorkCaseReadingLayout({ obj, locale }: WorkCaseReadingLayoutProps) {
  const { t } = useI18n();
  const { selectedProjectId: projectId } = useProjectScope();
  const objectId = obj.object_id ?? obj.id;
  const group = (typeof obj.group === 'string' ? obj.group : obj.current_snapshot_projection?.group) as WorkCaseV5Group | undefined;

  return (
    <div className="mb-6 flex flex-col gap-5">
      <section className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="ldvh-chip inline-flex items-center gap-1.5 rounded-md border border-ldvh-accent/25 bg-ldvh-accent/5 px-2 py-0.5 font-medium text-ldvh-accent">
          {group ? t(GROUP_LABEL_KEY[group]) : t('objectList.workcaseGroup.unknown')}
        </span>
        {obj.status ? <span className="ldvh-meta-muted">status: {obj.status}</span> : null}
        {projectId ? <ObjectReferenceCopyButton projectId={projectId} objectId={objectId} /> : null}
      </section>

      {group === 'pending_gate1' && <DraftBody obj={obj} locale={locale} />}
      {group === 'executing' && <ExecutingBody obj={obj} locale={locale} />}
      {group === 'awaiting_gate2' && <AwaitingGate2Body obj={obj} locale={locale} />}
      {group === 'closed' && <ClosedBody obj={obj} locale={locale} />}
      {!group && (
        <p className="ldvh-card-decision-body rounded-md border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-red-400">
          {t('objectList.workcaseProgressGroupUnavailable')}
        </p>
      )}

      <FactAssociationsSection obj={obj} locale={locale} />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}

/** 正文段统一走 ReadingNodeSection——与其余六类阅读布局同款可折叠节点。 */
function ProseNode({
  title,
  value,
  locale,
  issue,
  markdown = false,
}: {
  title: string;
  value: string;
  locale: string;
  issue?: ReturnType<typeof fieldIssue>;
  markdown?: boolean;
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
      ) : markdown ? (
        <ResearchTextNodeContent value={value} />
      ) : (
        <p className="ldvh-card-decision-body min-w-0 whitespace-pre-wrap break-words">{value}</p>
      )}
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
 * 呈现——10 §12.8 禁止用颜色或图标单独承载状态，故必须带文字判读。 */
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
            <span
              className={`ldvh-chip-sm w-fit ${
                check.satisfied === true
                  ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : check.satisfied === false
                  ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  : 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary'
              }`}
            >
              {check.satisfied === true
                ? t('objectDetail.workcaseCheckSatisfied')
                : check.satisfied === false
                ? t('objectDetail.workcaseCheckUnsatisfied')
                : t('objectDetail.workcaseCheckUnknown')}
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
function ResidualNode({ obj }: { obj: WorkCaseDetailData }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const residual = Array.isArray(obj.result?.residual) ? obj.result.residual : [];
  if (residual.length === 0) return null;

  return (
    <ReadingNodeSection
      title={t('objectDetail.workcaseResidual')}
      state={state}
      locale=""
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
              <p className="mt-1 min-w-0 break-words ldvh-card-decision-body">{entry.summary}</p>
            ) : null}
          </div>
        ))}
      </div>
    </ReadingNodeSection>
  );
}

function DraftBody({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  return (
    <>
      {obj.summary ? (
        <p className="ldvh-card-decision-body min-w-0 break-words">{obj.summary}</p>
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
        markdown
      />
      <PlanNode obj={obj} locale={locale} />
      <ReviewsNode obj={obj} locale={locale} />
      <p className="ldvh-caption text-amber-500 dark:text-amber-400">{t('objectDetail.workcaseAwaitingGate1')}</p>
    </>
  );
}

function ExecutingBody({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const attempt = obj.attempt;

  return (
    <>
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
      <ReviewsNode obj={obj} locale={locale} />
      <PlanNode obj={obj} locale={locale} />
      {obj.has_result_draft ? (
        <p className="ldvh-caption text-violet-500 dark:text-violet-400">{t('objectDetail.workcaseResultDraftPresent')}</p>
      ) : null}
    </>
  );
}

function AwaitingGate2Body({ obj, locale }: { obj: WorkCaseDetailData; locale: string }) {
  const { t } = useI18n();
  return (
    <>
      <p className="ldvh-caption text-violet-500 dark:text-violet-400">{t('objectDetail.workcaseAwaitingGate2')}</p>
      <ProseNode
        title={t('objectDetail.workcaseResultDraft')}
        value={typeof obj.report_body === 'string' ? obj.report_body : ''}
        locale={locale}
        markdown
      />
      <PlanNode obj={obj} locale={locale} />
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
          markdown
        />
      ) : null}
      <ResidualNode obj={obj} />
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
