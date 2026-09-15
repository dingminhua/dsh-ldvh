import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import { type WorkCaseDetailData } from '@/utils/api';
import { WorkCaseCriteriaList } from '@/components/WorkCaseCriteriaList';
import ObjectReferenceCopyButton from '@/components/ObjectReferenceCopyButton';
import { ChangeLogReadingNode } from '@/pages/object-detail/FactReadingLayouts';
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

/** 21 号三态直读详情阅读面（v5）。按派生 group 分流 draft/open/closed 呈现。 */
export default function WorkCaseReadingLayout({ obj, locale }: WorkCaseReadingLayoutProps) {
  const { t } = useI18n();
  const { selectedProjectId: projectId } = useProjectScope();
  const objectId = obj.object_id ?? obj.id;
  const group = (typeof obj.group === 'string' ? obj.group : obj.current_snapshot_projection?.group) as WorkCaseV5Group | undefined;

  return (
    <div className="ldvh-reading-grid">
      <section className="ldvh-reading-main">
        <header className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
          <span className="ldvh-chip inline-flex items-center gap-1.5 rounded-md border border-ldvh-accent/25 bg-ldvh-accent/5 px-2 py-0.5 text-[11px] font-medium text-ldvh-accent">
            {group ? t(GROUP_LABEL_KEY[group]) : t('objectList.workcaseGroup.unknown')}
          </span>
          {obj.status ? <span className="ldvh-meta-muted">status: {obj.status}</span> : null}
          {projectId ? <ObjectReferenceCopyButton projectId={projectId} objectId={objectId} /> : null}
        </header>

        {group === 'pending_gate1' && <DraftBody obj={obj} t={t} />}
        {group === 'executing' && <ExecutingBody obj={obj} t={t} />}
        {group === 'awaiting_gate2' && <AwaitingGate2Body obj={obj} t={t} />}
        {group === 'closed' && <ClosedBody obj={obj} t={t} />}
        {!group && (
          <p className="ldvh-card-decision-body rounded-md border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-red-400">
            {t('objectList.workcaseProgressGroupUnavailable')}
          </p>
        )}

        <ChangeLogReadingNode value={obj.change_log} locale={locale} />
      </section>
    </div>
  );
}

function BodySection({ title, t, children }: { title: string; t: LayoutT; children: React.ReactNode }) {
  return (
    <section className="ldvh-fact-section mt-4 first:mt-0">
      <h3 className="ldvh-card-decision-title mb-1.5">{title}</h3>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function PlanList({ plan, t }: { plan?: WorkCaseDetailData['plan']; t: LayoutT }) {
  if (!plan || plan.length === 0) {
    return <p className="ldvh-caption text-red-400">{t('objectList.workcaseFieldMissing')}</p>;
  }
  return (
    <WorkCaseCriteriaList
      items={plan.map((step, index) => ({ key: String(index), statement: [step.step, step.done_criteria].filter(Boolean).join(' — ') }))}
    />
  );
}

function DraftBody({ obj, t }: { obj: WorkCaseDetailData; t: LayoutT }) {
  return (
    <>
      {obj.summary ? <p className="ldvh-card-decision-body">{obj.summary}</p> : null}
      {obj.serves ? <BodySection title={t('objectDetail.workcaseServes')} t={t}><p className="ldvh-card-decision-body">{obj.serves}</p></BodySection> : null}
      {obj.scope ? <BodySection title={t('objectDetail.workcaseScope')} t={t}><p className="ldvh-card-decision-body">{obj.scope}</p></BodySection> : null}
      <BodySection title={t('objectDetail.workcasePlan')} t={t}><PlanList plan={obj.plan} t={t} /></BodySection>
      <p className="ldvh-caption mt-3 text-amber-500 dark:text-amber-400">{t('objectDetail.workcaseAwaitingGate1')}</p>
    </>
  );
}

function ExecutingBody({ obj, t }: { obj: WorkCaseDetailData; t: LayoutT }) {
  return (
    <>
      {obj.attempt ? (
        <BodySection title={t('objectDetail.workcaseAttempt')} t={t}>
          <ul className="ldvh-fact-fields grid min-w-0 gap-1">
            {obj.attempt.controller ? <li><span className="ldvh-fact-field-key">{t('objectDetail.workcaseAttemptController')}</span><span className="ldvh-fact-field-value">{obj.attempt.controller}</span></li> : null}
            {obj.attempt.attempt_id != null ? <li><span className="ldvh-fact-field-key">{t('objectDetail.workcaseAttemptId')}</span><span className="ldvh-fact-field-value">{String(obj.attempt.attempt_id)}</span></li> : null}
            {obj.attempt.heartbeat_at ? <li><span className="ldvh-fact-field-key">{t('objectDetail.workcaseAttemptHeartbeat')}</span><span className="ldvh-fact-field-value">{obj.attempt.heartbeat_at}</span></li> : null}
          </ul>
        </BodySection>
      ) : null}
      <BodySection title={t('objectDetail.workcasePlan')} t={t}><PlanList plan={obj.plan} t={t} /></BodySection>
      {obj.has_result_draft ? (
        <p className="ldvh-caption mt-3 text-violet-500 dark:text-violet-400">{t('objectDetail.workcaseResultDraftPresent')}</p>
      ) : null}
    </>
  );
}

function AwaitingGate2Body({ obj, t }: { obj: WorkCaseDetailData; t: LayoutT }) {
  return (
    <>
      <BodySection title={t('objectDetail.workcasePlan')} t={t}><PlanList plan={obj.plan} t={t} /></BodySection>
      <p className="ldvh-caption mt-3 text-violet-500 dark:text-violet-400">{t('objectDetail.workcaseAwaitingGate2')}</p>
    </>
  );
}

function ClosedBody({ obj, t }: { obj: WorkCaseDetailData; t: LayoutT }) {
  const result = obj.result;
  const outcome = obj.outcome;
  return (
    <>
      {outcome ? (
        <BodySection title={t('objectDetail.workcaseOutcome')} t={t}>
          <span className="ldvh-chip">{t(OUTCOME_LABEL_KEY[outcome])}</span>
        </BodySection>
      ) : null}
      {result ? (
        <>
          {result.criteria_checks && result.criteria_checks.length > 0 ? (
            <BodySection title={t('objectDetail.workcaseResultChecks')} t={t}>
              <WorkCaseCriteriaList
                items={result.criteria_checks.map((c, index) => ({
                  key: String(index),
                  statement: [c.satisfied, c.evidence].filter(Boolean).join(' · '),
                }))}
              />
            </BodySection>
          ) : null}
          {result.achieved_scope ? <BodySection title={t('objectDetail.workcaseAchievedScope')} t={t}><p className="ldvh-card-decision-body">{result.achieved_scope}</p></BodySection> : null}
          {result.residual ? <BodySection title={t('objectDetail.workcaseResidual')} t={t}><p className="ldvh-card-decision-body">{result.residual}</p></BodySection> : null}
        </>
      ) : null}
      {obj.gate_1 ? (
        <BodySection title={t('objectDetail.workcaseGate1')} t={t}>
          <ul className="ldvh-fact-fields grid min-w-0 gap-1">
            {obj.gate_1.approver ? <li><span className="ldvh-fact-field-key">{t('objectDetail.workcaseGate1Approver')}</span><span className="ldvh-fact-field-value">{obj.gate_1.approver}</span></li> : null}
            {obj.gate_1.approved_at ? <li><span className="ldvh-fact-field-key">{t('objectDetail.workcaseGate1ApprovedAt')}</span><span className="ldvh-fact-field-value">{obj.gate_1.approved_at}</span></li> : null}
          </ul>
        </BodySection>
      ) : null}
    </>
  );
}
