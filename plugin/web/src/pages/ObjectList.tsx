import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Activity, ArrowRight, CalendarClock, Circle, CircleAlert, CircleCheck, CircleMinus, CirclePlay, ClipboardList, Clock3, History, Lightbulb, ListChecks, Search, ShieldCheck, Target } from 'lucide-react';
import ObjectIdentityActions from '@/components/ObjectIdentityActions';
import SegmentedControl from '@/components/SegmentedControl';
import StatusBadge from '@/components/StatusBadge';
import WorkCaseCapabilityStatusBadge from '@/components/WorkCaseCapabilityStatusBadge';
import ObjectStatusFilter from '@/components/ObjectStatusFilter';
import WorkCaseProgressFilter from '@/components/WorkCaseProgressFilter';
import WorkCaseProgressTrack from '@/components/WorkCaseProgressTrack';
import ObjectPriorityFilter from '@/components/ObjectPriorityFilter';
import PriorityIcon from '@/components/PriorityIcon';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import ServesSgBadge from '@/components/ServesSgBadge';
import SummaryText from '@/components/SummaryText';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { WorkCaseCriteriaList, WORKCASE_CRITERIA_SURFACE_CLASS } from '@/components/WorkCaseCriteriaList';
import { fetchObjectDetail, fetchObjects, type FactCardAssociation, type FactCoverageStatus, type FactListProblem, type ObjectDetail, type ObjectItem, type ObjectStatusOption, type WorkCaseClosureProposalCard, type WorkCaseClosureTerminalCard, type WorkCaseContributionTarget, type WorkCaseExecutionItem, type WorkCaseListGroup, type WorkCaseProgressOption, type WorkCaseSparkSuggestionCard } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { getFieldLabel, getFieldValueLabel, getLocalizedObjectTitle, getObjectStatusLocale, getTypeLabel } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { getFactReadMeta, isReadableFact } from '@/utils/factReadMeta';
import { ALL_STATUS_PARAM, getEffectiveListStatus, writeListStatusParam } from '@/utils/listStatus';
import { usePanel } from '@/utils/panelContext';
import { useProjectScope } from '@/utils/projectContext';
import { compareRfc3339Timestamps } from '@/shared/timestamp';
import {
  WORKCASE_PROGRESS_STEP_ORDER,
  isResolvedWorkCasePresentationProjection,
  isWorkCaseProgressGroup,
  type WorkCaseLifecyclePosition,
  type WorkCaseProgressGroup,
  type WorkCaseProgressStep,
} from '@/shared/workcaseStatus';

type Translate = ReturnType<typeof useI18n>['t'];
type StatusReason = { label: string; text: string; missing?: boolean };
type ObjectListSort = 'updated_desc' | 'created_desc';

const WORKCASE_SECTION_ICON_SIZE = 14;
/** Shared vertical rhythm between a semantic card title and its first body block. */
const WORKCASE_CARD_TITLE_BODY_GAP_CLASS = 'mt-1.5';

function formatReasonText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/\[[ xX]\]\s*/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function statusRequiresDisposition(obj: ObjectItem): boolean {
  return obj.status === 'retired'
    || obj.status === 'discarded'
    || (obj.fact_type_key === 'spark' && obj.status === 'implemented');
}

function isDeprecatedListCard(obj: ObjectItem): boolean {
  return obj.status === 'retired' || obj.status === 'discarded' || obj.status === 'deprecated';
}

function getNonActiveReason(obj: ObjectItem, t: Translate): StatusReason | null {
  if (!statusRequiresDisposition(obj)) return null;
  const disposition = obj.disposition_summary;
  if (typeof disposition === 'string' && disposition.trim()) {
    const text = formatReasonText(disposition);
    if (text) return { label: t('objectList.disposition'), text };
  }
  return {
    label: t('objectList.missingReason'),
    text: t('objectList.missingReasonText'),
    missing: true,
  };
}

function StatusReasonNote({ reason }: { reason: StatusReason }) {
  const isMissing = Boolean(reason.missing);
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className={`min-w-0 cursor-default px-1.5 py-1 ${
        isMissing
          ? 'rounded-md bg-red-500/5'
          : ''
      }`}
    >
      <div className={`ldvh-meta mb-1 flex min-w-0 items-center gap-1.5 ${
        isMissing ? 'text-red-400' : 'text-ldvh-text-secondary/75'
      }`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isMissing ? 'bg-red-400' : 'bg-ldvh-text-secondary/75'}`} aria-hidden="true" />
        <span className="min-w-0 truncate">{reason.label}</span>
      </div>
      <p className={`ldvh-card-decision-body whitespace-pre-wrap break-words ${
        isMissing ? 'text-red-400' : 'text-ldvh-text-secondary/75'
      }`}
      >
        {reason.text}
      </p>
    </div>
  );
}

/** 计划判断输入区：与认知中心收件箱"待批准计划"决定依据区同源消费（02 §7.5）。 */
// eslint-disable-next-line react-refresh/only-export-components
export function WorkCasePlanConfirmationContent({
  mode = 'card',
  goal,
  scope,
  successCriteria,
  successCriterionDefinitions,
  workItems,
  creationReviews,
  executionAuthorization,
  executionApproval,
  isBlocked = false,
  blockingSummary,
  t,
}: {
  mode?: 'card' | 'decision';
  goal?: string;
  scope?: string;
  successCriteria?: string[];
  successCriterionDefinitions?: unknown;
  workItems?: unknown;
  creationReviews?: unknown;
  executionAuthorization?: unknown;
  executionApproval?: unknown;
  isBlocked?: boolean;
  blockingSummary?: string;
  t: Translate;
}) {
  const { locale } = useI18n();
  const criteria = successCriteria?.filter((criterion) => criterion.trim()) ?? [];
  const showsCompleteGateMaterial = mode === 'decision';

  return (
    <div className="grid min-w-0 gap-2">
      {isBlocked && <WorkCaseBlockingNotice blockingSummary={blockingSummary} t={t} />}
      <WorkCaseGoalSection goal={goal} t={t} />
      {showsCompleteGateMaterial && (
        <GateOneFieldSection fieldKey="scope" value={scope} valid={isNonEmptyString(scope)} locale={locale} />
      )}
      <section className={WORKCASE_CRITERIA_SURFACE_CLASS}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ListChecks size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-blue-500 dark:text-blue-400" aria-hidden="true" />
            <h3 className="ldvh-card-decision-title text-blue-700/85 dark:text-blue-200/85">{t('objectDetail.workcaseSuccessCriteria')}</h3>
          </div>
          {criteria.length > 0 && (
            <span className="ldvh-meta shrink-0 text-blue-700/60 dark:text-blue-200/65">
              {t('objectList.workcaseCriteriaCount', { count: String(criteria.length) })}
            </span>
          )}
        </div>
        {isValidCriterionDefinitions(successCriterionDefinitions) ? (
          showsCompleteGateMaterial ? (
            <GateOneValue value={successCriterionDefinitions} locale={locale} depth={0} />
          ) : (
            <WorkCaseCriteriaList
              className={WORKCASE_CARD_TITLE_BODY_GAP_CLASS}
              items={successCriterionDefinitions.map((criterion) => ({
                key: String(criterion.criterion_id),
                statement: String(criterion.statement),
              }))}
            />
          )
        ) : successCriterionDefinitions !== undefined ? (
          <div className="min-w-0">
            <p className="ldvh-caption mt-1.5 text-red-400">{t('objectList.workcaseGateFieldMalformed')}</p>
            <GateOneValue value={successCriterionDefinitions} locale={locale} depth={0} />
          </div>
        ) : criteria.length > 0 ? (
          <div className="min-w-0">
            <p className="ldvh-caption mt-1.5 text-red-400">{t('objectList.workcaseGateFieldMalformed')}</p>
            <WorkCaseCriteriaList
              className={WORKCASE_CARD_TITLE_BODY_GAP_CLASS}
              items={criteria.map((criterion, index) => ({
                key: `${index}-${criterion}`,
                statement: criterion,
              }))}
            />
          </div>
        ) : (
          <p className="ldvh-caption mt-1.5 text-red-400">{t('objectList.workcaseFieldMissing')}</p>
        )}
      </section>
      {showsCompleteGateMaterial && (
        <>
          <GateOneFieldSection
            fieldKey="work_items"
            value={workItems}
            valid={isValidGateWorkItems(workItems)}
            locale={locale}
          />
          <GateOneFieldSection
            fieldKey="creation_reviews"
            value={creationReviews}
            valid={isValidGateReviews(creationReviews)}
            locale={locale}
          />
        </>
      )}
      <ExecutionAuthorizationCard
        authorization={executionAuthorization}
        locale={locale}
        compact={mode === 'card'}
      />
      {showsCompleteGateMaterial && executionApproval !== undefined && (
        <GateOneFieldSection
          fieldKey="execution_approval"
          value={executionApproval}
          valid={isValidExecutionApproval(executionApproval)}
          locale={locale}
        />
      )}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isStringArray(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(isNonEmptyString);
}

function isValidGateWorkItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((candidate) => {
    if (!isRecord(candidate)) return false;
    return isNonEmptyString(candidate.item_id)
      && isNonEmptyString(candidate.goal)
      && isNonEmptyString(candidate.expected_result)
      && isNonEmptyString(candidate.status)
      && (candidate.depends_on === undefined || isStringArray(candidate.depends_on))
      && (candidate.approach_summary === undefined || isNonEmptyString(candidate.approach_summary))
      && (candidate.template_keys === undefined || isStringArray(candidate.template_keys));
  });
}

function isValidCriterionDefinitions(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every((candidate) => (
    isRecord(candidate)
    && isNonEmptyString(candidate.criterion_id)
    && isNonEmptyString(candidate.statement)
  ));
}

function isValidGateReviews(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((candidate) => {
      if (!isRecord(candidate)) return false;
      const method = candidate.actual_method;
      const fallbackFields = [
        'capability_evidence',
        'assurance_gap',
        'human_disclosure_summary',
        'human_disclosed_at',
      ];
      const methodValid =
        method === 'subagent-read-only'
          ? fallbackFields.every((key) => candidate[key] === undefined)
          : method === 'same-ai-switched-role-read-only' &&
            isStringArray(candidate.capability_evidence, false) &&
            isNonEmptyString(candidate.assurance_gap) &&
            isNonEmptyString(candidate.human_disclosure_summary) &&
            isNonEmptyString(candidate.human_disclosed_at);
      return (
        methodValid &&
        isNonEmptyString(candidate.reviewer) &&
        isNonEmptyString(candidate.reviewed_at) &&
        typeof candidate.subject_version === 'number' &&
        isNonEmptyString(candidate.scope) &&
        isNonEmptyString(candidate.conclusion) &&
        (candidate.feedback === undefined ||
          isStringArray(candidate.feedback)) &&
        (candidate.controller_resolution === undefined ||
          isNonEmptyString(candidate.controller_resolution))
      );
    })
  );
}

function isValidExecutionAuthorization(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actions = value.authorized_actions;
  return (
    Array.isArray(actions) &&
    actions.length > 0 &&
    actions.every((candidate) => {
      if (!isRecord(candidate)) return false;
      return (
        [
          'action_id',
          'summary',
          'target_scope',
          'effect_scope',
          'risk_summary',
          'rollback_summary',
        ].every((key) => isNonEmptyString(candidate[key])) &&
        isStringArray(candidate.rule_refs, false)
      );
    }) &&
    isNonEmptyString(value.action_ceiling) &&
    isStringArray(value.prohibited_actions, false) &&
    isNonEmptyString(value.allowed_adjustments) &&
    isNonEmptyString(value.verification_and_rollback) &&
    isNonEmptyString(value.out_of_bounds_handling) &&
    (value.human_prerequisites === undefined ||
      isStringArray(value.human_prerequisites, false)) &&
    value.capability_limitations === undefined &&
    value.reviewer_policy === undefined
  );
}

function isValidExecutionApproval(value: unknown): boolean {
  return isRecord(value)
    && typeof value.subject_version === 'number'
    && isNonEmptyString(value.approved_at)
    && isNonEmptyString(value.summary)
    && isNonEmptyString(value.baseline_fingerprint)
    && isStringArray(value.source_refs, false);
}

function GateOneFieldSection({
  fieldKey,
  value,
  valid,
  locale,
  title,
}: {
  fieldKey: string;
  value: unknown;
  valid: boolean;
  locale: string;
  title?: string;
}) {
  const { t } = useI18n();
  const missing = value === undefined || value === null || value === '';
  return (
    <section className={`min-w-0 rounded-lg border px-3 py-2.5 ${valid ? 'border-slate-300/55 bg-slate-500/[0.025] dark:border-slate-600/55' : 'border-red-400/30 bg-red-500/[0.035]'}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className={`ldvh-card-decision-title min-w-0 ${valid ? 'text-slate-700/85 dark:text-slate-200/85' : 'text-red-500 dark:text-red-300'}`}>
          {title ?? getFieldLabel(fieldKey, locale)}
        </h3>
        {!valid && (
          <span className="ldvh-meta shrink-0 text-red-400">
            {missing ? t('objectList.workcaseFieldMissing') : t('objectList.workcaseGateFieldMalformed')}
          </span>
        )}
      </div>
      {!missing && <GateOneValue value={value} locale={locale} depth={0} />}
    </section>
  );
}

function ExecutionAuthorizationCard({
  authorization,
  locale,
  compact,
}: {
  authorization: unknown;
  locale: string;
  compact: boolean;
}) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<
    'actions' | 'prohibited' | 'prerequisites' | null
  >(null);
  if (!isValidExecutionAuthorization(authorization)) {
    return (
      <GateOneFieldSection
        fieldKey="execution_authorization"
        value={authorization}
        valid={false}
        locale={locale}
        title={t('objectDetail.workcaseExecutionAuthorization')}
      />
    );
  }

  const actions = authorization.authorized_actions as Record<string, unknown>[];
  const prohibitedActions = authorization.prohibited_actions as string[];
  const prerequisites = (authorization.human_prerequisites ?? []) as string[];
  const tabTypography = compact ? 'ldvh-meta' : 'ldvh-caption-strong';
  const toggleTab = (tab: 'actions' | 'prohibited' | 'prerequisites') => {
    setActiveTab((current) => (current === tab ? null : tab));
  };
  const tabStyles = {
    actions: {
      button:
        'border-emerald-400/35 text-emerald-800/85 hover:bg-emerald-500/[0.06] dark:text-emerald-100/85',
      selected:
        'border-emerald-400/50 border-b-transparent bg-emerald-500/[0.08]',
      panel: 'border-emerald-400/35 bg-emerald-500/[0.035]',
    },
    prohibited: {
      button:
        'border-rose-400/35 text-rose-700/85 hover:bg-rose-500/[0.06] dark:text-rose-200/85',
      selected: 'border-rose-400/50 border-b-transparent bg-rose-500/[0.08]',
      panel: 'border-rose-400/35 bg-rose-500/[0.035]',
    },
    prerequisites: {
      button:
        'border-violet-400/35 text-violet-700/85 hover:bg-violet-500/[0.06] dark:text-violet-200/85',
      selected:
        'border-violet-400/50 border-b-transparent bg-violet-500/[0.08]',
      panel: 'border-violet-400/35 bg-violet-500/[0.035]',
    },
  };

  return (
    <section className="min-w-0 rounded-lg border border-ldvh-border bg-ldvh-panel px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <ShieldCheck
          size={WORKCASE_SECTION_ICON_SIZE}
          className="shrink-0 text-sky-600 dark:text-sky-300"
          aria-hidden="true"
        />
        <h3 className="ldvh-card-decision-title min-w-0">
          {t('objectDetail.workcaseExecutionAuthorization')}
        </h3>
      </div>
      <p className="ldvh-caption mt-1.5 text-ldvh-text-secondary">
        {t('objectDetail.workcaseExecutionAuthorizationBoundary')}
      </p>
      <div className="mt-2.5 min-w-0">
        <div className={`grid w-full min-w-0 grid-cols-3`}>
          <button
            type="button"
            aria-controls="workcase-card-authorization-actions"
            aria-expanded={activeTab === 'actions'}
            onClick={() => toggleTab('actions')}
            className={`${tabTypography} w-full min-w-0 border px-1.5 py-1.5 text-center transition-colors first:rounded-tl-md ${tabStyles.actions.button} ${activeTab === 'actions' ? `relative z-10 ${tabStyles.actions.selected}` : ''}`}
          >
            {t('objectList.workcaseAuthorizedActionCount', {
              count: String(actions.length),
            })}
          </button>
          <button
            type="button"
            aria-controls="workcase-card-authorization-prohibited"
            aria-expanded={activeTab === 'prohibited'}
            onClick={() => toggleTab('prohibited')}
            className={`${tabTypography} w-full min-w-0 border border-l-0 px-1.5 py-1.5 text-center transition-colors ${tabStyles.prohibited.button} ${activeTab === 'prohibited' ? `relative z-10 ${tabStyles.prohibited.selected}` : ''}`}
          >
            {t('objectList.workcaseProhibitedActionCount', {
              count: String(prohibitedActions.length),
            })}
          </button>
          <button
            type="button"
            aria-controls="workcase-card-authorization-prerequisites"
            aria-expanded={activeTab === 'prerequisites'}
            onClick={() => toggleTab('prerequisites')}
            className={`${tabTypography} w-full min-w-0 border border-l-0 px-1.5 py-1.5 text-center transition-colors rounded-tr-md ${tabStyles.prerequisites.button} ${activeTab === 'prerequisites' ? `relative z-10 ${tabStyles.prerequisites.selected}` : ''}`}
          >
            {t('objectList.workcasePrerequisiteCount', {
              count: String(prerequisites.length),
            })}
          </button>
        </div>
        {activeTab === 'actions' && (
          <div
            id="workcase-card-authorization-actions"
            className={`-mt-px min-w-0 rounded-b-md border px-2.5 py-1.5 ${tabStyles.actions.panel}`}
          >
            <ul className="grid min-w-0 divide-y divide-emerald-500/15">
              {actions.map((action) => (
                <li
                  key={String(action.action_id)}
                  className="flex min-w-0 gap-1.5 py-1.5 first:pt-0.5 last:pb-0.5"
                >
                  <span
                    className="mt-2 size-1 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-300"
                    aria-hidden="true"
                  />
                  <p className="ldvh-caption-strong min-w-0 text-emerald-800 dark:text-emerald-100">
                    {String(action.summary)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {activeTab === 'prohibited' && (
          <div
            id="workcase-card-authorization-prohibited"
            className={`-mt-px min-w-0 rounded-b-md border px-2.5 py-1.5 ${tabStyles.prohibited.panel}`}
          >
            <AuthorizationCardItems items={prohibitedActions} tone="warning" />
          </div>
        )}
        {activeTab === 'prerequisites' && (
          <div
            id="workcase-card-authorization-prerequisites"
            className={`-mt-px min-w-0 rounded-b-md border px-2.5 py-1.5 ${tabStyles.prerequisites.panel}`}
          >
            <AuthorizationCardItems items={prerequisites} tone="prerequisite" />
          </div>
        )}
      </div>
    </section>
  );
}

function AuthorizationCardItems({
  items,
  tone,
}: {
  items: string[];
  tone: 'warning' | 'prerequisite';
}) {
  const bulletClass =
    tone === 'warning'
      ? 'bg-rose-500 dark:bg-rose-300'
      : 'bg-violet-500 dark:bg-violet-300';
  const textClass =
    tone === 'warning'
      ? 'text-rose-700 dark:text-rose-200'
      : 'text-violet-700 dark:text-violet-200';
  return (
    <ul className="grid min-w-0 divide-y divide-emerald-500/15">
      {items.map((item) => (
        <li
          key={item}
          className="flex min-w-0 gap-1.5 py-1.5 first:pt-0.5 last:pb-0.5"
        >
          <span
            className={`mt-2 size-1 shrink-0 rounded-full ${bulletClass}`}
            aria-hidden="true"
          />
          <p className={`ldvh-caption-strong min-w-0 ${textClass}`}>{item}</p>
        </li>
      ))}
    </ul>
  );
}

function GateOneValue({ value, locale, depth }: { value: unknown; locale: string; depth: number }) {
  if (typeof value === 'string') {
    return <SummaryText value={value} collapseThreshold={Number.MAX_SAFE_INTEGER} className="ldvh-card-decision-body mt-1.5 !text-ldvh-text-secondary" />;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p className="ldvh-card-decision-body mt-1.5 font-mono text-ldvh-text-secondary">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="ldvh-caption mt-1.5 text-red-400">[]</p>;
    return (
      <ul className="mt-1.5 grid min-w-0 gap-1.5">
        {value.map((entry, index) => (
          <li key={index} className={`min-w-0 ${isRecord(entry) ? 'rounded-md border border-ldvh-border/60 px-2.5 py-2' : 'flex items-start gap-2'}`}>
            {!isRecord(entry) && <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ldvh-text-secondary/55" aria-hidden="true" />}
            <GateOneValue value={entry} locale={locale} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    return (
      <dl className={`mt-1.5 grid min-w-0 gap-2 ${depth === 0 ? 'grid-cols-2' : ''}`}>
        {Object.entries(value).map(([key, entry]) => (
          <div key={key} className="min-w-0">
            <dt className="ldvh-meta break-words text-ldvh-text-secondary/70">{getFieldLabel(key, locale)}</dt>
            <dd className="min-w-0"><GateOneValue value={entry} locale={locale} depth={depth + 1} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="ldvh-caption mt-1.5 break-all font-mono text-red-400">{String(value)}</p>;
}

function WorkCaseGoalSection({
  goal,
  t,
  emphasis = 'primary',
}: {
  goal?: string;
  t: Translate;
  emphasis?: 'primary' | 'supporting';
}) {
  const surfaceClass = emphasis === 'primary'
    ? 'border-violet-400/45 border-l-violet-400 bg-violet-100/70 dark:bg-violet-950/50'
    : 'border-violet-400/20 border-l-violet-400/70 bg-violet-500/[0.025] dark:bg-violet-950/20';

  return (
    <section className={`min-w-0 rounded-md border border-l-2 px-3.5 py-3 ${surfaceClass}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Target size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-violet-500 dark:text-violet-400" aria-hidden="true" />
        <h3 className="ldvh-card-decision-title text-violet-700/85 dark:text-violet-200/85">{t('objectDetail.workcaseResponsibility')}</h3>
      </div>
      {goal?.trim() ? (
        <div className={`ldvh-caption ${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} w-full break-words`}>
          <SummaryText
            value={goal}
            collapseThreshold={Number.MAX_SAFE_INTEGER}
            className="ldvh-card-decision-body text-violet-950/65 dark:text-violet-100/75"
          />
        </div>
      ) : (
        <p className={`ldvh-caption ${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} text-red-400`}>{t('objectList.workcaseFieldMissing')}</p>
      )}
    </section>
  );
}

/** waiting_on 提示块：与认知中心收件箱"已阻塞待处置"决定依据区同源消费（02 §7.5）。 */
// eslint-disable-next-line react-refresh/only-export-components
export function WorkCaseWaitingOnNotice({ waitingOn }: { waitingOn?: string }) {
  const { locale } = useI18n();
  if (!waitingOn?.trim()) return null;
  return (
    <div className="min-w-0 rounded-md border border-amber-400/30 border-l-2 border-l-amber-400 bg-amber-500/[0.045] px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Clock3 size={14} className="shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
        <div className="ldvh-card-decision-title min-w-0 text-amber-700/80 dark:text-amber-200/80">
          {getFieldLabel('waiting_on', locale)}
        </div>
      </div>
      <div className={`${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} break-words`}>
        <SummaryText
          value={waitingOn}
          collapseThreshold={Number.MAX_SAFE_INTEGER}
          className="ldvh-card-decision-body [&_p]:my-0 text-amber-950/70 dark:text-amber-100/75"
        />
      </div>
    </div>
  );
}

/** 阻塞说明提示块：与认知中心收件箱"已阻塞待处置"决定依据区同源消费（02 §7.5）。 */
// eslint-disable-next-line react-refresh/only-export-components
export function WorkCaseBlockingNotice({
  blockingSummary,
  t,
}: {
  blockingSummary?: string;
  t: Translate;
}) {
  const { locale } = useI18n();
  const label = getFieldLabel('blocking_summary', locale);
  return (
    <div
      role="status"
      aria-label={label}
      className="min-w-0 rounded-md border border-rose-400/30 border-l-2 border-l-rose-400 bg-rose-500/[0.045] px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <CircleAlert size={14} className="shrink-0 text-rose-500 dark:text-rose-400" aria-hidden="true" />
        <div className="ldvh-card-decision-title min-w-0 text-rose-700/80 dark:text-rose-200/80">
          {label}
        </div>
      </div>
      {blockingSummary?.trim() ? (
        <div className={`${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} break-words`}>
          <SummaryText
            value={blockingSummary}
            collapseThreshold={Number.MAX_SAFE_INTEGER}
            className="ldvh-card-decision-body [&_p]:my-0 text-rose-950/70 dark:text-rose-100/75"
          />
        </div>
      ) : (
        <p className={`ldvh-card-decision-body ${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} text-red-400`}>{t('objectList.workcaseFieldMissing')}</p>
      )}
    </div>
  );
}

export function WorkCaseProgressingContent({
  goal,
  lifecyclePosition,
  progressStep,
  executionItemsProjectionValid,
  executionItems,
  isBlocked,
  waitingOn,
  blockingSummary,
  t,
}: {
  goal?: string;
  lifecyclePosition: WorkCaseLifecyclePosition | null;
  progressStep: WorkCaseProgressStep | null;
  executionItemsProjectionValid: boolean;
  executionItems: WorkCaseExecutionItem[];
  isBlocked: boolean;
  waitingOn?: string;
  blockingSummary?: string;
  t: Translate;
}) {
  const currentStep = progressStep ? WORKCASE_PROGRESS_STEP_ORDER.indexOf(progressStep) : -1;
  const planRevising = lifecyclePosition === 'plan_revising';
  const itemExecution = progressStep === 'item_execution';
  const executionItemsActive = executionItems.filter((item) => item.status === 'in_progress' || item.status === 'blocked');
  const executionItemOpen = executionItems.filter((item) => ['pending', 'in_progress', 'blocked'].includes(item.status)).length;
  const displayedExecutionItems = itemExecution
    ? executionItems
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const rank = { completed: 0, in_progress: 1, blocked: 2, pending: 3, cancelled: 4 };
        return rank[a.item.status] - rank[b.item.status] || a.index - b.index;
      })
      .map(({ item }) => item)
    : executionItemsActive;
  const itemStageMismatch = executionItemsProjectionValid && currentStep >= 0 && (
    (itemExecution && executionItemsActive.length === 0 && executionItemOpen === 0)
    || (!itemExecution && executionItemOpen > 0)
  );
  const showWorkItems = planRevising
    || !executionItemsProjectionValid
    || itemExecution
    || executionItemsActive.length > 0
    || itemStageMismatch;

  return (
    <div className="grid min-w-0 gap-2">
      {isBlocked && <WorkCaseBlockingNotice blockingSummary={blockingSummary} t={t} />}
      {isBlocked && <WorkCaseWaitingOnNotice waitingOn={waitingOn} />}
      <WorkCaseGoalSection goal={goal} t={t} emphasis="supporting" />
      <section className="min-w-0 rounded-md border border-sky-400/25 border-l-2 border-l-sky-400 bg-sky-500/[0.035] px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <CirclePlay size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-sky-500 dark:text-sky-400" aria-hidden="true" />
          <h3 className="ldvh-card-decision-title text-sky-700/85 dark:text-sky-200/85">{t('objectDetail.workcaseCurrentSnapshot')}</h3>
        </div>

        <WorkCaseProgressTrack
          lifecyclePosition={lifecyclePosition}
          progressGroup="progressing"
          progressStep={progressStep}
          showUnavailable
        />

        {showWorkItems && (
          <div className="mt-2.5 border-t border-ldvh-border/70 pt-2.5">
            <div className="ldvh-caption-strong text-ldvh-text-secondary">
              {itemExecution ? t('objectList.workcaseItems') : t('objectList.workcaseCurrentItems')}
            </div>
            {!executionItemsProjectionValid ? (
              <p className="ldvh-card-decision-body mt-1.5 text-red-400">
                {t('objectList.workcaseItemsUnavailable')}
              </p>
            ) : (
              <>
                {itemStageMismatch && (
                  <p className="ldvh-card-decision-body mt-1.5 text-red-400">
                    {t('objectList.workcaseItemStageMismatch')}
                  </p>
                )}
                {displayedExecutionItems.length > 0 ? (
                  <ul className="mt-1.5 grid min-w-0 gap-2">
                    {displayedExecutionItems.map((item) => {
                      const blocked = item.status === 'blocked';
                      const completed = item.status === 'completed';
                      const inProgress = item.status === 'in_progress';
                      const cancelled = item.status === 'cancelled';
                      const itemTextTone = inProgress
                        ? 'text-sky-950/70 dark:text-sky-100/75'
                        : completed
                          ? 'text-emerald-950/70 dark:text-emerald-100/75'
                          : blocked
                            ? 'text-amber-950/70 dark:text-amber-100/75'
                            : cancelled
                              ? 'text-slate-400 dark:text-slate-500 line-through'
                              : 'text-slate-700/70 dark:text-slate-200/70';
                      const itemIdTone = inProgress
                        ? 'text-sky-600/70 dark:text-sky-300/70'
                        : completed
                          ? 'text-emerald-600/70 dark:text-emerald-300/70'
                          : blocked
                            ? 'text-amber-700/70 dark:text-amber-300/70'
                            : cancelled
                              ? 'text-slate-400/70 dark:text-slate-500/70 line-through'
                              : 'text-slate-500/75 dark:text-slate-400/75';
                      return (
                        <li
                          key={item.id}
                          className={`min-w-0 border-l-2 ${
                            inProgress
                              ? 'rounded-md border border-sky-400/35 border-l-sky-400 bg-sky-500/10 px-2.5 py-2'
                              : blocked
                                ? 'rounded-md border border-amber-400/25 border-l-amber-400 bg-amber-500/5 px-2.5 py-2'
                                : completed
                                  ? 'rounded-md border border-emerald-400/25 border-l-emerald-400 bg-emerald-500/5 px-2.5 py-2'
                                  : cancelled
                                    ? 'rounded-md border border-ldvh-border/70 border-l-ldvh-text-secondary/30 bg-ldvh-bg/60 px-2.5 py-2'
                                    : 'rounded-md border border-ldvh-border/70 border-l-ldvh-text-secondary/35 bg-ldvh-bg/60 px-2.5 py-2'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                              {completed ? (
                                <CircleCheck size={14} className="text-emerald-500/85 dark:text-emerald-400" />
                              ) : inProgress ? (
                                <CirclePlay size={14} className="text-sky-500 dark:text-sky-400" />
                              ) : blocked ? (
                                <CircleAlert size={14} className="text-amber-500 dark:text-amber-400" />
                              ) : cancelled ? (
                                <CircleMinus size={14} className="text-ldvh-text-secondary/45" />
                              ) : (
                                <Circle size={14} className="text-ldvh-text-secondary/55" />
                              )}
                            </span>
                            <div className={`ldvh-meta-primary min-w-0 break-all ${itemIdTone}`}>
                              {item.id}
                            </div>
                          </div>
                          <div className="mt-0.5">
                            <div className="min-w-0 break-words">
                              <SummaryText
                                value={item.title}
                                collapseThreshold={Number.MAX_SAFE_INTEGER}
                                className={`ldvh-card-decision-body [&_p]:my-0 ${itemTextTone}`}
                              />
                            </div>
                            {blocked && (
                              item.blockingReason?.trim() ? (
                                <div className="mt-0.5 break-words">
                                  <SummaryText
                                    value={item.blockingReason}
                                    collapseThreshold={Number.MAX_SAFE_INTEGER}
                                    className="ldvh-card-decision-body [&_p]:my-0 text-amber-950/70 dark:text-amber-100/75"
                                  />
                                </div>
                              ) : (
                                <p className="ldvh-card-decision-body mt-0.5 text-red-400">
                                  {t('objectList.workcaseFieldMissing')}
                                </p>
                              )
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : !itemStageMismatch ? (
                  <p className="ldvh-caption mt-1 text-ldvh-text-secondary/75">
                    {t('objectList.workcaseNoCurrentItems')}
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}

        {!isBlocked && waitingOn?.trim() && (
          <div className="mt-2.5">
            <WorkCaseWaitingOnNotice waitingOn={waitingOn} />
          </div>
        )}

      </section>
    </div>
  );
}

/** Closure inputs reuse the same subdued status-card grammar as progressing work items. */
const PROPOSED_OUTCOME_NOTICE_CLASS: Record<string, string> = {
  completed: 'border-emerald-400/25 border-l-emerald-400 bg-emerald-500/5',
  partial: 'border-amber-400/25 border-l-amber-400 bg-amber-500/5',
  'not-achieved': 'border-red-400/25 border-l-red-400 bg-red-500/5',
  cancelled: 'border-zinc-400/25 border-l-zinc-400 bg-zinc-500/5',
};

const PROPOSED_OUTCOME_TEXT_CLASS: Record<string, string> = {
  completed: 'text-emerald-700/85 dark:text-emerald-200/85',
  partial: 'text-amber-700/85 dark:text-amber-200/85',
  'not-achieved': 'text-red-700/85 dark:text-red-200/85',
  cancelled: 'text-zinc-600/85 dark:text-zinc-300/85',
};

const PROPOSED_OUTCOME_BODY_CLASS: Record<string, string> = {
  completed: 'text-emerald-950/70 dark:text-emerald-100/75',
  partial: 'text-amber-950/70 dark:text-amber-100/75',
  'not-achieved': 'text-red-950/70 dark:text-red-100/75',
  cancelled: 'text-zinc-700/70 dark:text-zinc-200/70',
};

const CLOSURE_PROPOSAL_NOTICE_CLASS = 'border-amber-400/25 border-l-amber-400 bg-amber-500/5';
const CLOSURE_PROPOSAL_TEXT_CLASS = 'text-amber-700/80 dark:text-amber-200/80';
const CLOSURE_PROPOSAL_BODY_CLASS = 'text-amber-900/75 dark:text-amber-100/80';

const PROPOSED_DISPOSITION_NOTICE_CLASS: Record<string, string> = {
  route_existing: 'border-emerald-400/25 border-l-emerald-400 bg-emerald-500/5',
  suggest_spark: 'border-emerald-400/25 border-l-emerald-400 bg-emerald-500/5',
  accept_stop: 'border-cyan-400/25 border-l-cyan-400 bg-cyan-500/5',
};

/** A literal quarter-filled circle keeps the "partial" outcome legible at card-icon size. */
function QuarterCircle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={WORKCASE_SECTION_ICON_SIZE} height={WORKCASE_SECTION_ICON_SIZE} className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8V1.75A6.25 6.25 0 0 1 14.25 8Z" fill="currentColor" />
    </svg>
  );
}

function WorkCaseOutcomeNotice({
  outcome,
  dispositionSummary,
  mode,
}: {
  outcome: WorkCaseClosureProposalCard['proposedOutcome'];
  dispositionSummary: string;
  mode: 'proposal' | 'terminal';
}) {
  const { t, locale } = useI18n();
  const tone = mode === 'proposal'
    ? CLOSURE_PROPOSAL_TEXT_CLASS
    : PROPOSED_OUTCOME_TEXT_CLASS[outcome] ?? 'text-ldvh-text-secondary';
  const bodyTone = mode === 'proposal'
    ? CLOSURE_PROPOSAL_BODY_CLASS
    : PROPOSED_OUTCOME_BODY_CLASS[outcome] ?? 'text-ldvh-text-secondary/80';
  const surface = mode === 'proposal'
    ? CLOSURE_PROPOSAL_NOTICE_CLASS
    : PROPOSED_OUTCOME_NOTICE_CLASS[outcome] ?? 'border-ldvh-border/70 border-l-ldvh-text-secondary/35 bg-ldvh-bg/60';
  const outcomeLabel = mode === 'proposal'
    ? getFieldValueLabel('proposed_outcome', outcome, locale)
    : null;
  const heading = mode === 'proposal'
    ? t('objectList.workcaseClosureProposal')
    : t('objectList.workcaseTerminalDisposition');
  const outcomeIcon = mode === 'proposal'
    ? <ClipboardList size={WORKCASE_SECTION_ICON_SIZE} className={`shrink-0 ${CLOSURE_PROPOSAL_TEXT_CLASS}`} aria-hidden="true" />
    : outcome === 'completed'
      ? <CircleCheck size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
      : outcome === 'partial'
        ? <QuarterCircle className="shrink-0 text-amber-500 dark:text-amber-400" />
        : outcome === 'not-achieved'
          ? <CircleAlert size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-red-500 dark:text-red-400" aria-hidden="true" />
          : <CircleMinus size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />;
  return (
    <section className={`min-w-0 rounded-md border border-l-2 px-3.5 py-3 ${surface}`}>
      <div className="flex min-w-0 items-center gap-2">
        {outcomeIcon}
        <span className={`ldvh-card-decision-title min-w-0 ${tone}`}>
          {heading}
        </span>
        {outcomeLabel && <span className={`ldvh-meta ml-auto shrink-0 ${tone}`}>{outcomeLabel}</span>}
      </div>
      <div className={`${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} min-w-0 break-words`}>
        <SummaryText value={dispositionSummary} collapseThreshold={Number.MAX_SAFE_INTEGER} className={`ldvh-card-decision-body [&_p]:my-0 ${bodyTone}`} />
      </div>
    </section>
  );
}

/** Plain text color for residual disposition labels (no chip frame). */
const PROPOSED_DISPOSITION_TEXT_CLASS: Record<string, string> = {
  route_existing: 'text-emerald-700/85 dark:text-emerald-200/85',
  suggest_spark: 'text-emerald-700/85 dark:text-emerald-200/85',
  accept_stop: 'text-cyan-700/85 dark:text-cyan-200/85',
};

const PROPOSED_DISPOSITION_BODY_CLASS: Record<string, string> = {
  route_existing: 'text-emerald-950/70 dark:text-emerald-100/75',
  suggest_spark: 'text-emerald-950/70 dark:text-emerald-100/75',
  accept_stop: 'text-cyan-950/70 dark:text-cyan-100/75',
};

function WorkCaseSparkSuggestions({ suggestions }: { suggestions: WorkCaseSparkSuggestionCard[] }) {
  const { t, locale } = useI18n();
  if (suggestions.length === 0) return null;
  return (
    <ul className="grid min-w-0 gap-2">
      {suggestions.map((suggestion) => (
        <li key={suggestion.suggestionId} className="min-w-0 rounded-md border border-emerald-400/25 border-l-2 border-l-emerald-400 bg-emerald-500/5 px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Lightbulb size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
            <span className="ldvh-card-decision-title min-w-0 text-emerald-700/85 dark:text-emerald-200/85">
              {getFieldValueLabel('proposed_disposition', 'suggest_spark', locale)}
            </span>
          </div>
          <div className={`${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} min-w-0 break-words`}>
            <SummaryText value={suggestion.summary} collapseThreshold={Number.MAX_SAFE_INTEGER} className="ldvh-card-decision-body [&_p]:my-0 text-emerald-950/70 dark:text-emerald-100/75" />
          </div>
          {suggestion.restrictionReason && <div className="ldvh-caption mt-1 text-emerald-950/65 dark:text-emerald-100/70">{t('objectList.workcaseRestrictionReason')}: {suggestion.restrictionReason}</div>}
          {suggestion.impactSummary && <div className="ldvh-caption mt-0.5 text-emerald-950/65 dark:text-emerald-100/70">{t('objectList.workcaseImpactSummary')}: {suggestion.impactSummary}</div>}
          {suggestion.resumeCondition && <div className="ldvh-caption mt-0.5 text-emerald-950/65 dark:text-emerald-100/70">{t('objectList.workcaseResumeCondition')}: {suggestion.resumeCondition}</div>}
          <div className="ldvh-caption mt-0.5 text-emerald-950/65 dark:text-emerald-100/70">{t('objectList.workcaseFollowUpSummary')}: {suggestion.followUpSummary}</div>
        </li>
      ))}
    </ul>
  );
}

/** 关闭判断输入区：与认知中心收件箱"待确认关闭"决定依据区同源消费（02 §7.5）。 */
// eslint-disable-next-line react-refresh/only-export-components
export function WorkCaseClosureConfirmationContent({
  goal,
  closureProposal,
  onOpenTarget,
}: {
  goal?: string;
  closureProposal?: WorkCaseClosureProposalCard;
  /** Focus may open an explicitly routed object in secondary reading; list Cards retain the plain fact row. */
  onOpenTarget?: (target: WorkCaseContributionTarget, title: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="grid min-w-0 gap-2">
      <WorkCaseGoalSection goal={goal} t={t} />
      {closureProposal ? (
        <>
          <WorkCaseOutcomeNotice outcome={closureProposal.proposedOutcome} dispositionSummary={closureProposal.dispositionSummary} mode="proposal" />
          {closureProposal.residualDecisions.length > 0 && (
            <ul className="grid min-w-0 gap-2">
              {closureProposal.residualDecisions.map((decision) => (
                <li key={decision.residualId} className={`min-w-0 rounded-md border border-l-2 px-3.5 py-3 ${PROPOSED_DISPOSITION_NOTICE_CLASS[decision.proposedDisposition] ?? 'border-ldvh-border/70 border-l-ldvh-text-secondary/35 bg-ldvh-bg/60'}`}>
                  <div className="flex min-w-0 items-center gap-2">
                    {decision.proposedDisposition === 'accept_stop' ? (
                      <CircleMinus size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-cyan-500 dark:text-cyan-400" aria-hidden="true" />
                    ) : decision.proposedDisposition === 'suggest_spark' ? (
                      <Lightbulb size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
                    ) : (
                      <ArrowRight size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-emerald-600 dark:text-emerald-200" aria-hidden="true" />
                    )}
                    <span className={`ldvh-card-decision-title min-w-0 ${PROPOSED_DISPOSITION_TEXT_CLASS[decision.proposedDisposition] ?? 'text-ldvh-text-secondary'}`}>
                      {getFieldValueLabel('proposed_disposition', decision.proposedDisposition, locale)}
                    </span>
                  </div>
                  <div className={`${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} min-w-0 break-words`}>
                    <SummaryText value={decision.summary} collapseThreshold={Number.MAX_SAFE_INTEGER} className={`ldvh-card-decision-body [&_p]:my-0 ${PROPOSED_DISPOSITION_BODY_CLASS[decision.proposedDisposition] ?? 'text-ldvh-text-secondary'}`} />
                  </div>
                  {decision.routeTarget && <WorkCaseContributionTargetRow target={decision.routeTarget} locale={locale} showStatus={false} compact onOpenTarget={onOpenTarget} />}
                </li>
              ))}
            </ul>
          )}
          <WorkCaseSparkSuggestions suggestions={closureProposal.sparkSuggestions} />
        </>
      ) : (
        <section role="status" className="min-w-0 rounded-md border border-red-400/25 border-l-2 border-l-red-400 bg-red-500/5 px-2.5 py-2">
          <p className="ldvh-card-decision-body text-red-500 dark:text-red-300">{t('objectList.workcaseClosureProposalMissing')}</p>
        </section>
      )}
    </div>
  );
}

function WorkCaseClosedContent({ goal, terminal, termination }: { goal?: string; terminal?: WorkCaseClosureTerminalCard; termination?: unknown }) {
  const { t, locale } = useI18n();
  const terminationReason = isRecord(termination) && typeof termination.reason === 'string' ? termination.reason.trim() : '';
  return (
    <div className="grid min-w-0 gap-2">
      <WorkCaseGoalSection goal={goal} t={t} emphasis="supporting" />
      {terminal ? (
        <>
          <WorkCaseOutcomeNotice outcome={terminal.outcome} dispositionSummary={terminal.dispositionSummary} mode="terminal" />
          {terminal.acceptedStop.length > 0 && (
            <ul className="grid min-w-0 gap-2">
              {terminal.acceptedStop.map((residual) => (
                <li key={residual.residualId} className={`min-w-0 rounded-md border border-l-2 px-3.5 py-3 ${PROPOSED_DISPOSITION_NOTICE_CLASS.accept_stop}`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <CircleMinus size={WORKCASE_SECTION_ICON_SIZE} className="shrink-0 text-cyan-500 dark:text-cyan-400" aria-hidden="true" />
                    <span className={`ldvh-card-decision-title min-w-0 ${PROPOSED_DISPOSITION_TEXT_CLASS.accept_stop}`}>
                      {getFieldValueLabel('proposed_disposition', 'accept_stop', locale)}
                    </span>
                  </div>
                  <div className={`${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} min-w-0 break-words`}>
                    <SummaryText value={residual.summary} collapseThreshold={Number.MAX_SAFE_INTEGER} className="ldvh-card-decision-body [&_p]:my-0 text-cyan-950/70 dark:text-cyan-100/75" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <WorkCaseSparkSuggestions suggestions={terminal.sparkSuggestions} />
        </>
      ) : terminationReason ? (
        <WorkCaseOutcomeNotice outcome="not-achieved" dispositionSummary={terminationReason} mode="terminal" />
      ) : (
        <section role="status" className="min-w-0 rounded-md border border-red-400/25 border-l-2 border-l-red-400 bg-red-500/5 px-2.5 py-2">
          <p className="ldvh-card-decision-body text-red-500 dark:text-red-300">{t('objectList.workcaseClosureProposalMissing')}</p>
        </section>
      )}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function WorkCaseContributionsContent({
  contributions,
  locale,
  onOpenTarget,
}: {
  contributions?: WorkCaseContributionTarget[];
  locale: string;
  /** Focus can open a contributed-to target in secondary reading; list Cards remain plain facts. */
  onOpenTarget?: (target: WorkCaseContributionTarget, title: string) => void;
}) {
  const { t } = useI18n();
  if (!contributions || contributions.length === 0) return null;
  return (
    <section className="min-w-0 rounded-md border border-ldvh-border/80 border-l-2 border-l-ldvh-accent/45 bg-ldvh-bg/65 px-3.5 py-3">
      <h3 className="ldvh-card-decision-title">{t('objectList.workcaseContributions')}</h3>
      <div className="mt-1.5 divide-y divide-ldvh-border/45">
        {contributions.map((target) => (
          <WorkCaseContributionTargetRow
            key={target.objectUid ?? `${target.governedProjectId}/${target.factTypeKey}/${target.objectId}`}
            target={target}
            locale={locale}
            onOpenTarget={onOpenTarget}
          />
        ))}
      </div>
    </section>
  );
}

/** Targets resolve on demand exactly like the detail relation rows; titles are never duplicated into the Card. */
function WorkCaseContributionTargetRow({ target, locale, showStatus = true, compact = false, onOpenTarget }: { target: WorkCaseContributionTarget; locale: string; showStatus?: boolean; compact?: boolean; onOpenTarget?: (target: WorkCaseContributionTarget, title: string) => void }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [readState, setReadState] = useState<'loading' | 'resolved' | 'unavailable'>('loading');

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (!target.factTypeKey || !target.objectId) {
      setReadState('unavailable');
      return () => { cancelled = true; };
    }
    setReadState('loading');
    fetchObjectDetail(target.factTypeKey, target.objectId)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
          setReadState('resolved');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setReadState('unavailable');
        }
      });
    return () => { cancelled = true; };
  }, [target.factTypeKey, target.objectId]);

  const readMeta = getFactReadMeta(detail?.data);
  const readable = Boolean(detail && isReadableFact(readMeta));
  const title = contributionTargetTitle(detail, readMeta, locale);
  const targetStatus = showStatus && readable && target.factTypeKey && typeof detail?.data.status === 'string'
    ? getObjectStatusLocale(target.factTypeKey, detail.data.status, locale)
    : null;
  const readStatus = readable
    ? null
    : readState === 'loading'
      ? t('objectList.workcaseTargetReading')
      : getFieldValueLabel('read_status', readMeta.readStatus ?? 'unreadable', locale);
  const typeColor = target.factTypeKey ? (CATEGORY_COLORS[target.factTypeKey] || CATEGORY_COLORS.other) : CATEGORY_COLORS.other;
  const canOpenTarget = Boolean(onOpenTarget && target.factTypeKey && target.objectId);
  const rowClassName = `flex min-w-0 items-center gap-2 rounded-md px-1.5 text-left ${compact ? 'pb-1 pt-1.5' : 'py-2'}`;
  const rowContent = (
    <>
      <ObjectTypeIcon type={target.factTypeKey} size={13} className="shrink-0" style={{ color: typeColor }} />
      <span className="ldvh-meta-primary min-w-0 flex-1 whitespace-normal break-words text-left">
        {title}
      </span>
      {canOpenTarget && <ArrowRight size={13} className="shrink-0 text-ldvh-text-secondary/70" aria-hidden="true" />}
      {targetStatus && <span className="ldvh-meta-muted shrink-0">{targetStatus}</span>}
      {readStatus && <span className="ldvh-meta-muted shrink-0">{readStatus}</span>}
    </>
  );

  if (onOpenTarget && canOpenTarget) {
    return (
      <button
        type="button"
        onClick={() => onOpenTarget(target, title)}
        className={`${rowClassName} w-full cursor-pointer transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50`}
      >
        {rowContent}
      </button>
    );
  }

  return (
    <div className={rowClassName}>{rowContent}</div>
  );
}

function contributionTargetTitle(detail: ObjectDetail | null, readMeta: ReturnType<typeof getFactReadMeta>, locale: string): string {
  if (!detail || !isReadableFact(readMeta)) return '—';
  return getLocalizedObjectTitle(detail.data as { title?: string; title_en?: string; title_zh?: string }, locale);
}

function sortObjectsForList(items: ObjectItem[], sort: ObjectListSort): ObjectItem[] {
  return [...items].sort((a, b) => {
    const timestampDelta = sort === 'created_desc'
      ? compareRfc3339Timestamps(b.created, a.created)
      : compareRfc3339Timestamps(b.updated, a.updated);
    if (timestampDelta !== 0) return timestampDelta;
    return b.id.localeCompare(a.id);
  });
}


// eslint-disable-next-line react-refresh/only-export-components
export function ObjectCardFrame({
  obj,
  locale,
  onOpen,
  children,
  showNonActiveReason = true,
  displayStatus,
}: {
  obj: ObjectItem;
  locale: string;
  onOpen: (objId: string) => void;
  children?: ReactNode;
  showNonActiveReason?: boolean;
  displayStatus?: string;
}) {
  const { t } = useI18n();
  const { selectedProjectId } = useProjectScope();
  // 20 §9：Spark 状态闭集直接呈现（open/implemented/discarded）——v4 从关联
  // 推导 settled/unclosed 展示态的逻辑已随规范移除。
  const presentedStatus = displayStatus ?? obj.status;
  const typeColor = CATEGORY_COLORS[obj.type] || CATEGORY_COLORS.other;
  const activityCount = Array.isArray(obj.change_log) ? obj.change_log.length : 0;
  const nonActiveReason = getNonActiveReason(obj, t);
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-ldvh-border bg-ldvh-panel p-3 text-left"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="ldvh-chip-sm"
            style={{ backgroundColor: `${typeColor}18`, borderColor: `${typeColor}55`, color: typeColor }}
          >
            {getTypeLabel(obj.type, locale)}
          </span>
          <ServesSgBadge value={obj.serves_sg} locale={locale} />
          <PriorityIcon source={obj} type={obj.type} locale={locale} size="xs" />
          <span
            className="ldvh-chip-sm gap-1 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent"
            title={t('cognition.recent.activityCount', { count: String(activityCount) })}
          >
            <History size={12} aria-hidden="true" />
            <span>{activityCount}</span>
          </span>
          {obj.sourceBranch && (
            <span className="ldvh-chip-sm gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              {t('objectList.sourceBranch', { branch: obj.sourceBranch })}
            </span>
          )}
          {obj.mainWorktreeDiffers && (
            <span className="ldvh-chip-sm gap-1 border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400">
              {t('objectList.mainWorktreeDiffers')}
            </span>
          )}
        </div>
        {/* List cards expose a stable object identity, not an exact-read source path. */}
        <ObjectIdentityActions
          status={presentedStatus}
          statusLabel={getObjectStatusLocale(obj.type, presentedStatus, locale)}
          objectType={obj.type}
          projectId={selectedProjectId}
          target={obj.id}
          statusLeadingBadges={<WorkCaseCapabilityStatusBadge source={obj} />}
          copyLabel={t('common.copyObjectId')}
          copiedLabel={t('common.copiedObjectId')}
          compact
        />
      </div>
      {/* Keep a neutral title tray for card hierarchy; semantic colour belongs to the icon, never the tray border. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(obj.id)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onOpen(obj.id);
        }}
        className="ldvh-object-title-tray ldvh-object-title-tray-compact -mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 px-2.5 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
      >
        <ObjectTypeIcon type={obj.type} size={14} className="shrink-0" style={{ color: typeColor }} />
        <h2 className="ldvh-card-title min-w-0 flex-1 whitespace-normal break-words">
          {getLocalizedObjectTitle(obj, locale)}
        </h2>
      </div>
      {showNonActiveReason && nonActiveReason && <StatusReasonNote reason={nonActiveReason} />}
      {children}
      <FactAssociationsCardContent associations={obj.factAssociations} />
      {/* Keep the identity → title → update rhythm stable; grid stretch leaves any spare space below. */}
      <div className="mt-1 flex min-w-0 items-center justify-end pt-0.5 text-right opacity-70">
        <ObjectUpdatedMeta source={obj} updatedAt={obj.updated} />
      </div>
    </div>
  );
}

function hasSparkDiscardFact(obj: ObjectItem) {
  return obj.status === 'discarded';
}

function hasSparkImplementedFact(obj: ObjectItem) {
  return obj.status === 'implemented';
}

function TerminalFactPanel({
  tone,
  content,
}: {
  tone: 'implemented' | 'retired';
  content: string;
}) {
  const styles = {
    implemented: {
      panel: 'border-slate-400/25 border-l-slate-400 bg-slate-500/5',
      body: 'text-slate-600/75 dark:text-slate-300/75',
    },
    retired: {
      panel: 'border-zinc-400/25 border-l-zinc-400 bg-zinc-500/5',
      body: 'text-zinc-600/75 dark:text-zinc-300/75',
    },
  }[tone];

  return (
    <section
      onClick={(event) => event.stopPropagation()}
      className={`min-w-0 cursor-default rounded-md border border-l-2 px-3.5 py-3 ${styles.panel}`}
    >
      <div className="ldvh-terminal-fact-content min-w-0 break-words">
        <SummaryText value={content} collapseThreshold={Number.MAX_SAFE_INTEGER} className={`ldvh-card-decision-body [&_p]:my-0 ${styles.body}`} />
      </div>
    </section>
  );
}

function SparkTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  // 20 §8：终态去向由 disposition 承载（进入终态时必填）。
  const reason = obj.disposition?.trim() || t('objectList.dispositionMissing');

  return (
    <TerminalFactPanel tone={obj.status === 'implemented' ? 'implemented' : 'retired'} content={formatReasonText(reason)} />
  );
}

function FactAssociationsCardContent({ associations }: { associations?: FactCardAssociation[] }) {
  const { t, locale } = useI18n();
  if (!associations || associations.length === 0) return null;
  const visibleAssociations = dedupeFactCardAssociations(associations)
    .map((association, index) => ({ association, index }))
    .sort((left, right) => {
      const rankDelta = getFactAssociationStateRank(left.association) - getFactAssociationStateRank(right.association);
      return rankDelta !== 0 ? rankDelta : left.index - right.index;
    })
    .map(({ association }) => association);
  if (visibleAssociations.length === 0) return null;

  return (
    <section onClick={(event) => event.stopPropagation()} className="min-w-0 border-t border-ldvh-border/60 pt-1.5">
      <div className="divide-y divide-ldvh-border/45">
        {visibleAssociations.map((association, index) => <FactAssociationCardRow key={`${association.target && 'objectUid' in association.target ? association.target.objectUid : `${association.target?.governedProjectId ?? 'unavailable'}:${association.target?.factTypeKey ?? 'unknown'}:${association.target?.objectId ?? index}`}:${index}`} association={association} locale={locale} unavailableLabel={t('objectList.associationUnavailable')} />)}
      </div>
    </section>
  );
}

function isDiscardedWorkCaseAssociation(association: FactCardAssociation): boolean {
  return associationLocator(association)?.factTypeKey === 'workcase'
    && association.status === 'closed'
    && association.closureOutcome === 'cancelled';
}

function associationLocator(association: FactCardAssociation) {
  if (association.resolvedTarget) return association.resolvedTarget;
  return association.target && !('objectUid' in association.target) ? association.target : null;
}

function dedupeFactCardAssociations(associations: FactCardAssociation[]): FactCardAssociation[] {
  const seenTargets = new Set<string>();
  return associations.filter((association) => {
    const target = association.target;
    if (!target) return true;
    const targetKey = 'objectUid' in target
      ? `uid\u0000${target.objectUid}`
      : `${target.governedProjectId}\u0000${target.factTypeKey}\u0000${target.objectId}`;
    if (seenTargets.has(targetKey)) return false;
    seenTargets.add(targetKey);
    return true;
  });
}

function FactAssociationCardRow({ association, locale, unavailableLabel }: { association: FactCardAssociation; locale: string; unavailableLabel: string }) {
  const { t } = useI18n();
  const target = association.target;
  const title = association.available
    ? getLocalizedObjectTitle(association, locale)
    : unavailableLabel;
  const legacyTarget = associationLocator(association);
  const typeColor = legacyTarget ? (CATEGORY_COLORS[legacyTarget.factTypeKey] || CATEGORY_COLORS.other) : CATEGORY_COLORS.other;
  const { openPanel } = usePanel();
  const canOpen = Boolean(association.available && legacyTarget);
  const associationState = getFactAssociationState(association);
  const isDiscarded = associationState === 'discarded';
  const associationStateTooltip = associationState === null ? null : {
    pending: t('objectList.associationState.pending'),
    closed: t('objectList.associationState.closed'),
    discarded: t('objectList.associationState.discarded'),
    progressing: t('objectList.associationState.progressing'),
    active: t('objectList.associationState.active'),
  }[associationState];
  const open = () => {
    if (!canOpen || !legacyTarget) return;
    openPanel({ type: 'object', title, objectType: legacyTarget.factTypeKey, objectId: legacyTarget.objectId });
  };
  return (
    <div
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : -1}
      onClick={open}
      onKeyDown={(event) => {
        if (!canOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        open();
      }}
      className={`group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors ${isDiscarded ? 'text-slate-400/70 dark:text-slate-500/70' : ''} ${canOpen ? (isDiscarded ? 'cursor-pointer hover:bg-slate-500/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/30' : 'cursor-pointer hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50') : 'cursor-default'}`}
    >
      <ObjectTypeIcon type={legacyTarget?.factTypeKey} size={13} className={`shrink-0 ${isDiscarded ? 'text-slate-400/65 dark:text-slate-500/60' : ''}`} style={isDiscarded ? undefined : { color: typeColor }} />
      <span className={`ldvh-meta-primary min-w-0 flex-1 whitespace-normal break-words ${isDiscarded ? 'text-slate-400/65 dark:text-slate-500/60' : 'text-ldvh-text-secondary/95 group-hover:text-ldvh-accent'}`}>{title}</span>
      {associationState !== null && associationStateTooltip !== null && <FactAssociationStateIcon state={associationState} tooltip={associationStateTooltip} />}
    </div>
  );
}

type FactAssociationState = 'pending' | 'closed' | 'discarded' | 'progressing' | 'active';

const FACT_ASSOCIATION_STATE_RANK: Record<FactAssociationState, number> = {
  active: 0,
  progressing: 1,
  pending: 2,
  closed: 3,
  discarded: 4,
};

function getFactAssociationState(association: FactCardAssociation): FactAssociationState | null {
  if (!association.available || !association.status) return null;
  const targetType = associationLocator(association)?.factTypeKey;
  if (targetType === 'spark') {
    if (association.status === 'open') return 'pending';
    if (association.status === 'discarded') return 'discarded';
    if (association.status === 'implemented') return 'closed';
  }
  if (targetType === 'pitfall') {
    if (association.status === 'draft') return 'pending';
    if (association.status === 'discarded') return 'discarded';
  }
  if (targetType === 'workcase') {
    if (isDiscardedWorkCaseAssociation(association)) return 'discarded';
    if (association.status === 'closed') return 'closed';
    if (association.progressGroup === 'plan_confirmation' || association.progressGroup === 'closure_confirmation') return 'pending';
    if (association.progressGroup === 'progressing' || association.progressGroup === 'termination_cleanup') return 'progressing';
  }
  if (association.status === 'retired') return 'discarded';
  return 'active';
}

function getFactAssociationStateRank(association: FactCardAssociation): number {
  const state = getFactAssociationState(association);
  return state === null ? Number.MAX_SAFE_INTEGER : FACT_ASSOCIATION_STATE_RANK[state];
}

function FactAssociationStateIcon({ state, tooltip }: { state: FactAssociationState; tooltip: string }) {
  if (state === 'pending') {
    return (
      <span title={tooltip} aria-label={tooltip} className="shrink-0 text-amber-500 dark:text-amber-400">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 12V3a9 9 0 0 1 9 9Z" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  const presentation = {
    closed: { Icon: CircleCheck, className: 'text-emerald-500 dark:text-emerald-400' },
    discarded: { Icon: CircleMinus, className: 'text-slate-400/70 dark:text-slate-500/70' },
    progressing: { Icon: CirclePlay, className: 'text-sky-500 dark:text-sky-400' },
    active: { Icon: Activity, className: 'text-ldvh-accent' },
  }[state];
  const { Icon } = presentation;
  return (
    <span title={tooltip} aria-label={tooltip} className={`shrink-0 ${presentation.className}`}>
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}

export function SparkCardContent({ obj }: { obj: ObjectItem }) {
  // 活跃（open）卡片保持克制：question/scope_boundary/summary 在详情阅读布局
  // 呈现（与 2026-09-09 Research 活跃卡片同款裁定；20 §12 F1 允许投影但不强制）。
  const terminal = hasSparkDiscardFact(obj) || hasSparkImplementedFact(obj);
  return terminal ? <SparkTerminalCardContent obj={obj} /> : null;
}

function PitfallTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  const disposition = obj.disposition_summary?.trim() || t('objectList.dispositionMissing');

  return (
    <TerminalFactPanel tone="retired" content={formatReasonText(disposition)} />
  );
}

const PITFALL_DECISION_FIELDS = [
  'symptoms',
  'trigger_conditions',
  'scope_of_impact',
  'resolution',
  'avoidance',
  'validation_summary',
  'applicability',
] as const;

// eslint-disable-next-line react-refresh/only-export-components
export function PitfallCardContent({ obj }: { obj: ObjectItem }) {
  const { locale } = useI18n();
  if (obj.status === 'discarded') return <PitfallTerminalCardContent obj={obj} />;
  if (obj.status === 'active') return null;
  const fields = PITFALL_DECISION_FIELDS
    .map((field) => ({ field, value: obj[field] }))
    .filter((entry): entry is { field: typeof PITFALL_DECISION_FIELDS[number]; value: string } => (
      typeof entry.value === 'string' && entry.value.trim().length > 0
    ));
  if (fields.length === 0) return null;

  return (
    <div className="grid min-w-0 gap-2">
      {fields.map(({ field, value }) => (
        <section key={field} className="min-w-0 rounded-md border border-amber-400/20 border-l-2 border-l-amber-400/70 bg-amber-500/[0.025] px-3.5 py-3">
          <h3 className="ldvh-card-decision-title text-amber-700/85 dark:text-amber-200/85">
            {getFieldLabel(field, locale)}
          </h3>
          <div className={`${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} min-w-0 break-words`}>
            <SummaryText
              value={value}
              collapseThreshold={420}
              className="ldvh-card-decision-body [&_p]:my-0 text-amber-950/70 dark:text-amber-100/75"
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function AdrTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t, locale } = useI18n();
  // 22 §9：ADR 终态原因由 retirement_reason 承载（闭集 superseded/outdated/
  // out-of-scope）；v4 disposition_summary 已不属 ADR 字段闭集。
  const rawReason = typeof obj.retirement_reason === 'string' && obj.retirement_reason.trim()
    ? obj.retirement_reason.trim()
    : '';
  const reason = rawReason
    ? getFieldValueLabel('retirement_reason', rawReason, locale)
    : t('objectList.dispositionMissing');

  return (
    <TerminalFactPanel tone="retired" content={formatReasonText(reason)} />
  );
}

export function AdrCardContent({ obj }: { obj: ObjectItem }) {
  if (obj.status === 'retired') return <AdrTerminalCardContent obj={obj} />;
  return null;
}

function ResearchTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t, locale } = useI18n();
  // 24 §9：Research 终态原因由 retirement_reason 承载（闭集含 rejected）；
  // v4 disposition_summary 已不属 24 号字段闭集。
  const rawReason = typeof obj.retirement_reason === 'string' && obj.retirement_reason.trim()
    ? obj.retirement_reason.trim()
    : '';
  const reason = rawReason
    ? getFieldValueLabel('retirement_reason', rawReason, locale)
    : t('objectList.dispositionMissing');

  return (
    <TerminalFactPanel tone="retired" content={formatReasonText(reason)} />
  );
}

export function ResearchCardContent({ obj }: { obj: ObjectItem }) {
  if (obj.status === 'retired') return <ResearchTerminalCardContent obj={obj} />;
  // Human 2026-09-09 定：活跃状态的调研卡片不显示研究问题/调研目的/停止原因
  // 块——这些字段在详情页阅读布局呈现，列表卡片保持克制（24 §12 F1 允许投影
  // 但不强制；需要核对原文时 YAML 源节点有排序后的 frontmatter）。
  return null;
}

export default function ObjectList() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [statusOptions, setStatusOptions] = useState<ObjectStatusOption[]>([]);
  const [progressOptions, setProgressOptions] = useState<WorkCaseProgressOption[]>([]);
  const [priorityOptions, setPriorityOptions] = useState<ObjectStatusOption[]>([]);
  const [statusTotal, setStatusTotal] = useState(0);
  const [coverageStatus, setCoverageStatus] = useState<FactCoverageStatus>('complete');
  const [coverageProblemCount, setCoverageProblemCount] = useState(0);
  const [coverageProblems, setCoverageProblems] = useState<FactListProblem[]>([]);
  const [objectSearch, setObjectSearch] = useState('');
  const [isObjectSearchOpen, setIsObjectSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t, locale } = useI18n();

  const currentType = type ?? 'workcase';
  const statusParam = searchParams.get('status');
  const activeStatus = currentType === 'workcase' ? null : getEffectiveListStatus(currentType, statusParam);
  const progressParam = searchParams.get('progress');
  const activeProgressGroup = currentType === 'workcase' && (isWorkCaseProgressGroup(progressParam) || progressParam === 'discarded')
    ? progressParam as WorkCaseListGroup
    : null;
  const priorityParam = searchParams.get('priority');
  const sortParam = searchParams.get('sort');
  const activeSort: ObjectListSort = sortParam === 'created_desc' ? sortParam : 'updated_desc';
  // 优先级导航仅 WorkCase 保留（v4 字段，21 号定稿前不动）；Spark 已按
  // 20 §8/§14.2 移除 priority——v5 火花无此字段，不再提供过滤。
  const supportsPriorityNavigation = currentType === 'workcase';
  const activePriority = supportsPriorityNavigation && ['P0', 'P1', 'P2', 'P3'].includes(priorityParam ?? '')
    ? priorityParam
    : null;
  const isPriorityApplicable = currentType === 'workcase'
    && activeProgressGroup !== 'closed' && activeProgressGroup !== 'discarded';

  useEffect(() => {
    const removesLegacyCategory = currentType === 'spark' && searchParams.has('category');
    const removesWorkCaseStatus = currentType === 'workcase' && searchParams.has('status');
    const removesForeignProgress = currentType !== 'workcase' && searchParams.has('progress');
    if (!removesLegacyCategory && !removesWorkCaseStatus && !removesForeignProgress) return;
    const nextParams = new URLSearchParams(searchParams);
    if (removesLegacyCategory) nextParams.delete('category');
    if (removesWorkCaseStatus) nextParams.delete('status');
    if (removesForeignProgress) nextParams.delete('progress');
    setSearchParams(nextParams, { replace: true });
  }, [currentType, searchParams, setSearchParams]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setStatusOptions([]);
    setProgressOptions([]);
    setPriorityOptions([]);
    setStatusTotal(0);
    setCoverageStatus('complete');
    setCoverageProblemCount(0);
    setCoverageProblems([]);
    fetchObjects(currentType, activeStatus ?? undefined, activePriority ?? undefined, activeProgressGroup ?? undefined)
      .then((result) => {
        const receivedItems = result.data?.items ?? [];
        const nextItems = receivedItems
          .filter((item) => !isDeprecatedListCard(item) || searchParams.get('status') === ALL_STATUS_PARAM || activeStatus === item.status);
        setItems(nextItems);
        setStatusOptions(result.data?.statusOptions ?? []);
        setProgressOptions(result.data?.progressOptions ?? []);
        setPriorityOptions(result.data?.priorityOptions ?? []);
        setStatusTotal(result.data?.statusTotal ?? nextItems.length);
        setCoverageStatus(result.data?.coverage_status ?? 'complete');
        const nextCoverageProblems = result.data?.collection_issues ?? [];
        setCoverageProblems(nextCoverageProblems);
        setCoverageProblemCount(nextCoverageProblems.length);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentType, activeStatus, activePriority, activeProgressGroup, statusParam]);

  const sortedItems = sortObjectsForList(items, activeSort);
  const normalizedObjectSearch = objectSearch.trim().toLowerCase();
  let filteredItems = normalizedObjectSearch
    ? sortedItems.filter((item) => {
      const title = getLocalizedObjectTitle(item, locale).toLowerCase();
      const objectId = item.id.toLowerCase();
      return title.includes(normalizedObjectSearch) || objectId.includes(normalizedObjectSearch);
    })
    : sortedItems;

  const handleStatusChange = (status: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    writeListStatusParam(currentType, nextParams, status);
    setSearchParams(nextParams);
  };

  const handleProgressGroupChange = (group: WorkCaseListGroup | null) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('status');
    if (group) nextParams.set('progress', group);
    else nextParams.delete('progress');
    setSearchParams(nextParams);
  };

  const handlePriorityChange = (priority: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (priority) {
      nextParams.set('priority', priority);
    } else {
      nextParams.delete('priority');
    }
    setSearchParams(nextParams);
  };

  const handleSortChange = (sort: ObjectListSort) => {
    const nextParams = new URLSearchParams(searchParams);
    if (sort === 'updated_desc') nextParams.delete('sort');
    else nextParams.set('sort', sort);
    setSearchParams(nextParams);
  };

  const detailSearch = searchParams.toString();
  const returnToListPath = `${location.pathname}${location.search}`;
  const openObject = (objId: string) => {
    navigate(`/objects/${currentType}/${objId}${detailSearch ? `?${detailSearch}` : ''}`, {
      state: { from: returnToListPath },
    });
  };

  const renderObjectSearch = () => (
    <div className="relative h-7 w-8 shrink-0">
      {isObjectSearchOpen ? (
        <label className="absolute right-0 top-0 z-30 flex w-60 items-center">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-ldvh-text-secondary" aria-hidden="true" />
          <input
            autoFocus
            type="search"
            value={objectSearch}
            onChange={(event) => setObjectSearch(event.target.value)}
            onBlur={() => setIsObjectSearchOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.blur();
              }
            }}
            aria-label={t('objectList.searchLabel')}
            placeholder={t('objectList.searchPlaceholder')}
            className="h-[26px] w-full rounded-md border border-ldvh-border bg-ldvh-panel py-1 pl-8 pr-2 text-xs leading-4 text-ldvh-text-primary outline-none placeholder:text-ldvh-text-secondary/70 focus:border-ldvh-accent/60 focus:ring-1 focus:ring-ldvh-accent/30"
          />
        </label>
      ) : (
        <button
          type="button"
          onClick={() => setIsObjectSearchOpen(true)}
          aria-label={t('objectList.searchLabel')}
          aria-expanded={false}
          className={`ldvh-tab-button h-7 w-8 justify-center !px-0 !py-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50 ${normalizedObjectSearch ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
        >
          <Search size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const renderObjectCard = (obj: ObjectItem) => {

    if (currentType === 'workcase') {
      const currentProjection = isResolvedWorkCasePresentationProjection(obj.current_snapshot_projection)
        ? obj.current_snapshot_projection
        : null;
      const progressGroup = currentProjection?.progress_group ?? null;
      const displayProgressGroup = progressGroup === 'termination_cleanup' ? 'closed' : progressGroup;
      const progressStep = currentProjection?.progress_step ?? null;
      if (progressGroup === 'plan_confirmation') {
        return (
          <ObjectCardFrame
            key={obj.id}
            obj={obj}
            locale={locale}
            onOpen={openObject}
            showNonActiveReason={false}
            displayStatus={progressGroup}
          >
            <>
              <WorkCasePlanConfirmationContent
                mode="card"
                goal={obj.goal}
                successCriteria={obj.successCriteria}
                successCriterionDefinitions={obj.success_criterion_definitions}
                executionAuthorization={obj.execution_authorization}
                isBlocked={currentProjection?.blocking_overlay ?? false}
                blockingSummary={obj.blocking_summary}
                t={t}
              />
            </>
          </ObjectCardFrame>
        );
      }
      if (progressGroup === 'progressing') {
        return (
          <ObjectCardFrame
            key={obj.id}
            obj={obj}
            locale={locale}
            onOpen={openObject}
            showNonActiveReason={false}
            displayStatus="progressing"
          >
            <WorkCaseProgressingContent
              goal={obj.goal}
              lifecyclePosition={currentProjection?.lifecycle_position ?? null}
              progressStep={progressStep}
              executionItemsProjectionValid={obj.executionItemsProjectionValid ?? false}
              executionItems={obj.executionItems ?? []}
              isBlocked={currentProjection?.blocking_overlay ?? false}
              waitingOn={obj.waiting_on}
              blockingSummary={obj.blocking_summary}
              t={t}
            />
          </ObjectCardFrame>
        );
      }
      if (displayProgressGroup === 'closure_confirmation') {
        return (
          <ObjectCardFrame
            key={obj.id}
            obj={obj}
            locale={locale}
            onOpen={openObject}
            showNonActiveReason={false}
            displayStatus="closure_confirmation"
          >
            <WorkCaseClosureConfirmationContent goal={obj.goal} closureProposal={obj.closureProposal} />
          </ObjectCardFrame>
        );
      }
      if (displayProgressGroup === 'closed') {
        const displayStatus = obj.closure_outcome === 'cancelled' ? 'discarded' : 'closed';
        return (
          <ObjectCardFrame
            key={obj.id}
            obj={obj}
            locale={locale}
            onOpen={openObject}
            showNonActiveReason={false}
            displayStatus={displayStatus}
          >
            <WorkCaseClosedContent goal={obj.goal} terminal={obj.closureTerminal} termination={obj.termination} />
          </ObjectCardFrame>
        );
      }
      return (
        <ObjectCardFrame
          key={obj.id}
          obj={obj}
          locale={locale}
          onOpen={openObject}
          showNonActiveReason={false}
          displayStatus={progressGroup ?? 'unknown'}
        >
          {!progressGroup && (
            <p className="ldvh-card-decision-body rounded-md border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-red-400">
              {t('objectList.workcaseProgressGroupUnavailable')}
            </p>
          )}
        </ObjectCardFrame>
      );
    }

    if (currentType === 'adr') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <AdrCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'pitfall') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <PitfallCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'spark') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <SparkCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'research') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <ResearchCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }


    return (
      <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject}>
      </ObjectCardFrame>
    );
  };

  return (
    <div className="ldvh-page-frame">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-4 min-h-8 border-b border-ldvh-border bg-ldvh-bg/95 px-6 py-3 backdrop-blur">
        {supportsPriorityNavigation && isPriorityApplicable && (
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ObjectPriorityFilter
              activePriority={activePriority}
              onChange={handlePriorityChange}
              options={priorityOptions}
              loading={loading}
              coverageStatus={coverageStatus}
            />
          </div>
        )}
        <div className="relative flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
            {currentType === 'workcase' ? (
              <>
                <span className="ldvh-meta shrink-0 text-ldvh-text-secondary">{t('objectList.progressGroupFilter')}</span>
                <WorkCaseProgressFilter
                  activeGroup={activeProgressGroup}
                  onChange={handleProgressGroupChange}
                  options={progressOptions}
                  total={statusTotal}
                  loading={loading}
                  coverageStatus={coverageStatus}
                />
              </>
            ) : (
              <>
                {currentType === 'spark' || currentType === 'research' ? <span className="ldvh-meta shrink-0 text-ldvh-text-secondary">{t('objectList.lifecycleFilter')}</span> : null}
                <ObjectStatusFilter
                  type={currentType}
                  activeStatus={activeStatus}
                  onChange={handleStatusChange}
                  options={statusOptions}
                  total={statusTotal}
                  loading={loading}
                />
              </>
            )}
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
            {renderObjectSearch()}
            <SegmentedControl
              ariaLabel={t('objectList.sort')}
              value={activeSort}
              onValueChange={handleSortChange}
              items={[
                { value: 'updated_desc', label: t('objectList.sortUpdatedDesc'), icon: <Clock3 size={14} aria-hidden="true" /> },
                { value: 'created_desc', label: t('objectList.sortCreatedDesc'), icon: <CalendarClock size={14} aria-hidden="true" /> },
              ]}
            />
          </div>
        </div>
      </div>

      {!loading && !error && (coverageStatus !== 'complete' || coverageProblemCount > 0) && (
        <div
          role="status"
          className={`mb-4 flex min-w-0 items-start gap-2 rounded-lg border px-4 py-3 ${
            coverageStatus === 'unavailable'
              ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
              : coverageStatus === 'partial' || coverageStatus === 'type_not_integrated'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
          }`}
        >
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="ldvh-body">
              {coverageStatus === 'type_not_integrated'
                ? t('objectList.typeNotIntegrated')
                : coverageStatus === 'complete'
                ? t(currentType === 'workcase' ? 'objectList.workcaseObjectProblems' : 'objectList.objectProblems')
                : coverageStatus === 'partial'
                ? t(currentType === 'workcase' ? 'objectList.workcaseCoveragePartial' : 'objectList.coveragePartial')
                : t(currentType === 'workcase' ? 'objectList.workcaseCoverageUnavailable' : 'objectList.coverageUnavailable')}
            </p>
            {coverageProblemCount > 0 && (
              <details className="mt-2">
                <summary className="ldvh-meta cursor-pointer">
                  {t(currentType === 'workcase' ? 'objectList.workcaseCoverageProblemCount' : 'objectList.coverageProblemCount', { count: String(coverageProblemCount) })}
                </summary>
                <ul className="mt-2 grid gap-2">
                  {coverageProblems.map((problem, index) => {
                    const problemIdentity = problem.object_ref?.object_id
                      ?? t(currentType === 'workcase' ? 'objectList.workcaseCoverageCollectionScope' : 'objectList.coverageCollectionScope');
                    return (
                    <li key={`${problem.object_ref?.object_id ?? problem.scope ?? 'scope'}-${index}`} className="rounded-md border border-current/20 px-3 py-2">
                      <div className="ldvh-meta-primary break-all font-mono">
                        {problemIdentity}
                      </div>
                      {problem.read_status && (
                        <div className="ldvh-meta mt-1">
                          {getFieldValueLabel('read_status', problem.read_status, locale)}
                        </div>
                      )}
                      {(problem.message ?? problem.error ?? problem.code) && (
                        <p className="ldvh-meta mt-1 break-words">
                          {problem.message ?? problem.error ?? problem.code}
                        </p>
                      )}
                    </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ldvh-accent border-t-transparent" />
        </div>
      ) : error ? (
        currentType === 'workcase' ? (
          <div className="mx-auto max-w-2xl rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-8 text-center">
            <CircleAlert className="mx-auto mb-3 text-red-400" size={24} />
            <p className="ldvh-card-title text-red-700 dark:text-red-300">{t('objectList.workcaseCoverageUnavailable')}</p>
            <p className="ldvh-meta mt-2 break-words text-red-700/80 dark:text-red-300/80">{error}</p>
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="ldvh-body-muted">{t('common.loadFailed')}</p>
            <p className="ldvh-meta text-red-400">{error}</p>
          </div>
        )
      ) : coverageStatus === 'type_not_integrated' ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('objectList.typeNotIntegrated')}
        </div>
      ) : coverageStatus === 'unavailable' ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t(currentType === 'workcase' ? 'objectList.workcaseCoverageUnavailableEmpty' : 'objectList.coverageUnavailableEmpty')}
        </div>
      ) : filteredItems.length === 0 && normalizedObjectSearch ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('objectList.searchNoResults')}
        </div>
      ) : filteredItems.length === 0 && coverageStatus === 'partial' ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t(currentType === 'workcase' ? 'objectList.workcaseCoveragePartialEmpty' : 'objectList.coveragePartialEmpty')}
        </div>
      ) : filteredItems.length === 0 && coverageProblemCount > 0 ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t(currentType === 'workcase' ? 'objectList.workcaseObjectProblemsEmpty' : 'objectList.objectProblemsEmpty')}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('objectList.noObjects', { type: currentType })}
        </div>
      ) : (
        <div className="ldvh-section-grid">
          {filteredItems.map((obj) => renderObjectCard(obj))}
        </div>
      )}
    </div>
  );
}
