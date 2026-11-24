import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowDownWideNarrow, CalendarClock, CircleAlert, Clock3, History, Search } from 'lucide-react';
import ObjectIdentityActions from '@/components/ObjectIdentityActions';
import SegmentedControl from '@/components/SegmentedControl';
import ObjectStatusFilter from '@/components/ObjectStatusFilter';
import ReportFormFilter from '@/components/ReportFormFilter';
import { FORM_ORDER, FORM_PALETTE, type ReportForm } from '@/utils/reportFormPalette';
import ObjectPriorityFilter from '@/components/ObjectPriorityFilter';
import ObjectServesFilter from '@/components/ObjectServesFilter';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import PriorityIcon from '@/components/PriorityIcon';
import FrictionOccurrenceBadge from '@/components/FrictionOccurrenceBadge';
import SubGoalOrderBadge from '@/components/SubGoalOrderBadge';
import { SubGoalCriterionSurface, SubGoalServingWorkZone } from '@/components/SubGoalCardParts';
import SummaryText from '@/components/SummaryText';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import {
  dedupeFactCardAssociations,
  FactAssociationCardRow,
  factCardAssociationKey,
  getFactAssociationStateRank,
  FACT_ASSOCIATION_ROWS_LIST_CLASS,
  FACT_ASSOCIATION_ROWS_ZONE_CLASS,
} from '@/components/FactAssociationRows';

import { fetchObjects, type FactCardAssociation, type FactCoverageStatus, type FactListProblem, type ObjectItem, type ObjectStatusOption, type ServingWorkItem } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { getFieldLabel, getFieldValueLabel, getLocalizedObjectTitle, getObjectStatusDisplayLabel, getTypeLabel } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import {
  DECISION_AMBER_BODY_HUE_CLASS,
  DECISION_CARD_SHELL_CLASS,
  DECISION_TITLE_HUE_CLASS,
} from '@/utils/decisionBlocks';
import { ALL_STATUS_PARAM, getEffectiveListStatus, writeListStatusParam } from '@/utils/listStatus';
import { stripCardMarkdown as formatReasonText } from '@/utils/cardText';
import { useProjectScope } from '@/utils/projectContext';
import { compareRfc3339Timestamps } from '@/shared/timestamp';
import { LDVH_ERROR_TEXT_CLASS, LDVH_INFO_CHIP_HUE_CLASS, LDVH_WARN_CHIP_HUE_CLASS } from '@/utils/semanticColors';

type Translate = ReturnType<typeof useI18n>['t'];
type StatusReason = { label: string; text: string; missing?: boolean };
type ObjectListSort = 'updated_desc' | 'created_desc' | 'priority_asc';

const SPARK_PRIORITY_SORT_ORDER: readonly string[] = ['P0', 'P1', 'P2', 'P3'];

function sparkPrioritySortRank(priority: unknown): number {
  const index = typeof priority === 'string' ? SPARK_PRIORITY_SORT_ORDER.indexOf(priority) : -1;
  return index === -1 ? SPARK_PRIORITY_SORT_ORDER.length : index;
}

const CARD_TITLE_BODY_GAP_CLASS = 'mt-1.5';

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
  const disposition = obj.disposition;
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
        isMissing ? LDVH_ERROR_TEXT_CLASS : 'text-ldvh-text-secondary/75'
      }`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isMissing ? 'bg-red-400' : 'bg-ldvh-text-secondary/75'}`} aria-hidden="true" />
        <span className="min-w-0 truncate">{reason.label}</span>
      </div>
      <p className={`ldvh-card-decision-body whitespace-pre-wrap break-words ${
        isMissing ? LDVH_ERROR_TEXT_CLASS : 'text-ldvh-text-secondary/75'
      }`}
      >
        {reason.text}
      </p>
    </div>
  );
}


function sortObjectsForList(items: ObjectItem[], sort: ObjectListSort): ObjectItem[] {
  return [...items].sort((a, b) => {
    if (sort === 'priority_asc') {
      const priorityDelta = sparkPrioritySortRank(a.priority) - sparkPrioritySortRank(b.priority);
      if (priorityDelta !== 0) return priorityDelta;
      const sameTierTimeDelta = compareRfc3339Timestamps(b.updated, a.updated);
      if (sameTierTimeDelta !== 0) return sameTierTimeDelta;
      return b.id.localeCompare(a.id);
    }
    const timestampDelta = sort === 'created_desc'
      ? compareRfc3339Timestamps(b.created, a.created)
      : compareRfc3339Timestamps(b.updated, a.updated);
    if (timestampDelta !== 0) return timestampDelta;
    return b.id.localeCompare(a.id);
  });
}


export function ObjectCardFrame({
  obj,
  locale,
  onOpen,
  children,
  showNonActiveReason = true,
  displayStatus,
  showAssociations = true,
  servesOrder,
}: {
  obj: ObjectItem;
  locale: string;
  onOpen: (objId: string) => void;
  children?: ReactNode;
  showNonActiveReason?: boolean;
  displayStatus?: string;
  showAssociations?: boolean;
  servesOrder?: number;
}) {
  const { t } = useI18n();
  const { selectedProjectId } = useProjectScope();
  const presentedStatus = displayStatus ?? obj.status;
  const typeColor = CATEGORY_COLORS[obj.type] || CATEGORY_COLORS.other;
  const activityCount = Array.isArray(obj.change_log) ? obj.change_log.length : 0;
  const cardStatusLabel = getObjectStatusDisplayLabel(obj.type, presentedStatus, locale, obj.pre_audit_passed);
  const nonActiveReason = getNonActiveReason(obj, t);
  return (
    <div
      className="ldvh-object-card-frame"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="ldvh-chip-sm"
            style={{ backgroundColor: `${typeColor}18`, borderColor: `${typeColor}55`, color: typeColor }}
          >
            {getTypeLabel(obj.type, locale)}
          </span>
          { }
          {obj.type === 'report' && typeof obj.report_form === 'string' && obj.report_form.length > 0 && (() => {
            const form = obj.report_form as ReportForm;
            const palette = FORM_PALETTE[form];
            return (
              <span
                className="ldvh-chip-sm"
                style={palette
                  ? { backgroundColor: palette.bg, borderColor: palette.border, color: palette.text }
                  : undefined}
              >
                {getFieldValueLabel('report_form', obj.report_form, locale)}
              </span>
            );
          })()}
          { }
          <PriorityIcon source={obj} type={obj.type} locale={locale} size="xs" />
          { }
          {obj.type === 'spark' && servesOrder !== undefined && <SubGoalOrderBadge value={servesOrder} />}
          { }
          {obj.type === 'friction' && <FrictionOccurrenceBadge value={obj.occurrence} />}
          { }
          {obj.type === 'subgoal' && <SubGoalOrderBadge value={obj.order} />}
          <span
            className="ldvh-chip-sm gap-1 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent"
            title={t('cognition.recent.activityCount', { count: String(activityCount) })}
          >
            <History size={12} aria-hidden="true" />
            <span>{activityCount}</span>
          </span>
          { }
          {obj.sourceBranch && (
            <span className={`ldvh-chip-sm gap-1 ${LDVH_WARN_CHIP_HUE_CLASS}`}>
              {t('objectList.sourceBranch', { branch: obj.sourceBranch })}
            </span>
          )}
          {obj.mainWorktreeDiffers && (
            <span className={`ldvh-chip-sm gap-1 ${LDVH_INFO_CHIP_HUE_CLASS}`}>
              {t('objectList.mainWorktreeDiffers')}
            </span>
          )}
        </div>
        { }
        <ObjectIdentityActions
          status={presentedStatus}
          statusLabel={cardStatusLabel}
          objectType={obj.type}
          projectId={selectedProjectId}
          target={obj.id}
          copyLabel={t('common.copyObjectId')}
          copiedLabel={t('common.copiedObjectId')}
          compact
        />
      </div>
      { }
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
      {showAssociations && <FactAssociationsCardContent associations={obj.factAssociations} refs={obj.factRefs} />}
      { }
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
      panel: 'border-emerald-400/25 bg-emerald-500/5',
      body: 'text-emerald-700/75 dark:text-emerald-300/75',
    },
    retired: {
      panel: 'border-zinc-400/25 bg-zinc-500/5',
      body: 'text-zinc-600/75 dark:text-zinc-300/75',
    },
  }[tone];

  return (
    <section
      onClick={(event) => event.stopPropagation()}
      className={`min-w-0 cursor-default rounded-md border px-3.5 py-3 ${styles.panel}`}
    >
      <div className="ldvh-terminal-fact-content min-w-0 break-words">
        <SummaryText value={content} collapseThreshold={Number.MAX_SAFE_INTEGER} className={`ldvh-card-decision-body [&_p]:my-0 ${styles.body}`} />
      </div>
    </section>
  );
}

function SparkTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  const reason = obj.disposition?.trim() || t('objectList.dispositionMissing');

  return (
    <TerminalFactPanel tone={obj.status === 'implemented' ? 'implemented' : 'retired'} content={formatReasonText(reason)} />
  );
}



function FactAssociationsCardContent({ associations, refs }: { associations?: FactCardAssociation[]; refs?: FactCardAssociation[] }) {
  const { t, locale } = useI18n();
  const rows = [
    ...(associations ?? []).map((association) => ({ association, source: 'relations' as const })),
    ...(refs ?? []).map((association) => ({ association, source: 'refs' as const })),
  ];
  if (rows.length === 0) return null;
  const visibleRows = dedupeFactCardAssociations(rows)
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const rankDelta = getFactAssociationStateRank(left.row.association) - getFactAssociationStateRank(right.row.association);
      return rankDelta !== 0 ? rankDelta : left.index - right.index;
    })
    .map(({ row }) => row);
  if (visibleRows.length === 0) return null;

  return (
    <section onClick={(event) => event.stopPropagation()} className={FACT_ASSOCIATION_ROWS_ZONE_CLASS}>
      <div className={FACT_ASSOCIATION_ROWS_LIST_CLASS}>
        {visibleRows.map(({ association, source }, index) => <FactAssociationCardRow key={`${source}:${factCardAssociationKey(association, index)}:${index}`} association={association} locale={locale} unavailableLabel={t('objectList.associationUnavailable')} />)}
      </div>
    </section>
  );
}


export function SparkCardContent({ obj }: { obj: ObjectItem }) {
  const terminal = hasSparkDiscardFact(obj) || hasSparkImplementedFact(obj);
  return terminal ? <SparkTerminalCardContent obj={obj} /> : null;
}

function PitfallTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  const disposition = obj.disposition?.trim() || t('objectList.dispositionMissing');

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
        <section key={field} className={DECISION_CARD_SHELL_CLASS.amber}>
          <h3 className={`ldvh-card-decision-title ${DECISION_TITLE_HUE_CLASS.amber}`}>
            {getFieldLabel(field, locale)}
          </h3>
          <div className={`${CARD_TITLE_BODY_GAP_CLASS} min-w-0 break-words`}>
            <SummaryText
              value={value}
              collapseThreshold={420}
              className={`ldvh-card-decision-body [&_p]:my-0 ${DECISION_AMBER_BODY_HUE_CLASS}`}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function ResearchTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t, locale } = useI18n();
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
  return null;
}

function FrictionTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  const reason = typeof obj.disposition === 'string' && obj.disposition.trim()
    ? obj.disposition.trim()
    : t('objectList.dispositionMissing');

  return <TerminalFactPanel tone="retired" content={formatReasonText(reason)} />;
}

export function FrictionCardContent({ obj }: { obj: ObjectItem }) {
  if (obj.status === 'voided' || obj.status === 'accepted') return <FrictionTerminalCardContent obj={obj} />;
  return null;
}

function NormTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t, locale } = useI18n();
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

export function NormCardContent({ obj }: { obj: ObjectItem }) {
  if (obj.status === 'retired') return <NormTerminalCardContent obj={obj} />;
  return null;
}

function SubGoalTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  const disposition = typeof obj.disposition === 'string' && obj.disposition.trim()
    ? obj.disposition.trim()
    : '';
  if (obj.status === 'achieved') {
    return <TerminalFactPanel tone="implemented" content={t('objectList.subGoalAchievedNote')} />;
  }
  return (
    <TerminalFactPanel
      tone="retired"
      content={formatReasonText(disposition || t('objectList.dispositionMissing'))}
    />
  );
}


function SubGoalServingWorkCardZone({ obj }: { obj: ObjectItem }) {
  const rows: ServingWorkItem[] = Array.isArray(obj.serving_work) ? obj.serving_work : [];
  const unreadable = Array.isArray(obj.serving_unreadable) ? obj.serving_unreadable : [];
  return <SubGoalServingWorkZone rows={rows} unreadable={unreadable} />;
}

export function SubGoalCardContent({ obj }: { obj: ObjectItem }) {
  const body = obj.status === 'achieved' || obj.status === 'retired'
    ? <SubGoalTerminalCardContent obj={obj} />
    : <SubGoalActiveCardBody obj={obj} />;
  return (
    <>
      {body}
      <SubGoalServingWorkCardZone obj={obj} />
    </>
  );
}

function SubGoalActiveCardBody({ obj }: { obj: ObjectItem }) {
  const criterion = typeof obj.criterion === 'string' ? obj.criterion.trim() : '';
  if (!criterion) return null;

  return <SubGoalCriterionSurface criterion={criterion} type={obj.type} />;
}

export default function ObjectList() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [statusOptions, setStatusOptions] = useState<ObjectStatusOption[]>([]);
  const [formOptions, setFormOptions] = useState<ObjectStatusOption[]>([]);
  const [formTotal, setFormTotal] = useState(0);
  const [priorityOptions, setPriorityOptions] = useState<ObjectStatusOption[]>([]);
  const [priorityTotal, setPriorityTotal] = useState(0);
  const [servesOptions, setServesOptions] = useState<ObjectStatusOption[]>([]);
  const [servesTotal, setServesTotal] = useState(0);
  const [servesOrders, setServesOrders] = useState<Record<string, number>>({});
  const [statusTotal, setStatusTotal] = useState(0);
  const [statusDisplayTotal, setStatusDisplayTotal] = useState(0);
  const [coverageStatus, setCoverageStatus] = useState<FactCoverageStatus>('complete');
  const [coverageProblemCount, setCoverageProblemCount] = useState(0);
  const [coverageProblems, setCoverageProblems] = useState<FactListProblem[]>([]);
  const [objectSearch, setObjectSearch] = useState('');
  const [isObjectSearchOpen, setIsObjectSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t, locale } = useI18n();

  const currentType = type ?? 'spark';
  const statusParam = searchParams.get('status');
  const activeStatus = getEffectiveListStatus(currentType, statusParam);
  const formParam = searchParams.get('form');
  const supportsFormNavigation = currentType === 'report';
  const activeForm: ReportForm | null = supportsFormNavigation
    && formParam !== null && (FORM_ORDER as readonly string[]).includes(formParam)
    ? (formParam as ReportForm)
    : null;
  const priorityParam = searchParams.get('priority');
  const supportsPriorityNavigation = currentType === 'spark';
  const activePriority = supportsPriorityNavigation
    && (priorityParam === 'P0' || priorityParam === 'P1' || priorityParam === 'P2' || priorityParam === 'P3')
    ? priorityParam
    : null;
  const servesParam = searchParams.get('serves');
  const supportsServesNavigation = currentType === 'spark';
  const activeServes = supportsServesNavigation && servesParam ? servesParam : null;
  const sortParam = searchParams.get('sort');
  const supportsPrioritySort = currentType === 'spark';
  const activeSort: ObjectListSort = supportsPrioritySort && sortParam === 'priority_asc'
    ? 'priority_asc'
    : sortParam === 'created_desc' ? 'created_desc' : 'updated_desc';

  useEffect(() => {
    const removesLegacyCategory = currentType === 'spark' && searchParams.has('category');
    const removesForeignProgress = searchParams.has('progress');
    if (!removesLegacyCategory && !removesForeignProgress) return;
    const nextParams = new URLSearchParams(searchParams);
    if (removesLegacyCategory) nextParams.delete('category');
    if (removesForeignProgress) nextParams.delete('progress');
    setSearchParams(nextParams, { replace: true });
  }, [currentType, searchParams, setSearchParams]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setStatusOptions([]);
    setFormOptions([]);
    setPriorityOptions([]);
    setServesOptions([]);
    setServesOrders({});
    setStatusTotal(0);
    setCoverageStatus('complete');
    setCoverageProblemCount(0);
    setCoverageProblems([]);
    fetchObjects(currentType, activeStatus ?? undefined, undefined, activePriority ?? undefined, activeForm ?? undefined, activeServes ?? undefined)
      .then((result) => {
        const receivedItems = result.data?.items ?? [];
        const nextItems = receivedItems
          .filter((item) => !isDeprecatedListCard(item) || searchParams.get('status') === ALL_STATUS_PARAM || activeStatus === item.status);
        setItems(nextItems);
        setStatusOptions(result.data?.statusOptions ?? []);
        setFormOptions(result.data?.formOptions ?? []);
        setFormTotal(result.data?.formTotal ?? nextItems.length);
        setPriorityOptions(result.data?.priorityOptions ?? []);
        setPriorityTotal(result.data?.priorityTotal ?? nextItems.length);
        setServesOptions(result.data?.servesOptions ?? []);
        setServesTotal(result.data?.servesTotal ?? nextItems.length);
        setServesOrders(result.data?.servesOrders ?? {});
        setStatusTotal(result.data?.statusTotal ?? nextItems.length);
        setStatusDisplayTotal(result.data?.statusDisplayTotal ?? nextItems.length);
        setCoverageStatus(result.data?.coverage_status ?? 'complete');
        const nextCoverageProblems = result.data?.collection_issues ?? [];
        setCoverageProblems(nextCoverageProblems);
        setCoverageProblemCount(nextCoverageProblems.length);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentType, activeStatus, activePriority, statusParam, activeForm, activeServes]);

  const sortedItems = sortObjectsForList(items, activeSort);
  const normalizedObjectSearch = objectSearch.trim().toLowerCase();
  const filteredItems = normalizedObjectSearch
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

  const handleFormChange = (form: ReportForm | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (form) nextParams.set('form', form);
    else nextParams.delete('form');
    setSearchParams(nextParams);
  };

  const handlePriorityChange = (priority: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (priority) nextParams.set('priority', priority);
    else nextParams.delete('priority');
    setSearchParams(nextParams);
  };

  const handleServesChange = (serves: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (serves) nextParams.set('serves', serves);
    else nextParams.delete('serves');
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
            className="h-[26px] w-full rounded-md border border-ldvh-border bg-ldvh-panel py-1 pl-8 pr-2 ldvh-caption leading-4 text-ldvh-text-primary outline-none placeholder:text-ldvh-text-secondary/70 focus:border-ldvh-accent/60 focus:ring-1 focus:ring-ldvh-accent/30"
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

    if (currentType === 'pitfall') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <PitfallCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'spark') {
      return (
        <ObjectCardFrame
          key={obj.id}
          obj={obj}
          locale={locale}
          onOpen={openObject}
          showNonActiveReason={false}
          servesOrder={typeof obj.serves === 'string' ? servesOrders[obj.serves] : undefined}
        >
          <SparkCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'report') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <ResearchCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'friction') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <FrictionCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'norm') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <NormCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'subgoal') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <SubGoalCardContent obj={obj} />
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
      <div className="ldvh-page-topbar mb-4 min-h-8">
        { }
        { }
        {supportsFormNavigation && formOptions.length > 0 && (
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ReportFormFilter
              activeForm={activeForm}
              onChange={handleFormChange}
              options={formOptions}
              total={formTotal}
              loading={loading}
            />
          </div>
        )}
        {supportsPriorityNavigation && priorityOptions.length > 0 && (
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ObjectPriorityFilter
              activePriority={activePriority}
              onChange={handlePriorityChange}
              options={priorityOptions}
              totalCount={priorityTotal}
              loading={loading}
              coverageStatus={coverageStatus}
            />
          </div>
        )}
        {supportsServesNavigation && servesOptions.length > 0 && (
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ObjectServesFilter
              activeServes={activeServes}
              onChange={handleServesChange}
              options={servesOptions}
              servesOrders={servesOrders}
              totalCount={servesTotal}
              loading={loading}
              coverageStatus={coverageStatus}
            />
          </div>
        )}
        { }
        <div className="relative flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
            <ObjectStatusFilter
              type={currentType}
              activeStatus={activeStatus}
              onChange={handleStatusChange}
              options={statusOptions}
              total={currentType === 'spark' ? statusDisplayTotal : statusTotal}
              loading={loading}
            />
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
                ...supportsPrioritySort
                  ? [{ value: 'priority_asc' as const, label: t('objectList.sortPriorityAsc'), icon: <ArrowDownWideNarrow size={14} aria-hidden="true" /> }]
                  : [],
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
                ? t('objectList.objectProblems')
                : coverageStatus === 'partial'
                ? t('objectList.coveragePartial')
                : t('objectList.coverageUnavailable')}
            </p>
            {coverageProblemCount > 0 && (
              <details className="mt-2">
                <summary className="ldvh-meta cursor-pointer">
                  {t('objectList.coverageProblemCount', { count: String(coverageProblemCount) })}
                </summary>
                <ul className="mt-2 grid gap-2">
                  {coverageProblems.map((problem, index) => {
                    const problemIdentity = problem.object_ref?.object_id
                      ?? t('objectList.coverageCollectionScope');
                    return (
                    <li key={`${problem.object_ref?.object_id ?? 'scope'}-${index}`} className="rounded-md border border-current/20 px-3 py-2">
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

      { }
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="ldvh-spinner" />
        </div>
      ) : error ? (
        (
          <div className="py-20 text-center">
            <p className="ldvh-body-muted">{t('common.loadFailed')}</p>
            <p className={`ldvh-meta ${LDVH_ERROR_TEXT_CLASS}`}>{error}</p>
          </div>
        )
      ) : coverageStatus === 'type_not_integrated' ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('objectList.typeNotIntegrated')}
        </div>
      ) : coverageStatus === 'unavailable' ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('objectList.coverageUnavailableEmpty')}
        </div>
      ) : filteredItems.length === 0 && normalizedObjectSearch ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('objectList.searchNoResults')}
        </div>
      ) : filteredItems.length === 0 && coverageStatus === 'partial' ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('objectList.coveragePartialEmpty')}
        </div>
      ) : filteredItems.length === 0 && coverageProblemCount > 0 ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('objectList.objectProblemsEmpty')}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="ldvh-body-muted py-20 text-center">
          {statusTotal === 0
            ? t('objectList.noObjects', { type: getTypeLabel(currentType, locale) })
            : t('objectList.noObjectsUnderFilter', { type: getTypeLabel(currentType, locale) })}
        </div>
      ) : (
        <div className="ldvh-section-grid">
          {filteredItems.map((obj) => renderObjectCard(obj))}
        </div>
      )}
    </div>
  );
}
