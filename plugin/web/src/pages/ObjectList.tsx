import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Activity, CalendarClock, CircleAlert, CircleCheck, CircleMinus, CirclePlay, Clock3, History, Search } from 'lucide-react';
import ObjectIdentityActions from '@/components/ObjectIdentityActions';
import SegmentedControl from '@/components/SegmentedControl';
import WorkCaseCapabilityStatusBadge from '@/components/WorkCaseCapabilityStatusBadge';
import ObjectStatusFilter from '@/components/ObjectStatusFilter';
import WorkCaseProgressFilter from '@/components/WorkCaseProgressFilter';
import ServesSgFilter from '@/components/ServesSgFilter';
import ObjectPriorityFilter from '@/components/ObjectPriorityFilter';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import PriorityIcon from '@/components/PriorityIcon';
import ServesSgBadge from '@/components/ServesSgBadge';
import SummaryText from '@/components/SummaryText';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { WorkCaseCriteriaList } from '@/components/WorkCaseCriteriaList';
import { workCaseCheckStatement } from '@/utils/workcaseCheckState';
import { fetchCognitionGoal, fetchObjects, type FactCardAssociation, type FactCoverageStatus, type FactListProblem, type ObjectItem, type ObjectStatusOption, type WorkCaseLifecycleOption, type WorkCaseListGroup } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { getFieldLabel, getFieldValueLabel, getLocalizedObjectTitle, getObjectStatusLocale, getTypeDescription, getTypeLabel } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { ALL_STATUS_PARAM, getEffectiveListStatus, writeListStatusParam } from '@/utils/listStatus';
import { usePanel } from '@/utils/panelContext';
import { useProjectScope } from '@/utils/projectContext';
import { compareRfc3339Timestamps } from '@/shared/timestamp';

type Translate = ReturnType<typeof useI18n>['t'];
type StatusReason = { label: string; text: string; missing?: boolean };
type ObjectListSort = 'updated_desc' | 'created_desc';

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


/** 21 号三态直读列表 Card 主体（v5）。按 obj.group 分流 draft/open/closed 呈现。 */
function WorkCaseListCardBody({ obj, t }: { obj: ObjectItem; t: Translate }) {
  const group = obj.group ?? null;
  if (group === 'pending_gate1') {
    return (
      <div className="min-w-0">
        {obj.summary ? <p className="ldvh-card-decision-body">{obj.summary}</p> : null}
        {Array.isArray(obj.plan) && obj.plan.length > 0 ? (
          <WorkCaseCriteriaList className="mt-1.5" items={obj.plan.map((step, index) => ({ key: String(index), statement: step.step ?? '' }))} />
        ) : null}
        <p className="ldvh-caption mt-1.5 text-amber-500 dark:text-amber-400">{t('objectList.workcaseAwaitingGate1')}</p>
      </div>
    );
  }
  if (group === 'executing') {
    return (
      <div className="min-w-0">
        {obj.attempt ? (
          <p className="ldvh-card-decision-body">
            {t('objectList.workcaseAttemptController', { controller: obj.attempt.controller ?? '—' })}
            {obj.attempt.heartbeat_at ? ` · ${obj.attempt.heartbeat_at}` : ''}
          </p>
        ) : null}
        {Array.isArray(obj.plan) && obj.plan.length > 0 ? (
          <WorkCaseCriteriaList className="mt-1.5" items={obj.plan.map((step, index) => ({ key: String(index), statement: step.step ?? '' }))} />
        ) : null}
      </div>
    );
  }
  if (group === 'awaiting_gate2') {
    return (
      <div className="min-w-0">
        <p className="ldvh-caption mt-1.5 text-violet-500 dark:text-violet-400">{t('objectList.workcaseAwaitingGate2')}</p>
        {Array.isArray(obj.plan) && obj.plan.length > 0 ? (
          <WorkCaseCriteriaList className="mt-1.5" items={obj.plan.map((step, index) => ({ key: String(index), statement: step.step ?? '' }))} />
        ) : null}
      </div>
    );
  }
  if (group === 'closed') {
    return (
      <div className="min-w-0">
        {obj.outcome ? (
          <p className="ldvh-card-decision-body">
            <span className="ldvh-chip">{t(`objectList.workcaseOutcome.${obj.outcome}`)}</span>
          </p>
        ) : null}
        {obj.result?.criteria_checks && obj.result.criteria_checks.length > 0 ? (
          <WorkCaseCriteriaList
            className="mt-1.5"
            items={obj.result.criteria_checks.map((c, index) => ({ key: String(index), statement: workCaseCheckStatement(c, t) }))}
          />
        ) : null}
        {obj.gate_1 ? (
          <p className="ldvh-caption mt-1.5">{t('objectList.workcaseGate1', { approver: obj.gate_1.approver ?? '—', approvedAt: obj.gate_1.approved_at ?? '—' })}</p>
        ) : null}
      </div>
    );
  }
  return (
    <p className="ldvh-card-decision-body rounded-md border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-red-400">
      {t('objectList.workcaseProgressGroupUnavailable')}
    </p>
  );
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
          {/* Human 定案：卡头标签序 = 类型 → 优先级 → SG → 修改次数；不设关联
              chip（条件字段有值才显示，20 §8 priority 仅 open 时出现）。

              Human 复定 2026-09-16：卡头就是这四项，关联对象不进卡头。此前
              3e0cbcc 撤 chip 时写作「依据 10 §5.1 字段级直读不渲染关联关系、
              10 §5.2 卡片网格不承载关联对象」——经核对，10 §5.2 从未包含该
              禁止条文（其首条要点明列「关联计数」），§5.1 只约束第一层字段级
              直读、与第二层卡片网格互不替代（10 §5 首段：四层互不替代）。故
              此处改记为**呈现取舍**：卡头保持身份/优先级/SG/修改次数的稳定
              扫描序，关联对象由卡体 FactAssociationsCardContent 承载。 */}
          <PriorityIcon source={obj} type={obj.type} locale={locale} size="xs" />
          <ServesSgBadge value={obj.serves} locale={locale} />
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
      <FactAssociationsCardContent associations={obj.factAssociations} refs={obj.factRefs} />
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
  // Human 定案 2026-09-13：终态说明框保留背景色与框线颜色，仅去掉左侧
  // 加粗竖线——四边同为 1px 细线（border-l-2 与独立 border-l 色移除）。
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
  // 20 §8：终态去向由 disposition 承载（进入终态时必填）。
  const reason = obj.disposition?.trim() || t('objectList.dispositionMissing');

  return (
    <TerminalFactPanel tone={obj.status === 'implemented' ? 'implemented' : 'retired'} content={formatReasonText(reason)} />
  );
}

function FactAssociationsCardContent({ associations, refs }: { associations?: FactCardAssociation[]; refs?: FactCardAssociation[] }) {
  const { t, locale } = useI18n();
  // 03 §7.2 分工纪律：relations（factAssociations）承载生命周期关系、refs
  // （factRefs）承载普通内容关联，两者并列呈现、互不并入。同一目标同时出现
  // 在两侧时各留一条——隔离由下行的 source 分组去重键显式保证。
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
    <section onClick={(event) => event.stopPropagation()} className="min-w-0 border-t border-ldvh-border/60 pt-1.5">
      <div className="divide-y divide-ldvh-border/45">
        {visibleRows.map(({ association, source }, index) => <FactAssociationCardRow key={`${source}:${association.target && 'objectUid' in association.target ? association.target.objectUid : `${association.target?.governedProjectId ?? 'unavailable'}:${association.target?.factTypeKey ?? 'unknown'}:${association.target?.objectId ?? index}`}:${index}`} association={association} locale={locale} unavailableLabel={t('objectList.associationUnavailable')} />)}
      </div>
    </section>
  );
}

function associationLocator(association: FactCardAssociation) {
  if (association.resolvedTarget) return association.resolvedTarget;
  return association.target && !('objectUid' in association.target) ? association.target : null;
}

function dedupeFactCardAssociations<T extends { association: FactCardAssociation; source: string }>(rows: T[]): T[] {
  const seenTargets = new Set<string>();
  return rows.filter((row) => {
    const target = row.association.target;
    if (!target) return true;
    const targetKey = 'objectUid' in target
      ? `uid\u0000${target.objectUid}`
      : `${target.governedProjectId}\u0000${target.factTypeKey}\u0000${target.objectId}`;
    // 去重按来源分组隔离（03 §7.2）：同一目标同时被 relations 与 refs 指向时
    // 是两条不同语义的记录，必须各留一条。此隔离由 source 显式承载——不得
    // 依赖 refs 投影当前恰好没有 target 字段这一偶然事实（独立复核 2026-09-16
    // 发现 1：一旦 refs 补上 target，跨组去重会静默丢弃 refs 条目）。
    const scopedKey = `${row.source}\u0000${targetKey}`;
    if (seenTargets.has(scopedKey)) return false;
    seenTargets.add(scopedKey);
    return true;
  });
}

function FactAssociationCardRow({ association, locale, unavailableLabel }: { association: FactCardAssociation; locale: string; unavailableLabel: string }) {
  const { t } = useI18n();
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
    // 21 号三态：closed（含 cancelled——outcome 四值是徽标层，不是组）；
    // 派生 group 判待办（pending_gate1/awaiting_gate2 → pending；executing → progressing）。
    if (association.status === 'closed') return 'closed';
    if (association.group === 'pending_gate1' || association.group === 'awaiting_gate2') return 'pending';
    if (association.group === 'executing') return 'progressing';
  }
  // 26 §9：friction 关联目标——open/deferred 是活账（待修/缓议均待处理），resolved 已销。
  if (targetType === 'friction') {
    if (association.status === 'open' || association.status === 'deferred') return 'pending';
    if (association.status === 'resolved') return 'closed';
  }
  // 27 号 §9：norm 关联目标——retired 已退役（历史档案），active 生效中（下方默认）。
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
  //
  // Human 裁定 2026-09-16（本单扩围）：该克制只约束**正文段**，不约束关联呈现
  // ——非终态卡的 refs/relations 与终态卡走同一条组件路径呈现（10 §5.2 卡片
  // 网格承载「关联计数」；关联呈现由 ObjectCardFrame 统一承载，不经由本组件
  // 的状态分支）。本组件因此只负责状态相关的正文段，返回 null 不再意味着
  // 卡片无关联信息。
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

/** 26 §12 F1 投影要素的列表承载：phenomenon（现象单句）+ impact（影响评级
 * 闭集，非装饰字段）+ attribution（归因，条件出现）。卡片正文段复用 pitfall
 * 活跃决策块的 amber 表面语法，但语义归账本（待修的账）。 */
const FRICTION_IMPACT_CHIP_CLASS: Record<string, string> = {
  light: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  medium: 'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  heavy: 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

export function FrictionCardContent({ obj }: { obj: ObjectItem }) {
  const { t, locale } = useI18n();
  // 26 §9：三态都无 frontmatter 处置字段——resolved/deferred 的处置段住正文
  //（详情页阅读）；resolved 的解药由 informs 关系行（FactAssociationsCardContent）
  // 呈现。列表卡片只承载 F1 投影要素，不伪造处置摘要。
  const phenomenon = typeof obj.phenomenon === 'string' && obj.phenomenon.trim() ? obj.phenomenon.trim() : '';
  const attribution = typeof obj.attribution === 'string' && obj.attribution.trim() ? obj.attribution.trim() : '';
  const impact = typeof obj.impact === 'string' && obj.impact.trim() ? obj.impact.trim() : '';
  const impactLabel = impact ? getFieldValueLabel('impact', impact, locale) : '';
  const impactChipClass = impact ? FRICTION_IMPACT_CHIP_CLASS[impact] : undefined;

  return (
    <section className="min-w-0 rounded-md border border-amber-400/20 border-l-2 border-l-amber-400/70 bg-amber-500/[0.025] px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="ldvh-card-decision-title min-w-0 text-amber-700/85 dark:text-amber-200/85">
          {getFieldLabel('phenomenon', locale)}
        </h3>
        {impactChipClass && (
          <span className={`ldvh-chip-sm shrink-0 ${impactChipClass}`} title={`${getFieldLabel('impact', locale)}: ${impactLabel}`}>
            {impactLabel}
          </span>
        )}
      </div>
      {phenomenon ? (
        <div className={`${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} min-w-0 break-words`}>
          <SummaryText
            value={phenomenon}
            collapseThreshold={420}
            className="ldvh-card-decision-body [&_p]:my-0 text-amber-950/70 dark:text-amber-100/75"
          />
        </div>
      ) : (
        <p className={`ldvh-card-decision-body ${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} text-red-400`}>
          {t('objectList.frictionPhenomenonMissing')}
        </p>
      )}
      {attribution && (
        <div className="ldvh-meta mt-1.5 min-w-0 break-words text-ldvh-text-secondary/80">
          {getFieldLabel('attribution', locale)}：{attribution}
        </div>
      )}
    </section>
  );
}

/** 27 号 §10 F1 投影要素的列表承载：direction_key（方向键——同一 direction_key
 * 至多一个 active Norm，是机器可验证的方向标识）。retired 终态原因由
 * retirement_reason 承载（闭集同 22 号形态）。 */
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
  const { locale } = useI18n();
  if (obj.status === 'retired') return <NormTerminalCardContent obj={obj} />;
  // 活跃规范卡片承载 direction_key（27 §8 专属字段：管哪个方向）——正文四段
  //（方向定位/核心规则体系/约束与反模式/验证与遵从性检查）住详情页阅读布局。
  const directionKey = typeof obj.direction_key === 'string' && obj.direction_key.trim()
    ? obj.direction_key.trim()
    : '';
  if (!directionKey) return null;

  return (
    <section className="min-w-0 rounded-md border border-violet-400/20 border-l-2 border-l-violet-400/70 bg-violet-500/[0.025] px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="ldvh-card-decision-title min-w-0 text-violet-700/85 dark:text-violet-200/85">
          {getFieldLabel('direction_key', locale)}
        </h3>
        <code className="ldvh-chip-sm min-w-0 shrink-0 truncate border-violet-400/35 bg-violet-500/10 font-mono text-violet-700 dark:text-violet-300">
          {directionKey}
        </code>
      </div>
      <p className={`ldvh-caption ${WORKCASE_CARD_TITLE_BODY_GAP_CLASS} text-ldvh-text-secondary/80`}>
        {getTypeDescription(obj.type, locale)}
      </p>
    </section>
  );
}

export default function ObjectList() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [statusOptions, setStatusOptions] = useState<ObjectStatusOption[]>([]);
  const [priorityOptions, setPriorityOptions] = useState<ObjectStatusOption[]>([]);
  const [lifecycleOptions, setLifecycleOptions] = useState<WorkCaseLifecycleOption[]>([]);
  const [statusTotal, setStatusTotal] = useState(0);
  const [coverageStatus, setCoverageStatus] = useState<FactCoverageStatus>('complete');
  const [coverageProblemCount, setCoverageProblemCount] = useState(0);
  const [coverageProblems, setCoverageProblems] = useState<FactListProblem[]>([]);
  const [objectSearch, setObjectSearch] = useState('');
  const [isObjectSearchOpen, setIsObjectSearchOpen] = useState(false);
  // Spark 第二层筛选（serves_sg）：选项源跟随当前 goal 的子目标（25 号
  // sub_goals——SG 数量与变化以 goal 为准，Human 定案 2026-09-13）。
  const [servesSgOptions, setServesSgOptions] = useState<Array<{ id: string; text: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t, locale } = useI18n();

  const currentType = type ?? 'workcase';
  const statusParam = searchParams.get('status');
  const activeStatus = currentType === 'workcase' ? null : getEffectiveListStatus(currentType, statusParam);
  const lifecycleParam = searchParams.get('lifecycle');
  // WorkCase 列表筛选 = 21 号三态直读派生五档（pending_gate1/executing/awaiting_gate2/closed/all）。
  const isWorkCaseListGroup = (value: string | null): value is WorkCaseListGroup =>
    value === 'pending_gate1' || value === 'executing' || value === 'awaiting_gate2' || value === 'closed' || value === 'all';
  const activeLifecycle = currentType === 'workcase' && isWorkCaseListGroup(lifecycleParam)
    ? lifecycleParam
    : null;
  const servesParam = searchParams.get('serves');
  // Spark 三联过滤之三：priority（20 §8，仅 spark 生效；闭集 P0–P3）。
  const priorityParam = searchParams.get('priority');
  const supportsPriorityNavigation = currentType === 'spark';
  const activePriority = supportsPriorityNavigation
    && (priorityParam === 'P0' || priorityParam === 'P1' || priorityParam === 'P2' || priorityParam === 'P3')
    ? priorityParam
    : null;
  const sortParam = searchParams.get('sort');
  const activeSort: ObjectListSort = sortParam === 'created_desc' ? sortParam : 'updated_desc';
  // v5 无 priority 字段：20 §289（v4 priority 不迁入）与 21 §8 字段闭集均无此项，
  // 且 22 §271/23 §252/26 §258 判定 priority 类为无消费方装饰字段（03 §11.3-4
  // 要求字段扩展先说明消费方）。两侧 tab 均不提供优先级过滤。
  // serves 筛选只在 spark 生效，且仅当选项（goal 子目标）包含该值时激活。
  const supportsServesSgNavigation = currentType === 'spark';
  const activeServesSg = supportsServesSgNavigation && servesSgOptions.some((option) => option.id === servesParam)
    ? servesParam
    : null;

  useEffect(() => {
    const removesLegacyCategory = currentType === 'spark' && searchParams.has('category');
    const removesWorkCaseStatus = currentType === 'workcase' && searchParams.has('status');
    const removesForeignProgress = currentType !== 'workcase' && searchParams.has('progress');
    const removesForeignServes = currentType !== 'spark' && searchParams.has('serves');
    if (!removesLegacyCategory && !removesWorkCaseStatus && !removesForeignProgress && !removesForeignServes) return;
    const nextParams = new URLSearchParams(searchParams);
    if (removesLegacyCategory) nextParams.delete('category');
    if (removesWorkCaseStatus) nextParams.delete('status');
    if (removesForeignProgress) nextParams.delete('progress');
    if (removesForeignServes) nextParams.delete('serves');
    setSearchParams(nextParams, { replace: true });
  }, [currentType, searchParams, setSearchParams]);

  // serves 选项源：跟随当前 goal 的子目标（25 号）——goal 未创建是合法状态，
  // 静默保持空选项（筛选层不渲染）。
  useEffect(() => {
    if (currentType !== 'spark') {
      setServesSgOptions([]);
      return;
    }
    let cancelled = false;
    fetchCognitionGoal()
      .then((data) => {
        if (cancelled) return;
        const subGoals = Array.isArray(data.goal?.sub_goals) ? data.goal.sub_goals : [];
        setServesSgOptions(subGoals
          .filter((sg): sg is { id: string; text: string } => Boolean(sg && typeof sg.id === 'string' && sg.id.trim() && typeof sg.text === 'string'))
          .map((sg) => ({ id: sg.id.trim(), text: sg.text })));
      })
      .catch(() => {
        if (!cancelled) setServesSgOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentType]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setStatusOptions([]);
    setLifecycleOptions([]);
    setPriorityOptions([]);
    setStatusTotal(0);
    setCoverageStatus('complete');
    setCoverageProblemCount(0);
    setCoverageProblems([]);
    fetchObjects(currentType, activeStatus ?? undefined, activeLifecycle ?? undefined, activePriority ?? undefined)
      .then((result) => {
        const receivedItems = result.data?.items ?? [];
        const nextItems = receivedItems
          .filter((item) => !isDeprecatedListCard(item) || searchParams.get('status') === ALL_STATUS_PARAM || activeStatus === item.status);
        setItems(nextItems);
        setStatusOptions(result.data?.statusOptions ?? []);
        setLifecycleOptions(result.data?.lifecycleOptions ?? []);
        setPriorityOptions(result.data?.priorityOptions ?? []);
        setStatusTotal(result.data?.statusTotal ?? nextItems.length);
        setCoverageStatus(result.data?.coverage_status ?? 'complete');
        const nextCoverageProblems = result.data?.collection_issues ?? [];
        setCoverageProblems(nextCoverageProblems);
        setCoverageProblemCount(nextCoverageProblems.length);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentType, activeStatus, activeLifecycle, activePriority, statusParam]);

  const sortedItems = sortObjectsForList(items, activeSort);
  const normalizedObjectSearch = objectSearch.trim().toLowerCase();
  let filteredItems = normalizedObjectSearch
    ? sortedItems.filter((item) => {
      const title = getLocalizedObjectTitle(item, locale).toLowerCase();
      const objectId = item.id.toLowerCase();
      return title.includes(normalizedObjectSearch) || objectId.includes(normalizedObjectSearch);
    })
    : sortedItems;
  // 第二层筛选：serves（20 §6 子目标锚点，1e21a1f D-9 统一定名）——按当前
  // goal 子目标过滤（前端应用，items 已按状态过滤，计数与过滤同口径）。
  if (activeServesSg) {
    filteredItems = filteredItems.filter((item) => item.serves === activeServesSg);
  }
  // SG 计数：当前状态过滤后的 spark 池按 serves 聚合（反映当前过滤器，不是全量）。
  const servesSgCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of sortedItems) {
      const sg = typeof item.serves === 'string' && item.serves.trim() ? item.serves.trim() : null;
      if (sg) counts.set(sg, (counts.get(sg) ?? 0) + 1);
    }
    return counts;
  }, [sortedItems]);

  const handleStatusChange = (status: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    writeListStatusParam(currentType, nextParams, status);
    setSearchParams(nextParams);
  };

  const handleLifecycleChange = (group: WorkCaseListGroup | null) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('status');
    if (group) nextParams.set('lifecycle', group);
    else nextParams.delete('lifecycle');
    setSearchParams(nextParams);
  };

  const handlePriorityChange = (priority: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (priority) nextParams.set('priority', priority);
    else nextParams.delete('priority');
    setSearchParams(nextParams);
  };

  const handleServesSgChange = (servesSg: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (servesSg) {
      nextParams.set('serves', servesSg);
    } else {
      nextParams.delete('serves');
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
      const group = obj.group ?? null;
      return (
        <ObjectCardFrame
          key={obj.id}
          obj={obj}
          locale={locale}
          onOpen={openObject}
          showNonActiveReason={false}
          displayStatus={group ?? 'unknown'}
        >
          <WorkCaseListCardBody obj={obj} t={t} />
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


    return (
      <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject}>
      </ObjectCardFrame>
    );
  };

  return (
    <div className="ldvh-page-frame">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-4 min-h-8 border-b border-ldvh-border bg-ldvh-bg/95 px-6 py-3 backdrop-blur">
        {/* Spark 三联过滤之一：priority（20 §8，Human 裁定 2026-09-13）——
            AI 出初值、Human 可调整；仅 open 时出现，故终态分组下不展示。 */}
        {supportsPriorityNavigation && priorityOptions.length > 0 && (
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
        {/* Spark 三联过滤之二：serves_sg 子目标锚点（20 §6）——选项源跟随当前
            goal 的子目标动态生成（Human 定案 2026-09-13），计数同当前状态过滤。 */}
        {supportsServesSgNavigation && servesSgOptions.length > 0 && (
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ServesSgFilter
              activeServesSg={activeServesSg}
              onChange={handleServesSgChange}
              options={servesSgOptions}
              counts={servesSgCounts}
              total={sortedItems.length}
              loading={loading}
              coverageStatus={coverageStatus}
            />
          </div>
        )}
        <div className="relative flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
            {currentType === 'workcase' ? (
              <>
                <span className="ldvh-meta shrink-0 text-ldvh-text-secondary">{t('objectList.lifecycleFilter')}</span>
                <WorkCaseProgressFilter
                  activeGroup={activeLifecycle}
                  onChange={handleLifecycleChange}
                  options={lifecycleOptions}
                  total={statusTotal}
                  loading={loading}
                  coverageStatus={coverageStatus}
                />
              </>
            ) : (
              <>
                {currentType === 'spark' || currentType === 'research' || currentType === 'friction' || currentType === 'norm' ? <span className="ldvh-meta shrink-0 text-ldvh-text-secondary">{t('objectList.lifecycleFilter')}</span> : null}
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
