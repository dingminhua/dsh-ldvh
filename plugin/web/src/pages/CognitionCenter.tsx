import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, HeartPulse, History, Inbox } from 'lucide-react';
import ProjectScopeBar from '@/components/ProjectScopeBar';
import GoalSection from '@/components/GoalSection';
import ObjectReferenceCopyButton from '@/components/ObjectReferenceCopyButton';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import FrictionOccurrenceBadge from '@/components/FrictionOccurrenceBadge';
import {
  FrictionCardContent,
  ObjectCardFrame,
} from '@/pages/ObjectList';
import StatusBadge from '@/components/StatusBadge';
import PriorityIcon from '@/components/PriorityIcon';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import {
  fetchCognition,
  type CognitionData,
  type CognitionInboxItem,
  type CognitionInboxKind,
  type CognitionIssue,
  type CognitionRecentActivityItem,
  type CognitionRecentActivityAttributionUsage,
  type CognitionRecentActivityWindow,
  type CognitionSparkHealthItem,
  type ObjectItem,
} from '@/utils/api';
import { usePanel } from '@/utils/panelContext';
import { useProjectScope } from '@/utils/projectContext';
import { useI18n } from '@/i18n/context';
import { getLocalizedObjectTitle, getObjectStatusDisplayLabel, getObjectStatusLocale, getTypeLabel, type LocaleKey } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { getDefaultSparkHealthAgeFilter, type SparkHealthAgeFilter } from '@/utils/cognitionSparkHealth';
import { LDVH_ERROR_TEXT_CLASS } from '@/utils/semanticColors';
import FieldReadNotes from '@/components/FieldReadNotes';

const INBOX_FIRST_SCREEN_LIMIT = 8;
const RECENT_ACTIVITY_FIRST_SCREEN_LIMIT = 6;
const RECENT_ACTIVITY_MAX_VISIBLE = Number.MAX_SAFE_INTEGER;
const SPARK_HEALTH_FIRST_SCREEN_LIMIT = 6;
const SPARK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

const RECENT_ACTIVITY_WINDOWS: CognitionRecentActivityWindow[] = ['1d', '3d', '7d'];
const SPARK_HEALTH_AGE_FILTERS: SparkHealthAgeFilter[] = ['all', '3d', '7d'];


const INBOX_KIND_LABEL_KEYS: Record<CognitionInboxKind, LocaleKey> = {
  friction_repair: 'cognition.kind.friction_repair',
};

type Translate = ReturnType<typeof useI18n>['t'];

function formatHumanObjectReference(type: string, title: string, locale: string): string {
  return `${getTypeLabel(type, locale)}《${title}》`;
}

/* eslint-disable @typescript-eslint/no-unused-vars*/
function buildModuleSummary(data: CognitionData, locale: string, t: Translate): string {
  const lines: string[] = [];
  lines.push(t('cognition.inbox.title'));
  const counts: Record<CognitionInboxKind, number> = {
    friction_repair: 0,
  };
  for (const item of data.inbox.items) counts[item.inboxKind] += 1;
  const countParts = (Object.keys(counts) as CognitionInboxKind[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${t(INBOX_KIND_LABEL_KEYS[kind])} ${counts[kind]}`);
  lines.push(`total: ${data.inbox.total}${countParts.length > 0 ? ` (${countParts.join(', ')})` : ''}`);
  if (data.frictionLedger && data.frictionLedger.acceptedCount > 0) {
    lines.push(t('cognition.frictionLedger.accepted', { count: String(data.frictionLedger.acceptedCount) }));
  }
  for (const item of data.inbox.items) {
    lines.push(`- ${formatHumanObjectReference(item.type, getLocalizedObjectTitle(item, locale, item.id), locale)} · ${t(INBOX_KIND_LABEL_KEYS[item.inboxKind])}`);
  }
  return lines.join('\n');
}

function buildRecentActivitySummary(data: CognitionData, locale: string, t: Translate): string {
  const recent = data.recentActivity;
  const lines = [
    t('cognition.recent.title'),
    t(`cognition.recent.window.${recent.window}` as LocaleKey),
    `facts: ${recent.total}`,
    `events: ${recent.eventTotal}`,
  ];
  for (const item of recent.items) {
    lines.push(`- ${formatHumanObjectReference(item.type, getLocalizedObjectTitle(item, locale, item.id), locale)} · ${item.activityCount}`);
  }
  return lines.join('\n');
}


function buildSparkHealthSummary(data: CognitionData, locale: string, t: Translate): string {
  const health = data.sparkHealth;
  if (!health) return t('cognition.sparkHealth.title');
  const terminal = (['implemented', 'discarded'] as const)
    .filter((status) => health.terminalByStatus[status] > 0)
    .map((status) => `${getObjectStatusLocale('spark', status, locale)} ${health.terminalByStatus[status]}`)
    .join(', ');
  const lines = [
    t('cognition.sparkHealth.title'),
    `${t('cognition.sparkHealth.settled', { count: String(health.terminalTotal) })}${terminal ? ` (${terminal})` : ''}`,
    t('cognition.sparkHealth.pending', { count: String(health.openTotal) }),
  ];
  for (const item of health.openItems) {
    lines.push(`- ${formatHumanObjectReference('spark', getLocalizedObjectTitle(item, locale, item.id), locale)} · ${t('cognition.sparkHealth.silentDays', { days: String(item.silentDays) })}`);
  }
  return lines.join('\n');
}

/* eslint-enable @typescript-eslint/no-unused-vars*/

type CognitionCardItem = CognitionInboxItem;

function InboxItemReadNotes({ item, locale }: { item: CognitionCardItem; locale: string }) {
  return <FieldReadNotes source={item} locale={locale} className="mt-2" />;
}

function InboxCardContent({ item }: { item: CognitionInboxItem }) {
  if (item.type === 'friction') return <FrictionCardContent obj={toObjectCard(item)} />;
  return null;
}

function toObjectCard(item: CognitionCardItem): ObjectItem {
  return {
    ...(item.card as unknown as ObjectItem),
    id: item.id,
    type: item.type,
    title: item.title,
    ...(item.title_en ? { title_en: item.title_en } : {}),
    ...(item.title_zh ? { title_zh: item.title_zh } : {}),
    status: item.status,
    path: item.canonical_path ?? '',
    updated: item.updatedAt ?? '',
    ...(item.priority ? { priority: item.priority } : {}),
    object_id: item.id,
    fact_type_key: item.type,
    ...(item.object_uid !== undefined ? { object_uid: item.object_uid } : {}),
    ...(item.canonical_path ? { canonical_path: item.canonical_path } : {}),
    read_status: item.read_status as ObjectItem['read_status'],
  };
}


function InboxItemRow({ item }: { item: CognitionInboxItem }) {
  const { locale } = useI18n();
  const { openPanel } = usePanel();
  const title = getLocalizedObjectTitle(item, locale, item.id);
  const objectCard = toObjectCard(item);

  return (
    <li className="min-w-0">
      <ObjectCardFrame
        obj={objectCard}
        locale={locale}
        onOpen={() => openPanel({ type: 'object', title, objectType: item.type, objectId: item.id })}
      >
        <InboxCardContent item={item} />
        <InboxItemReadNotes item={item} locale={locale} />
      </ObjectCardFrame>
    </li>
  );
}

function ModuleIssuesNotice({ issues, t, unavailableKey = 'cognition.inbox.unavailable' }: { issues: CognitionIssue[]; t: Translate; unavailableKey?: LocaleKey }) {
  if (issues.length === 0) return null;
  return (
    <div role="status" className="mb-3 min-w-0 rounded-md border border-red-400/25 bg-red-500/5 px-2.5 py-2">
      <p className="ldvh-caption text-red-500 dark:text-red-300">{t(unavailableKey)}</p>
      <ul className="mt-1 grid min-w-0 gap-0.5">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className={`ldvh-caption break-words ${LDVH_ERROR_TEXT_CLASS}`}>
            [{issue.code}] {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentActivityReadNotes({ item, locale }: { item: CognitionRecentActivityItem; locale: string }) {
  return <FieldReadNotes source={item} locale={locale} />;
}

function ActivityCountBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      className="ldvh-chip-sm gap-1 shrink-0 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent"
      title={label}
    >
      <History size={12} aria-hidden="true" />
      <span>{count}</span>
    </span>
  );
}

function RecentActivityRow({ item }: { item: CognitionRecentActivityItem }) {
  const { t, locale } = useI18n();
  const { selectedProjectId } = useProjectScope();
  const { openPanel } = usePanel();
  const title = getLocalizedObjectTitle(item, locale, item.id);
  const status = item.status;
  const typeColor = CATEGORY_COLORS[item.type] || CATEGORY_COLORS.other;
  const open = () => openPanel({ type: 'object', title, objectType: item.type, objectId: item.id });
  return (
    <li className="ldvh-object-card-frame">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="ldvh-caption shrink-0 text-ldvh-text-secondary">{item.relativeTime}</span>
        <span
          className="ldvh-chip-sm shrink-0"
          style={{ backgroundColor: `${typeColor}18`, borderColor: `${typeColor}55`, color: typeColor }}
        >
          {getTypeLabel(item.type, locale)}
        </span>
        { }
        <PriorityIcon source={item} type={item.type} locale={locale} size="xs" />
        { }
        {item.type === 'friction' && <FrictionOccurrenceBadge value={item.occurrence} />}
        <ActivityCountBadge count={item.activityCount} label={t('cognition.recent.activityCount', { count: String(item.activityCount) })} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          { }
          {status && item.type !== 'goal' && <StatusBadge status={status} statusLabel={getObjectStatusDisplayLabel(item.type, status, locale, item.pre_audit_passed)} objectType={item.type} size="xs" variant="compact" />}
          <ObjectReferenceCopyButton projectId={selectedProjectId} objectId={item.type === 'goal' ? 'ldvh-base/goal.md' : item.id} />
        </span>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => openOnKeyboard(event, open)}
        className="group ldvh-object-title-tray ldvh-object-title-tray-compact -mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 px-2.5 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
      >
        <ObjectTypeIcon type={item.type} size={15} className="shrink-0" style={{ color: item.typeColor }} />
        <h4 className="ldvh-card-title min-w-0 flex-1 whitespace-normal break-words group-hover:text-ldvh-accent">{title}</h4>
      </div>
      <RecentActivityReadNotes item={item} locale={locale} />
      <div className="flex min-w-0 items-center justify-end text-right opacity-70">
        <ObjectUpdatedMeta source={{}} updatedAt={item.occurredAt} signature={item.signature} />
      </div>
    </li>
  );
}

function RecentActivityUsageBars({
  title,
  items,
  expanded,
}: {
  title: string;
  items: CognitionRecentActivityAttributionUsage[];
  expanded: boolean;
}) {
  const visibleItems = items.slice(0, expanded ? RECENT_ACTIVITY_MAX_VISIBLE : RECENT_ACTIVITY_FIRST_SCREEN_LIMIT);
  const max = Math.max(...visibleItems.map((item) => item.count), 1);
  return (
    <section className="min-w-0" aria-label={title}>
      <h4 className="ldvh-caption-strong text-ldvh-text-secondary">{title}</h4>
      {visibleItems.length === 0 ? (
        <p className="mt-2 ldvh-caption text-ldvh-text-secondary/70">—</p>
      ) : (
        <ul className="mt-2 grid min-w-0 gap-2">
          {visibleItems.map((item) => (
            <li key={item.value} className="grid min-w-0 gap-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="ldvh-caption min-w-0 truncate text-ldvh-text-primary" title={item.value}>{item.value}</span>
                <span className="ldvh-caption shrink-0 tabular-nums text-ldvh-text-secondary">{item.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ldvh-border/70" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={item.count}>
                <div className="h-full rounded-full bg-ldvh-accent/75" style={{ width: `${(item.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SparkHealthRow({ item }: { item: CognitionSparkHealthItem }) {
  const { t, locale } = useI18n();
  const { selectedProjectId } = useProjectScope();
  const { openPanel } = usePanel();
  const title = getLocalizedObjectTitle(item, locale, item.id);
  const open = () => openPanel({ type: 'object', title, objectType: 'spark', objectId: item.id });
  const fieldIssues = item.field_issues ?? [];
  const unparsed = item.unparsed_structures ?? [];
  const showReadNotes = item.read_status !== 'readable' || fieldIssues.length > 0 || unparsed.length > 0;
  return (
    <li className="ldvh-object-card-frame">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="ldvh-caption shrink-0 text-amber-700/85 dark:text-amber-300/85">
          {t('cognition.sparkHealth.silentDays', { days: String(item.silentDays) })}
        </span>
        <span
          className="ldvh-chip-sm shrink-0"
          style={{ backgroundColor: `${item.typeColor}18`, borderColor: `${item.typeColor}55`, color: item.typeColor }}
        >
          {getTypeLabel(item.type, locale)}
        </span>
        <PriorityIcon source={item} type="spark" locale={locale} size="xs" />
        <ActivityCountBadge count={item.activityCount} label={t('cognition.recent.activityCount', { count: String(item.activityCount) })} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusBadge status="open" statusLabel={getObjectStatusLocale('spark', 'open', locale)} objectType="spark" size="xs" variant="compact" />
          <ObjectReferenceCopyButton projectId={selectedProjectId} objectId={item.id} />
        </span>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => openOnKeyboard(event, open)}
        className="group ldvh-object-title-tray ldvh-object-title-tray-compact -mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 px-2.5 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
      >
        <ObjectTypeIcon type="spark" size={15} className="shrink-0" style={{ color: item.typeColor }} />
        <h4 className="ldvh-card-title min-w-0 flex-1 whitespace-normal break-words group-hover:text-ldvh-accent">{title}</h4>
      </div>
      {showReadNotes && <FieldReadNotes source={item} locale={locale} />}
      <div className="flex min-w-0 items-center justify-end text-right opacity-70">
        <ObjectUpdatedMeta source={{}} updatedAt={item.updatedAt} signature={item.signature} />
      </div>
    </li>
  );
}

function openOnKeyboard(event: KeyboardEvent<HTMLDivElement>, open: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  open();
}

function toggleOnKeyboard(event: KeyboardEvent<HTMLDivElement>, toggle: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggle();
}

export default function CognitionCenter({ embedded = false }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<CognitionData | null>(null);
  const hasSnapshotRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [inboxExpanded, setInboxExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [recentWindow, setRecentWindow] = useState<CognitionRecentActivityWindow>('1d');
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showAllRecentUsage, setShowAllRecentUsage] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [sparkHealthExpanded, setSparkHealthExpanded] = useState(true);
  const [sparkHealthAgeFilter, setSparkHealthAgeFilter] = useState<SparkHealthAgeFilter>('7d');
  const [showAllSpark, setShowAllSpark] = useState(false);
  const { t, locale } = useI18n();

  useEffect(() => {
    let cancelled = false;
    const hasCurrentData = hasSnapshotRef.current;
    setError(null);
    setRecentError(null);
    if (hasCurrentData) setRecentLoading(true);
    fetchCognition(locale, recentWindow)
      .then((next) => {
        if (!cancelled) {
          hasSnapshotRef.current = true;
          setData(next);
          setSparkHealthAgeFilter(getDefaultSparkHealthAgeFilter(next.sparkHealth?.openItems ?? []));
          setRecentLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setRecentLoading(false);
          if (hasCurrentData) setRecentError(e.message);
          else setError(e.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locale, recentWindow]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle size={32} className={`mx-auto mb-2 ${LDVH_ERROR_TEXT_CLASS}`} />
          <p className="text-ldvh-text-secondary">{t('common.loadFailed')}</p>
          <p className={`ldvh-meta ${LDVH_ERROR_TEXT_CLASS}`}>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="ldvh-spinner" />
      </div>
    );
  }

  const inboxIssues = (data.issues ?? []).filter((issue) => issue.section === 'inbox');
  const items = data.inbox.items;
  const truncated = !showAll && items.length > INBOX_FIRST_SCREEN_LIMIT;
  const visibleItems = truncated ? items.slice(0, INBOX_FIRST_SCREEN_LIMIT) : items;

  const recentIssues = (data.issues ?? []).filter((issue) => issue.section === 'recentActivity');
  const recentItems = data.recentActivity.items;
  const recentVisibleLimit = showAllRecent ? RECENT_ACTIVITY_MAX_VISIBLE : RECENT_ACTIVITY_FIRST_SCREEN_LIMIT;
  const visibleRecentItems = recentItems.slice(0, recentVisibleLimit);
  const recentTruncated = visibleRecentItems.length < recentItems.length;
  const recentUsageTotal = Math.max(data.recentActivity.modelUsage.length, data.recentActivity.environmentUsage.length);
  const recentUsageTruncated = recentUsageTotal > RECENT_ACTIVITY_FIRST_SCREEN_LIMIT;
  const sparkHealth = data.sparkHealth;
  const sparkHealthIssues = (data.issues ?? []).filter((issue) => issue.section === 'sparkHealth');
  const openSparkItems = sparkHealth?.openItems ?? [];
  const filteredSparkItems = openSparkItems.filter((item) => (
    sparkHealthAgeFilter === 'all'
      || item.silentDays >= (sparkHealthAgeFilter === '3d' ? 3 : 7)
  ));
  const sparkItemsTruncated = !showAllSpark && filteredSparkItems.length > SPARK_HEALTH_FIRST_SCREEN_LIMIT;
  const visibleSparkItems = sparkItemsTruncated ? filteredSparkItems.slice(0, SPARK_HEALTH_FIRST_SCREEN_LIMIT) : filteredSparkItems;
  const settledRatio = sparkHealth && sparkHealth.total > 0 ? (sparkHealth.terminalTotal / sparkHealth.total) * 100 : 0;
  const terminalDetail = sparkHealth
    ? (['implemented', 'discarded'] as const)
      .filter((status) => sparkHealth.terminalByStatus[status] > 0)
      .map((status) => `${getObjectStatusLocale('spark', status, locale)} ${sparkHealth.terminalByStatus[status]}`)
      .join(' · ')
    : '';
  const openPriorityDetail = sparkHealth
    ? SPARK_PRIORITIES
      .filter((priority) => (sparkHealth.openByPriority[priority] ?? 0) > 0)
      .map((priority) => `${priority} × ${sparkHealth.openByPriority[priority]}`)
      .join(' / ')
    : '';
  return (
    <div className={`flex min-h-full flex-col${embedded ? '' : ' p-6'}`}>
      <div className="ldvh-page-topbar mb-4 min-w-0 shrink-0">
        <ProjectScopeBar />
      </div>

      { }
      <GoalSection />

      { }
      <section className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={inboxExpanded}
          aria-controls="cognition-inbox-content"
          onClick={() => setInboxExpanded((expanded) => !expanded)}
          onKeyDown={(event) => toggleOnKeyboard(event, () => setInboxExpanded((expanded) => !expanded))}
          className={`-mx-1 flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 transition-colors hover:bg-ldvh-bg/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50 ${inboxExpanded ? 'mb-4' : ''}`}
        >
          <Inbox size={16} className="shrink-0 text-ldvh-accent" aria-hidden="true" />
          <h3 className="ldvh-section-title min-w-0">{t('cognition.inbox.title')}</h3>
          {data.inbox.total > 0 && (
            <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{data.inbox.total}</span>
          )}
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            <button
              type="button"
              aria-expanded={inboxExpanded}
              aria-controls="cognition-inbox-content"
              onClick={(event) => {
                event.stopPropagation();
                setInboxExpanded((expanded) => !expanded);
              }}
              className="ldvh-icon-button"
              title={t(inboxExpanded ? 'cognition.inbox.collapseSection' : 'cognition.inbox.expandSection')}
            >
              {inboxExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              <span className="sr-only">{t(inboxExpanded ? 'cognition.inbox.collapseSection' : 'cognition.inbox.expandSection')}</span>
            </button>
          </span>
        </div>

        {inboxExpanded && (
          <div id="cognition-inbox-content">
            <ModuleIssuesNotice issues={inboxIssues} t={t} />

            {items.length === 0 ? (
              inboxIssues.length === 0 && <p className="ldvh-body-muted">{t('cognition.inbox.empty')}</p>
            ) : (
              <ul className="ldvh-section-grid min-w-0">
                {visibleItems.map((item) => (
                  <InboxItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}

            { }
            {items.length > INBOX_FIRST_SCREEN_LIMIT && (
              <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <p className="ldvh-caption min-w-0 text-ldvh-text-secondary/55">
                  {truncated
                    ? t('cognition.inbox.truncated', {
                      total: String(data.inbox.total),
                      shown: String(visibleItems.length),
                      hidden: String(items.length - visibleItems.length),
                    })
                    : null}
                </p>
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => !prev)}
                  className="ldvh-caption inline-flex h-8 shrink-0 items-center rounded-md border border-ldvh-border px-3 text-ldvh-text-secondary transition-colors hover:border-ldvh-accent/50 hover:text-ldvh-accent"
                >
                  {truncated ? t('cognition.inbox.showAll') : t('cognition.inbox.collapse')}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="mt-4 ldvh-panel-grid items-start">
        { }
        <section className="order-2 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
        <div className={`-mx-1 flex min-w-0 flex-wrap items-center gap-2 rounded-md px-1 ${recentExpanded ? 'mb-4' : ''}`}>
          <button
            type="button"
            aria-expanded={recentExpanded}
            aria-controls="cognition-recent-activity-content"
            onClick={() => setRecentExpanded((expanded) => !expanded)}
            className="inline-flex min-w-0 items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
          >
            <History size={16} className="shrink-0 text-ldvh-accent" aria-hidden="true" />
            <h3 className="ldvh-section-title min-w-0">{t('cognition.recent.title')}</h3>
            {data.recentActivity.eventTotal > 0 && (
              <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{data.recentActivity.eventTotal}</span>
            )}
          </button>
          <div className="ldvh-tab-list ml-1 flex min-w-0 flex-wrap" aria-label={t('cognition.recent.windowLabel')}>
            {RECENT_ACTIVITY_WINDOWS.map((window) => (
              <button
                key={window}
                type="button"
                aria-pressed={recentWindow === window}
                onClick={() => {
                  setRecentWindow(window);
                  setShowAllRecent(false);
                  setShowAllRecentUsage(false);
                }}
                className={`ldvh-tab-button ${recentWindow === window ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
              >
                {t(`cognition.recent.window.${window}` as LocaleKey)}
              </button>
            ))}
          </div>
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            <button
              type="button"
              aria-expanded={recentExpanded}
              aria-controls="cognition-recent-activity-content"
              onClick={() => setRecentExpanded((expanded) => !expanded)}
              className="ldvh-icon-button"
              title={t(recentExpanded ? 'cognition.recent.collapseSection' : 'cognition.recent.expandSection')}
            >
              {recentExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              <span className="sr-only">{t(recentExpanded ? 'cognition.recent.collapseSection' : 'cognition.recent.expandSection')}</span>
            </button>
          </span>
        </div>

        {recentExpanded && (
          <div id="cognition-recent-activity-content">
            {recentLoading && <p role="status" className="mb-3 ldvh-caption text-ldvh-text-secondary/70">{t('cognition.recent.loading')}</p>}
            {recentError && <p role="status" className={`mb-3 ldvh-caption ${LDVH_ERROR_TEXT_CLASS}`}>{recentError}</p>}
            <ModuleIssuesNotice issues={recentIssues} t={t} />
            { }
            {recentItems.length === 0 ? (
              recentIssues.length === 0 && <p className="ldvh-body-muted">{t('cognition.recent.empty')}</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-3">
                {visibleRecentItems.map((item) => (
                  <RecentActivityRow key={`${item.type}-${item.id}`} item={item} />
                ))}
              </ul>
            )}
            {recentItems.length > RECENT_ACTIVITY_FIRST_SCREEN_LIMIT && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowAllRecent((previous) => !previous)}
                  className="ldvh-caption inline-flex h-8 items-center rounded-md text-ldvh-text-secondary transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:underline"
                >
                  {recentTruncated
                    ? t('cognition.recent.showRemaining', { count: String(recentItems.length - visibleRecentItems.length) })
                    : t('cognition.recent.collapse')}
                </button>
              </div>
            )}
            <div className="mt-4 border-t border-ldvh-border/70 pt-4">
              <div className="ldvh-subgrid">
                <RecentActivityUsageBars
                  title={t('cognition.recent.modelUsage')}
                  items={data.recentActivity.modelUsage}
                  expanded={showAllRecentUsage}
                />
                <RecentActivityUsageBars
                  title={t('cognition.recent.environmentUsage')}
                  items={data.recentActivity.environmentUsage}
                  expanded={showAllRecentUsage}
                />
              </div>
              {recentUsageTruncated && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowAllRecentUsage((previous) => !previous)}
                    className="ldvh-caption inline-flex h-8 items-center rounded-md text-ldvh-text-secondary transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:underline"
                  >
                    {showAllRecentUsage
                      ? t('cognition.recent.collapse')
                      : t('cognition.recent.showRemainingUsage', { count: String(recentUsageTotal - RECENT_ACTIVITY_FIRST_SCREEN_LIMIT) })}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        </section>

        { }
        <section className="order-1 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={sparkHealthExpanded}
          aria-controls="cognition-spark-health-content"
          onClick={() => setSparkHealthExpanded((expanded) => !expanded)}
          onKeyDown={(event) => toggleOnKeyboard(event, () => setSparkHealthExpanded((expanded) => !expanded))}
          className={`-mx-1 flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 transition-colors hover:bg-ldvh-bg/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50 ${sparkHealthExpanded ? 'mb-4' : ''}`}
        >
          <HeartPulse size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <h3 className="ldvh-section-title min-w-0">{t('cognition.sparkHealth.title')}</h3>
          {sparkHealth && (
            <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{filteredSparkItems.length}</span>
          )}
          <div
            className="ldvh-tab-list ml-1 flex min-w-0 flex-wrap"
            role="group"
            aria-label={t('cognition.sparkHealth.ageFilter')}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {SPARK_HEALTH_AGE_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => {
                  setSparkHealthAgeFilter(filter);
                  setShowAllSpark(false);
                }}
                className={`ldvh-tab-button ${sparkHealthAgeFilter === filter ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
              >
                {t(`cognition.sparkHealth.ageFilter.${filter}` as LocaleKey)}
              </button>
            ))}
          </div>
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            <button
              type="button"
              aria-expanded={sparkHealthExpanded}
              aria-controls="cognition-spark-health-content"
              onClick={(event) => {
                event.stopPropagation();
                setSparkHealthExpanded((expanded) => !expanded);
              }}
              className="ldvh-icon-button"
              title={t(sparkHealthExpanded ? 'cognition.sparkHealth.collapseSection' : 'cognition.sparkHealth.expandSection')}
            >
              {sparkHealthExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              <span className="sr-only">{t(sparkHealthExpanded ? 'cognition.sparkHealth.collapseSection' : 'cognition.sparkHealth.expandSection')}</span>
            </button>
          </span>
        </div>

        {sparkHealthExpanded && (
          <div id="cognition-spark-health-content">
            <ModuleIssuesNotice issues={sparkHealthIssues} t={t} unavailableKey="cognition.sparkHealth.unavailable" />
            {sparkHealth && sparkHealth.total > 0 && (
              <div className="border-t border-ldvh-border/70 py-4">
                <div className="flex h-7 w-full overflow-hidden rounded-md bg-rose-500/80">
                  {sparkHealth.terminalTotal > 0 && (
                    <div
                      className="flex shrink-0 items-center justify-center bg-emerald-500/85 text-sm font-semibold text-white"
                      style={{ width: `${settledRatio}%` }}
                    >
                      {sparkHealth.terminalTotal}
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 items-center justify-center text-sm font-semibold text-white">
                    {sparkHealth.openTotal}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                  <p className="ldvh-caption min-w-0 break-words text-ldvh-text-secondary">
                    {t('cognition.sparkHealth.settled', { count: String(sparkHealth.terminalTotal) })}
                    {terminalDetail ? `（${terminalDetail}）` : ''}
                  </p>
                  <p className="ldvh-caption min-w-0 break-words text-ldvh-text-secondary">
                    {t('cognition.sparkHealth.pending', { count: String(sparkHealth.openTotal) })}
                    {openPriorityDetail ? `（${openPriorityDetail}）` : ''}
                  </p>
                </div>
              </div>
            )}

            { }
            {sparkHealth && filteredSparkItems.length === 0 ? (
              sparkHealthIssues.length === 0 && <p className="ldvh-body-muted">{t('cognition.sparkHealth.empty')}</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-3">
                {visibleSparkItems.map((item) => <SparkHealthRow key={item.id} item={item} />)}
              </ul>
            )}

            {sparkHealth && filteredSparkItems.length > 0 && (
              <>
                {filteredSparkItems.length > SPARK_HEALTH_FIRST_SCREEN_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllSpark((previous) => !previous)}
                    className="mt-3 ldvh-caption inline-flex h-8 items-center rounded-md text-ldvh-text-secondary transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:underline"
                  >
                    {sparkItemsTruncated
                      ? t('cognition.sparkHealth.showRemaining', { count: String(filteredSparkItems.length - visibleSparkItems.length) })
                      : t('cognition.sparkHealth.collapseList')}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        </section>
      </div>
    </div>
  );
}
