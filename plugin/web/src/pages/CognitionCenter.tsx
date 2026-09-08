/**
 * 项目认知中心（02 §3 / §4.1 / §4.2 / §5）。
 *
 * - 默认只读：不提供批准、关闭、分流、处置或任何写入口（02 §2.2 / §7.2）。
 * - 一切从既有字段派生：近期动态与热点均只读取事实 change_log（旧事实无流水时才回退时间字段）。
 * - 决定依据区与 WorkCase 列表 Card 同源消费（复用 ObjectList 导出的内容组件与
 *   source-bound WorkCase Card 投影，Q3），不在本页另写摘要逻辑（02 §7.5）。
 * - 复制语义：模块级"复制模块摘要"为面向 AI 对话的多行文本；条目本身不叠加聚焦页专属操作，
 *   保持与对象列表 Card 相同的可读形态（02 §4.1 / §5.3）。
 * - 待决规模如实可见：超出首屏按服务端排序截断，底部如实提示总数与未显示数量，不分页。
 * - 模块级降级：issues 就地显示实际不可用范围与原因，其它内容正常呈现（02 §5.2）。
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, CirclePlay, GitFork, HeartPulse, History, Inbox } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import CopyPathButton from '@/components/CopyPathButton';
import ObjectReferenceCopyButton from '@/components/ObjectReferenceCopyButton';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import {
  ObjectCardFrame,
  PitfallCardContent,
  WorkCaseBlockingNotice,
  WorkCaseContributionsContent,
  WorkCaseClosureConfirmationContent,
  WorkCasePlanConfirmationContent,
  WorkCaseProgressingContent,
} from '@/pages/ObjectList';
import StatusBadge from '@/components/StatusBadge';
import PriorityIcon from '@/components/PriorityIcon';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { CommitHotspotCluster, CommitHotspotRelationLegend, nodeKey } from '@/pages/cognition/CommitHotspotGraph';
import {
  fetchCognition,
  type CognitionActiveWorkCaseItem,
  type CognitionRecentHotspotNode,
  type CognitionData,
  type CognitionInboxItem,
  type CognitionInboxKind,
  type CognitionIssue,
  type CognitionRecentActivityItem,
  type CognitionRecentActivityAttributionUsage,
  type CognitionRecentActivityWindow,
  type CognitionSparkHealthItem,
  type ObjectItem,
  type WorkCaseContributionTarget,
} from '@/utils/api';
import { usePanel } from '@/utils/panelContext';
import { useProjectScope } from '@/utils/projectContext';
import { useI18n } from '@/i18n/context';
import { getFieldLabel, getFieldValueLabel, getLocalizedObjectTitle, getObjectStatusLocale, getTypeLabel, type LocaleKey } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { getDefaultSparkHealthAgeFilter, type SparkHealthAgeFilter } from '@/utils/cognitionSparkHealth';

/** 首屏截断阈值：Web 展示参数，不是事实；截断时底部如实提示总数与未显示数量。 */
const INBOX_FIRST_SCREEN_LIMIT = 8;
const ACTIVE_WORKCASE_FIRST_SCREEN_LIMIT = 8;
const RECENT_ACTIVITY_FIRST_SCREEN_LIMIT = 6;
const RECENT_ACTIVITY_MAX_VISIBLE = Number.MAX_SAFE_INTEGER;
const SPARK_HEALTH_FIRST_SCREEN_LIMIT = 6;
const SPARK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

const RECENT_ACTIVITY_WINDOWS: CognitionRecentActivityWindow[] = ['1d', '3d', '7d'];
const SPARK_HEALTH_AGE_FILTERS: SparkHealthAgeFilter[] = ['all', '3d', '7d'];

type RecentHotspotStatusFilter = 'all' | 'progressing' | 'decision' | 'settled';

const RECENT_HOTSPOT_STATUS_FILTERS: RecentHotspotStatusFilter[] = ['all', 'progressing', 'decision', 'settled'];
const RECENT_HOTSPOT_TERMINAL_STATUSES: Record<string, Set<string>> = {
  workcase: new Set(['closed', 'discarded']),
  adr: new Set(['retired']),
  pitfall: new Set(['discarded']),
  spark: new Set(['implemented', 'discarded']),
  study: new Set(['retired']),
};

function getRecentHotspotStatusGroup(node: CognitionRecentHotspotNode): Exclude<RecentHotspotStatusFilter, 'all'> {
  if (node.status && RECENT_HOTSPOT_TERMINAL_STATUSES[node.type]?.has(node.status)) return 'settled';
  if (node.type === 'workcase') {
    if (node.progress_group === 'plan_confirmation' || node.progress_group === 'closure_confirmation') return 'decision';
    if (node.progress_group === 'closed') return 'settled';
    return 'progressing';
  }
  if (node.type === 'pitfall' && node.status === 'draft') return 'decision';
  return 'progressing';
}

const INBOX_KIND_LABEL_KEYS: Record<CognitionInboxKind, LocaleKey> = {
  plan_confirmation: 'cognition.kind.plan_confirmation',
  closure_confirmation: 'cognition.kind.closure_confirmation',
  blocked_resolution: 'cognition.kind.blocked_resolution',
  pitfall_confirmation: 'cognition.kind.pitfall_confirmation',
};

type Translate = ReturnType<typeof useI18n>['t'];

function formatHumanObjectReference(type: string, title: string, locale: string): string {
  return `${getTypeLabel(type, locale)}《${title}》`;
}

/** 面向 AI 对话的模块摘要：模块名、关键计数与类型《当前标题》（不含机器身份与未精确读取的路径）。 */
function buildModuleSummary(data: CognitionData, locale: string, t: Translate): string {
  const lines: string[] = [];
  lines.push(t('cognition.inbox.title'));
  const counts: Record<CognitionInboxKind, number> = {
    plan_confirmation: 0,
    closure_confirmation: 0,
    blocked_resolution: 0,
    pitfall_confirmation: 0,
  };
  for (const item of data.inbox.items) counts[item.inboxKind] += 1;
  const countParts = (Object.keys(counts) as CognitionInboxKind[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${t(INBOX_KIND_LABEL_KEYS[kind])} ${counts[kind]}`);
  lines.push(`total: ${data.inbox.total}${countParts.length > 0 ? ` (${countParts.join(', ')})` : ''}`);
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

function buildActiveWorkCaseSummary(data: CognitionData, locale: string, t: Translate): string {
  const lines = [t('cognition.active.title'), `total: ${data.activeWorkCases.total}`];
  for (const item of data.activeWorkCases.items) {
    lines.push(`- ${formatHumanObjectReference('workcase', getLocalizedObjectTitle(item, locale, item.id), locale)}`);
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
    t('cognition.sparkHealth.silentSummary', { count: String(health.silentCount), days: String(health.silentThresholdDays) }),
  ];
  for (const item of health.silentItems) {
    lines.push(`- ${formatHumanObjectReference('spark', getLocalizedObjectTitle(item, locale, item.id), locale)} · ${t('cognition.sparkHealth.silentDays', { days: String(item.silentDays) })}`);
  }
  return lines.join('\n');
}

function buildRecentHotspotSummary(data: CognitionData, locale: string, t: Translate): string {
  const hotspots = data.recentHotspots;
  if (!hotspots) return t('cognition.commitHotspots.title');
  const lines = [
    t('cognition.commitHotspots.title'),
    t(`cognition.recent.window.${hotspots.window}` as LocaleKey),
    t('cognition.commitHotspots.totalCommits', { count: String(hotspots.totalEvents) }),
    t('cognition.commitHotspots.summary', { hotspots: String(hotspots.hotspotTotal), relations: String(hotspots.relationTotal) }),
  ];
  for (const cluster of hotspots.clusters) {
    const item = cluster.primary;
    lines.push(`- ${formatHumanObjectReference(item.type, getLocalizedObjectTitle(item, locale, item.id), locale)} · ${item.activityRefs.length}`);
  }
  return lines.join('\n');
}

/** 读取问题与未解析结构在消费位置就地显示（02 §5.4）。 */
type CognitionCardItem = CognitionInboxItem | CognitionActiveWorkCaseItem;

function InboxItemReadNotes({ item, locale }: { item: CognitionCardItem; locale: string }) {
  const fieldIssues = item.field_issues ?? [];
  const unparsed = item.unparsed_structures ?? [];
  const showReadStatus = item.read_status !== 'readable';
  if (!showReadStatus && fieldIssues.length === 0 && unparsed.length === 0) return null;
  return (
    <div className="mt-2 grid min-w-0 gap-1">
      {showReadStatus && (
        <p className="ldvh-caption text-red-400">
          {getFieldLabel('read_status', locale)}: {getFieldValueLabel('read_status', item.read_status, locale)}
        </p>
      )}
      {fieldIssues.map((issue, index) => (
        <p key={`field-${index}`} className="ldvh-caption break-words text-red-400">
          {issue.path}: {getFieldValueLabel('field_issue_reason', issue.reason, locale)}
        </p>
      ))}
      {unparsed.map((structure, index) => (
        <p key={`unparsed-${index}`} className="ldvh-caption break-words text-amber-600 dark:text-amber-300">
          {structure.path}: {structure.reason}
        </p>
      ))}
    </div>
  );
}

function InboxCardContent({ item, t, locale, onOpenContribution }: { item: CognitionInboxItem; t: Translate; locale: string; onOpenContribution: (target: WorkCaseContributionTarget, title: string) => void }) {
  if (item.type === 'pitfall') return <PitfallCardContent obj={toObjectCard(item)} />;
  if (item.inboxKind === 'blocked_resolution') {
    return (
      <div className="grid min-w-0 gap-2">
        <WorkCaseBlockingNotice blockingSummary={item.card.blocking_summary} t={t} />
        <section className="min-w-0 rounded-md border border-amber-400/25 border-l-2 border-l-amber-400 bg-amber-500/[0.035] px-3.5 py-3">
          <h3 className="ldvh-card-decision-title text-amber-700/85 dark:text-amber-200/85">
            {t('cognition.kind.blocked_resolution')}
          </h3>
          <p className="ldvh-card-decision-body mt-1.5 text-amber-950/70 dark:text-amber-100/75">
            {t('cognition.blocked.position', {
              position: getObjectStatusLocale('workcase', item.progress_group, locale),
            })}
          </p>
        </section>
      </div>
    );
  }
  if (item.inboxKind === 'plan_confirmation') {
    return (
      <WorkCasePlanConfirmationContent
        mode="card"
        goal={item.card.goal}
        successCriteria={item.card.successCriteria}
        successCriterionDefinitions={item.card.success_criterion_definitions}
        executionAuthorization={item.card.execution_authorization}
        t={t}
      />
    );
  }
  if (item.inboxKind === 'closure_confirmation') {
    return (
      <>
        <WorkCaseClosureConfirmationContent
          goal={item.card.goal}
          closureProposal={item.card.closureProposal}
          onOpenTarget={onOpenContribution}
        />
        <WorkCaseContributionsContent contributions={item.card.contributedTo} locale={locale} onOpenTarget={onOpenContribution} />
      </>
    );
  }
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
    status: item.type === 'workcase'
      ? item.isBlocked ? 'blocked' : item.progress_group
      : item.status,
    ...(item.type === 'workcase' ? { progress_group: item.progress_group } : {}),
    ...(item.type === 'workcase' ? {
      lifecycle_position: item.lifecycle_position,
      ...('progress_step' in item && item.progress_step ? { progress_step: item.progress_step } : {}),
    } : {}),
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

function ActiveWorkCaseItemRow({ item }: { item: CognitionActiveWorkCaseItem }) {
  const { t, locale } = useI18n();
  const { openPanel } = usePanel();
  const title = getLocalizedObjectTitle(item, locale, item.id);
  const objectCard = toObjectCard(item);

  return (
    <li className="min-w-0">
      <ObjectCardFrame
        obj={objectCard}
        locale={locale}
        onOpen={() => openPanel({ type: 'object', title, objectType: 'workcase', objectId: item.id })}
        showNonActiveReason={false}
        displayStatus="progressing"
      >
        <WorkCaseProgressingContent
          goal={item.card.goal}
          lifecyclePosition={item.lifecycle_position}
          progressStep={item.progress_step ?? null}
          executionItemsProjectionValid={item.card.executionItemsProjectionValid ?? false}
          executionItems={item.card.executionItems ?? []}
          isBlocked={item.isBlocked}
          waitingOn={item.card.waiting_on}
          blockingSummary={item.card.blocking_summary}
          t={t}
        />
        <InboxItemReadNotes item={item} locale={locale} />
      </ObjectCardFrame>
    </li>
  );
}

function InboxItemRow({ item }: { item: CognitionInboxItem }) {
  const { t, locale } = useI18n();
  const { openPanel } = usePanel();
  const title = getLocalizedObjectTitle(item, locale, item.id);
  const objectCard = toObjectCard(item);

  return (
    <li className="min-w-0">
      <ObjectCardFrame
        obj={objectCard}
        locale={locale}
        onOpen={() => openPanel({ type: 'object', title, objectType: item.type, objectId: item.id })}
        displayStatus={item.type === 'workcase' && item.inboxKind === 'blocked_resolution' ? 'blocked' : undefined}
      >
        <InboxCardContent
          item={item}
          t={t}
          locale={locale}
          onOpenContribution={(target, targetTitle) => openPanel({
            type: 'object',
            title: targetTitle,
            objectType: target.factTypeKey,
            objectId: target.objectId,
          })}
        />
        <InboxItemReadNotes item={item} locale={locale} />
      </ObjectCardFrame>
    </li>
  );
}

function ModuleIssuesNotice({ issues, t, unavailableKey = 'cognition.inbox.unavailable' }: { issues: CognitionIssue[]; t: Translate; unavailableKey?: LocaleKey }) {
  if (issues.length === 0) return null;
  return (
    <div role="status" className="mb-3 min-w-0 rounded-md border border-red-400/25 border-l-2 border-l-red-400 bg-red-500/5 px-2.5 py-2">
      <p className="ldvh-caption text-red-500 dark:text-red-300">{t(unavailableKey)}</p>
      <ul className="mt-1 grid min-w-0 gap-0.5">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="ldvh-caption break-words text-red-400">
            [{issue.code}] {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentActivityReadNotes({ item, locale }: { item: CognitionRecentActivityItem; locale: string }) {
  const fieldIssues = item.field_issues ?? [];
  const unparsed = item.unparsed_structures ?? [];
  if (item.read_status === 'readable' && fieldIssues.length === 0 && unparsed.length === 0) return null;
  return (
    <div className="mt-1.5 grid min-w-0 gap-1">
      {item.read_status !== 'readable' && (
        <p className="ldvh-caption text-red-400">
          {getFieldLabel('read_status', locale)}: {getFieldValueLabel('read_status', item.read_status, locale)}
        </p>
      )}
      {fieldIssues.map((issue, index) => (
        <p key={`field-${index}`} className="ldvh-caption break-words text-red-400">
          {issue.path}: {getFieldValueLabel('field_issue_reason', issue.reason, locale)}
        </p>
      ))}
      {unparsed.map((structure, index) => (
        <p key={`unparsed-${index}`} className="ldvh-caption break-words text-amber-600 dark:text-amber-300">
          {structure.path}: {structure.reason}
        </p>
      ))}
    </div>
  );
}

function ActivityCountBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      className="ldvh-chip inline-flex h-[18px] shrink-0 items-center justify-center gap-1 rounded-md border border-ldvh-accent/25 bg-ldvh-accent/5 px-[5px] text-[10px] font-medium leading-3 text-ldvh-accent"
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
  const status = item.type === 'workcase' ? item.progress_group : item.status;
  const typeColor = CATEGORY_COLORS[item.type] || CATEGORY_COLORS.other;
  const open = () => openPanel({ type: 'object', title, objectType: item.type, objectId: item.id });
  return (
    <li className="min-w-0 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="ldvh-caption shrink-0 text-ldvh-text-secondary">{item.relativeTime}</span>
        <span
          className="ldvh-chip inline-flex h-[18px] shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-medium leading-3"
          style={{ backgroundColor: `${typeColor}18`, borderColor: `${typeColor}55`, color: typeColor }}
        >
          {getTypeLabel(item.type, locale)}
        </span>
        {/* Human 2026-09-10 定案：近期动态行不显示研究问题——该行是动态摘要不是
            F1 卡（24 §12 的 research_question 卡片摘要投影归对象列表卡片承载）。 */}
        <PriorityIcon source={item} type={item.type} locale={locale} size="xs" />
        <ActivityCountBadge count={item.activityCount} label={t('cognition.recent.activityCount', { count: String(item.activityCount) })} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {status && <StatusBadge status={status} statusLabel={getObjectStatusLocale(item.type, status, locale)} objectType={item.type} size="xs" variant="compact" />}
          <ObjectReferenceCopyButton projectId={selectedProjectId} objectId={item.id} />
        </span>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => openOnKeyboard(event, open)}
        className="group mt-1.5 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
      >
        <ObjectTypeIcon type={item.type} size={15} className="shrink-0" style={{ color: item.typeColor }} />
        <h4 className="ldvh-card-title min-w-0 flex-1 whitespace-normal break-words group-hover:text-ldvh-accent">{title}</h4>
      </div>
      <RecentActivityReadNotes item={item} locale={locale} />
      <div className="mt-2 flex min-w-0 items-center justify-end text-right opacity-70">
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
    <li className="min-w-0 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="ldvh-caption shrink-0 text-amber-700/85 dark:text-amber-300/85">
          {t('cognition.sparkHealth.silentDays', { days: String(item.silentDays) })}
        </span>
        <span
          className="ldvh-chip inline-flex h-[18px] shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-medium leading-3"
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
        className="group mt-1.5 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
      >
        <ObjectTypeIcon type="spark" size={15} className="shrink-0" style={{ color: item.typeColor }} />
        <h4 className="ldvh-card-title min-w-0 flex-1 whitespace-normal break-words group-hover:text-ldvh-accent">{title}</h4>
      </div>
      {showReadNotes && <div className="mt-1.5 grid min-w-0 gap-1">
        {item.read_status !== 'readable' && (
          <p className="ldvh-caption text-red-400">
            {getFieldLabel('read_status', locale)}: {getFieldValueLabel('read_status', item.read_status, locale)}
          </p>
        )}
        {fieldIssues.map((issue, index) => (
          <p key={`field-${index}`} className="ldvh-caption break-words text-red-400">
            {issue.path}: {getFieldValueLabel('field_issue_reason', issue.reason, locale)}
          </p>
        ))}
        {unparsed.map((structure, index) => (
          <p key={`unparsed-${index}`} className="ldvh-caption break-words text-amber-600 dark:text-amber-300">
            {structure.path}: {structure.reason}
          </p>
        ))}
      </div>}
      <div className="mt-2 flex min-w-0 items-center justify-end text-right opacity-70">
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

export default function CognitionCenter() {
  const [data, setData] = useState<CognitionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inboxExpanded, setInboxExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [showAllActive, setShowAllActive] = useState(false);
  const [recentWindow, setRecentWindow] = useState<CognitionRecentActivityWindow>('1d');
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showAllRecentUsage, setShowAllRecentUsage] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [sparkHealthExpanded, setSparkHealthExpanded] = useState(true);
  const [sparkHealthAgeFilter, setSparkHealthAgeFilter] = useState<SparkHealthAgeFilter>('7d');
  const [showAllSpark, setShowAllSpark] = useState(false);
  const [recentHotspotsExpanded, setRecentHotspotsExpanded] = useState(true);
  const [expandedHotspotKey, setExpandedHotspotKey] = useState<string | null>(null);
  const [recentHotspotStatusFilter, setRecentHotspotStatusFilter] = useState<RecentHotspotStatusFilter>('progressing');
  const { t, locale } = useI18n();

  // 首次进入才阻塞整页；切换近期窗口保留当前内容，只在本模块内更新快照。
  useEffect(() => {
    let cancelled = false;
    const hasCurrentData = data !== null;
    setError(null);
    setRecentError(null);
    if (hasCurrentData) setRecentLoading(true);
    fetchCognition(locale, recentWindow)
      .then((next) => {
        if (!cancelled) {
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
          <AlertCircle size={32} className="mx-auto mb-2 text-red-400" />
          <p className="text-ldvh-text-secondary">{t('common.loadFailed')}</p>
          <p className="ldvh-meta text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ldvh-accent border-t-transparent" />
      </div>
    );
  }

  const inboxIssues = (data.issues ?? []).filter((issue) => issue.section === 'inbox');
  const items = data.inbox.items;
  const truncated = !showAll && items.length > INBOX_FIRST_SCREEN_LIMIT;
  const visibleItems = truncated ? items.slice(0, INBOX_FIRST_SCREEN_LIMIT) : items;
  const activeWorkCaseIssues = (data.issues ?? []).filter((issue) => issue.section === 'activeWorkCases');
  const activeWorkCaseItems = data.activeWorkCases.items;
  const activeWorkCasesTruncated = !showAllActive && activeWorkCaseItems.length > ACTIVE_WORKCASE_FIRST_SCREEN_LIMIT;
  const visibleActiveWorkCases = activeWorkCasesTruncated
    ? activeWorkCaseItems.slice(0, ACTIVE_WORKCASE_FIRST_SCREEN_LIMIT)
    : activeWorkCaseItems;
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
  const recentHotspots = data.recentHotspots;
  const recentHotspotIssues = (data.issues ?? []).filter((issue) => issue.section === 'recentHotspots');
  const filteredRecentHotspotClusters = !recentHotspots
    ? []
    : recentHotspotStatusFilter === 'all'
      ? recentHotspots.clusters
      : recentHotspots.clusters.filter((cluster) => getRecentHotspotStatusGroup(cluster.primary) === recentHotspotStatusFilter);
  const recentHotspotStatusCounts = recentHotspots?.clusters.reduce<Record<RecentHotspotStatusFilter, number>>((counts, cluster) => {
    counts.all += 1;
    counts[getRecentHotspotStatusGroup(cluster.primary)] += 1;
    return counts;
  }, { all: 0, progressing: 0, decision: 0, settled: 0 }) ?? { all: 0, progressing: 0, decision: 0, settled: 0 };
  const recentHotspotRelationKeys = [...new Set(filteredRecentHotspotClusters.flatMap((cluster) => (
    cluster.relations.map((relation) => relation.relationKey)
  )))];

  return (
    <div className="flex min-h-full flex-col p-6">
      <PageHeader title={t('cognition.title')} subtitle={t('cognition.subtitle')} />

      {/* 模块一 待决定事项：全宽主面板，置顶（02 §3） */}
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
            <CopyPathButton
              path={buildModuleSummary(data, locale, t)}
              label={t('cognition.copyModuleSummary')}
              copiedLabel={t('cognition.copiedModuleSummary')}
            />
            <button
              type="button"
              aria-expanded={inboxExpanded}
              aria-controls="cognition-inbox-content"
              onClick={(event) => {
                event.stopPropagation();
                setInboxExpanded((expanded) => !expanded);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-bg hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
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

            {/* 截断时如实提示总数与未显示数量，不用分页掩盖待决规模 */}
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

      {/* 推进中事项：只收纳 progress_group=progressing 的 WorkCase，并复用对象列表进行中 Card。 */}
      <section className="mt-4 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={activeExpanded}
          aria-controls="cognition-active-workcases-content"
          onClick={() => setActiveExpanded((expanded) => !expanded)}
          onKeyDown={(event) => toggleOnKeyboard(event, () => setActiveExpanded((expanded) => !expanded))}
          className={`-mx-1 flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 transition-colors hover:bg-ldvh-bg/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50 ${activeExpanded ? 'mb-4' : ''}`}
        >
          <CirclePlay size={16} className="shrink-0 text-sky-500 dark:text-sky-400" aria-hidden="true" />
          <h3 className="ldvh-section-title min-w-0">{t('cognition.active.title')}</h3>
          {data.activeWorkCases.total > 0 && (
            <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{data.activeWorkCases.total}</span>
          )}
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            <CopyPathButton
              path={buildActiveWorkCaseSummary(data, locale, t)}
              label={t('cognition.active.copyModuleSummary')}
              copiedLabel={t('cognition.active.copiedModuleSummary')}
            />
            <button
              type="button"
              aria-expanded={activeExpanded}
              aria-controls="cognition-active-workcases-content"
              onClick={(event) => {
                event.stopPropagation();
                setActiveExpanded((expanded) => !expanded);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-bg hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
              title={t(activeExpanded ? 'cognition.active.collapseSection' : 'cognition.active.expandSection')}
            >
              {activeExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              <span className="sr-only">{t(activeExpanded ? 'cognition.active.collapseSection' : 'cognition.active.expandSection')}</span>
            </button>
          </span>
        </div>

        {activeExpanded && (
          <div id="cognition-active-workcases-content">
            <ModuleIssuesNotice issues={activeWorkCaseIssues} t={t} unavailableKey="cognition.active.unavailable" />
            {activeWorkCaseItems.length === 0 ? (
              activeWorkCaseIssues.length === 0 && <p className="ldvh-body-muted">{t('cognition.active.empty')}</p>
            ) : (
              <ul className="ldvh-section-grid min-w-0">
                {visibleActiveWorkCases.map((item) => (
                  <ActiveWorkCaseItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}
            {activeWorkCaseItems.length > ACTIVE_WORKCASE_FIRST_SCREEN_LIMIT && (
              <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <p className="ldvh-caption min-w-0">
                  {activeWorkCasesTruncated
                    ? t('cognition.active.truncated', {
                      total: String(data.activeWorkCases.total),
                      shown: String(visibleActiveWorkCases.length),
                      hidden: String(activeWorkCaseItems.length - visibleActiveWorkCases.length),
                    })
                    : null}
                </p>
                <button
                  type="button"
                  onClick={() => setShowAllActive((previous) => !previous)}
                  className="ldvh-caption inline-flex h-8 shrink-0 items-center rounded-md border border-ldvh-border px-3 text-ldvh-text-secondary transition-colors hover:border-ldvh-accent/50 hover:text-ldvh-accent"
                >
                  {activeWorkCasesTruncated ? t('cognition.active.showAll') : t('cognition.active.collapse')}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="mt-4 ldvh-panel-grid items-start">
        {/* 模块二 近期动态：以事实 change_log 聚合稳定对象与署名使用量，不把提交列表搬到聚焦页。 */}
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
            <CopyPathButton
              path={buildRecentActivitySummary(data, locale, t)}
              label={t('cognition.recent.copyModuleSummary')}
              copiedLabel={t('cognition.recent.copiedModuleSummary')}
            />
            <button
              type="button"
              aria-expanded={recentExpanded}
              aria-controls="cognition-recent-activity-content"
              onClick={() => setRecentExpanded((expanded) => !expanded)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-bg hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
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
            {recentError && <p role="status" className="mb-3 ldvh-caption text-red-400">{recentError}</p>}
            <ModuleIssuesNotice issues={recentIssues} t={t} />
            {recentItems.length === 0 ? (
              recentIssues.length === 0 && <p className="ldvh-body-muted">{t('cognition.recent.empty')}</p>
            ) : (
              <ul className="divide-y divide-ldvh-border/70">
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
              <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4">
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

        {/* 模块四 Spark 池健康：只读呈现当前 open / terminal 与静默派生，不生成分流建议。 */}
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
            {sparkHealth && (
              <CopyPathButton
                path={buildSparkHealthSummary(data, locale, t)}
                label={t('cognition.sparkHealth.copyModuleSummary')}
                copiedLabel={t('cognition.sparkHealth.copiedModuleSummary')}
              />
            )}
            <button
              type="button"
              aria-expanded={sparkHealthExpanded}
              aria-controls="cognition-spark-health-content"
              onClick={(event) => {
                event.stopPropagation();
                setSparkHealthExpanded((expanded) => !expanded);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-bg hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
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
              <div className="border-y border-ldvh-border/70 py-4">
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

            {sparkHealth && filteredSparkItems.length === 0 ? (
              sparkHealthIssues.length === 0 && <p className="ldvh-body-muted">{t('cognition.sparkHealth.empty')}</p>
            ) : (
              <ul className="divide-y divide-ldvh-border/70">
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

      {/* 模块三：以事实流水为热点中心，仅展开一跳正式关系；不推断语义关联或重要性。 */}
      <section className="mt-4 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={recentHotspotsExpanded}
          aria-controls="cognition-recent-hotspots-content"
          onClick={() => setRecentHotspotsExpanded((expanded) => !expanded)}
          onKeyDown={(event) => toggleOnKeyboard(event, () => setRecentHotspotsExpanded((expanded) => !expanded))}
          className={`-mx-1 flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 transition-colors hover:bg-ldvh-bg/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50 ${recentHotspotsExpanded ? 'mb-4' : ''}`}
        >
          <GitFork size={16} className="shrink-0 text-ldvh-accent" aria-hidden="true" />
          <h3 className="ldvh-section-title min-w-0">{t('cognition.commitHotspots.title')}</h3>
          {recentHotspots && recentHotspots.hotspotTotal > 0 && (
            <div
              className="ldvh-tab-list ml-1 flex min-w-0 flex-wrap"
              role="group"
              aria-label={t('cognition.commitHotspots.statusFilterLabel')}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {RECENT_HOTSPOT_STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={recentHotspotStatusFilter === filter}
                  onClick={() => {
                    setRecentHotspotStatusFilter(filter);
                    setExpandedHotspotKey(null);
                  }}
                  className={`ldvh-tab-button ${recentHotspotStatusFilter === filter ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
                >
                  {t(`cognition.commitHotspots.statusFilter.${filter}` as LocaleKey)}
                  <span className="ml-1 tabular-nums opacity-75">{recentHotspotStatusCounts[filter]}</span>
                </button>
              ))}
            </div>
          )}
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            {recentHotspots && (
              <CopyPathButton
                path={buildRecentHotspotSummary(data, locale, t)}
                label={t('cognition.commitHotspots.copyModuleSummary')}
                copiedLabel={t('cognition.commitHotspots.copiedModuleSummary')}
              />
            )}
            <button
              type="button"
              aria-expanded={recentHotspotsExpanded}
              aria-controls="cognition-recent-hotspots-content"
              onClick={(event) => {
                event.stopPropagation();
                setRecentHotspotsExpanded((expanded) => !expanded);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-bg hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
              title={t(recentHotspotsExpanded ? 'cognition.commitHotspots.collapseSection' : 'cognition.commitHotspots.expandSection')}
            >
              {recentHotspotsExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              <span className="sr-only">{t(recentHotspotsExpanded ? 'cognition.commitHotspots.collapseSection' : 'cognition.commitHotspots.expandSection')}</span>
            </button>
          </span>
        </div>

        {recentHotspotsExpanded && (
          <div id="cognition-recent-hotspots-content">
            <ModuleIssuesNotice issues={recentHotspotIssues} t={t} unavailableKey="cognition.commitHotspots.unavailable" />
            {recentHotspots && (
              recentHotspots.hotspotTotal === 0 ? (
                recentHotspotIssues.length === 0 && <p className="ldvh-body-muted">{t('cognition.commitHotspots.empty')}</p>
              ) : (
                <div className="flex min-w-0 flex-col gap-3">
                  {recentHotspotRelationKeys.length > 0 && (
                    <CommitHotspotRelationLegend relationKeys={recentHotspotRelationKeys} />
                  )}
                  {filteredRecentHotspotClusters.length === 0 ? (
                    <p className="ldvh-body-muted">{t('cognition.commitHotspots.filterEmpty')}</p>
                  ) : (
                    <div className="ldvh-hotspot-grid min-w-0 items-start">
                      {filteredRecentHotspotClusters.map((cluster, index) => {
                        const clusterKey = nodeKey(cluster.primary);
                        return (
                          <CommitHotspotCluster
                            key={clusterKey}
                            cluster={cluster}
                            index={index}
                            canExpand={cluster.relations.length > 0}
                            expanded={expandedHotspotKey === clusterKey}
                            onExpandedChange={(expanded) => setExpandedHotspotKey(expanded ? clusterKey : null)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}
