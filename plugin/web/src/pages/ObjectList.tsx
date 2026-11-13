import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowDownWideNarrow, CalendarClock, CircleAlert, Clock3, History, Search } from 'lucide-react';
import ObjectIdentityActions from '@/components/ObjectIdentityActions';
import SegmentedControl from '@/components/SegmentedControl';
import ObjectStatusFilter from '@/components/ObjectStatusFilter';
import ObjectPriorityFilter from '@/components/ObjectPriorityFilter';
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

// 变更流水（卡片主体）：标记与归属口径来自 shared 单点，组件不自行判断。
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
import { getTypeSurfaceTint } from '@/utils/typeSurface';

type Translate = ReturnType<typeof useI18n>['t'];
type StatusReason = { label: string; text: string; missing?: boolean };
type ObjectListSort = 'updated_desc' | 'created_desc' | 'priority_asc';

/**
 * Spark 处置次序闭集（`20 §8`：`P0`／`P1`／`P2`／`P3`）。
 *
 * 与 `api/routes/objects.ts` 的 `SPARK_PRIORITY_ORDER` 同值——排序与筛选必须
 * 认同一套次序，否则「按 P1 筛出来的」与「按优先级排出来的」会给出不同答案。
 */
const SPARK_PRIORITY_SORT_ORDER: readonly string[] = ['P0', 'P1', 'P2', 'P3'];

/**
 * `priority` 的排序键（`20 §8`/§12「按 `priority` 或时间排序」）。
 *
 * **未分档排最后**，且不得被推定为任何档位：`20 §8` 明写「未分档的 Spark 与
 * 已分档的同等合法……缺失或非法时，排序与筛选按其缺失处理，不得代为推定档位」。
 * 故缺失/非法一律取越界值，与合法档位分开。
 */
function sparkPrioritySortRank(priority: unknown): number {
  const index = typeof priority === 'string' ? SPARK_PRIORITY_SORT_ORDER.indexOf(priority) : -1;
  return index === -1 ? SPARK_PRIORITY_SORT_ORDER.length : index;
}

/** Shared vertical rhythm between a semantic card title and its first body block. */
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
  // 与各类型终态卡同源取 `disposition`（v5 闭集字段，见 factFieldContract：
  // adr/pitfall/spark/friction 的终态理由都由它承载）。此处此前读 v4 的
  // `disposition_summary`——该字段已随 23 号移出闭集，读它恒为 undefined，
  // 于是**状态说明条**对每一条终态对象都退到「缺失理由」文案，与卡体显示的
  // 完整理由自相矛盾（同一张卡上卡体写「理由全文」、说明条写「缺失」）。
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
    // `priority_asc`（`20 §8`/§12「按 `priority` 或时间排序」）：先按处置次序，
    // 同档再按最后更新倒序——同档内仍要给出「最近动过的在前」这一稳定次序，
    // 否则同档对象的相对位置会随取数顺序漂移，Human 每次看到的次序都不同。
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
}: {
  obj: ObjectItem;
  locale: string;
  onOpen: (objId: string) => void;
  children?: ReactNode;
  showNonActiveReason?: boolean;
  displayStatus?: string;
  showAssociations?: boolean;
}) {
  const { t } = useI18n();
  const { selectedProjectId } = useProjectScope();
  // 20 §9：Spark 状态闭集直接呈现（open/implemented/discarded）——v4 从关联
  // 推导 settled/unclosed 展示态的逻辑已随规范移除。
  const presentedStatus = displayStatus ?? obj.status;
  const typeColor = CATEGORY_COLORS[obj.type] || CATEGORY_COLORS.other;
  const activityCount = Array.isArray(obj.change_log) ? obj.change_log.length : 0;
  // 状态徽标文案（含「待批准执行 · 待审核」后缀）。判据收敛在
  // `getObjectStatusDisplayLabel` 单一入口——列表卡与聚焦卡、详情头必须同源，
  // 否则同一对象在不同呈现面说法不同（2026-10-17 实测发生）。
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
          {/* Human 定案：卡头标签序 = 类型 → 优先级 → 修改次数；不设关联
              chip（条件字段有值才显示，20 §8 priority 仅 open 时出现）。

              Human 复定 2026-09-16：卡头就是这几项，关联对象不进卡头。此前
              3e0cbcc 撤 chip 时写作「依据 10 §5.1 字段级直读不渲染关联关系、
              10 §5.2 卡片网格不承载关联对象」——经核对，10 §5.2 从未包含该
              禁止条文（其首条要点明列「关联计数」），§5.1 只约束第一层字段级
              直读、与第二层卡片网格互不替代（10 §5 首段：四层互不替代）。故
              此处改记为**呈现取舍**：卡头保持身份/优先级/修改次数的稳定扫描
              序，关联对象由卡体 FactAssociationsCardContent 承载。

              **2026-11-01（Human 定案）：`serves` 子目标 chip 已从卡头撤除**
              （原位置就在 PriorityIcon 之后）。子目标是承载体，spark 挂
              到它上面只是归属引用——「这条属于哪个子目标」由子目标详情页正向
              回答，卡头不再承担。`serves` 字段本身保留（25 §9 / 21 §10.3 /
              子目标反查 / 召回四处消费）。 */}
          <PriorityIcon source={obj} type={obj.type} locale={locale} size="xs" />
          {/* 26 §8 occurrence（重复观察次数）：**频次的机械权威源**——§8 明写正文现象段
              只是人类可读投影，「二者不一致时以本字段为准」。故它必须可见，否则 Human
              读不到阈值判据（36 §9 的 `count ≥ 3` 自动流转就读它）。

              与紧随的「修改次数」chip（`History` + `change_log.length`）**是两回事**：
              那是写入次数，这是被观察次数。刻意用**不同图标**（Eye vs History）区分，
              不复用同一枚，免得读者把二者当同一个量。 */}
          {obj.type === 'friction' && <FrictionOccurrenceBadge value={obj.occurrence} />}
          {/* 28 §8 `order`（显示次序）进卡头，位置在修改次数之前（Human 定案 2026-11-02
              「次序放到上面，样式对齐其他的 icon」）。理由与规格见 SubGoalOrderBadge。

              排在 friction 那枚之后**不是**疏忽：那枚只在 friction 卡上渲染，故子目标
              卡的可见序列仍是 类型 → 优先级 → 次序 → 修改次数；而把本行放进 PriorityIcon
              与 FrictionOccurrenceBadge 之间，会撑开「重复观察紧跟优先级」这条既有契约
              所依赖的源码邻接，让一个为摩擦力设的守卫为了无关的原因变红。
              （2026-11-02 注：原夹在其间的 impact chip 已随摩擦分级制度撤销，26 §8。） */}
          {obj.type === 'subgoal' && <SubGoalOrderBadge value={obj.order} />}
          <span
            className="ldvh-chip-sm gap-1 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent"
            title={t('cognition.recent.activityCount', { count: String(activityCount) })}
          >
            <History size={12} aria-hidden="true" />
            <span>{activityCount}</span>
          </span>
          {/* 10 §5.5（Human 裁定 2026-09-30，二次修订）：`outcome` **不再**在此处单列一枚
              徽标——它与状态词**合并**成一枚放在右侧（见 `ObjectIdentityActions` 的
              `statusBadge`）。 */}
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
        {/* List cards expose a stable object identity, not an exact-read source path. */}
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
      {showAssociations && <FactAssociationsCardContent associations={obj.factAssociations} refs={obj.factRefs} />}
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

/**
 * 引用行的**无标题区域**形态（Spark 卡的引用区画法，Human 2026-09-30「学习 spark 的
 * 引用方案」→ 2026-09-30 再裁定「不要标题」）：区域 = 顶部一条细分割线（`border-t`），
 * 行与行之间 `divide-y`——**没有标题、没有块边框、没有底色**。
 *
 * 为什么无标题（反向引用块沿用同款区域）：行本身**自描述**——类型图标（13px、类型色）
 * 说出这是什么类型的对象，行末状态图标说出它的状态；标题（旧「声明引用此对象的对象」）
 * 是一句规范腔长句，不增加行所没有的信息，反而制造命名难题（任何概括词都要么太长、
 * 要么冒领方向语义——如误写成「转入 Spark」会宣称承接关系）。无标题即无冒领面。
 *
 * 为什么导出为常量（单一来源纪律，`10 §5.5`）：Spark 卡（本文件的
 * `FactAssociationsCardContent`）与已关闭卡（关闭汇总的
 * 反向引用行）呈现的是**同一类信息**（指向别的对象的行）。两处各写一份类名时，改
 * 一处另一处必然漂移——与行式收敛到 `FactAssociationCardRow` 是同一条纪律，故区域
 * 类名同样单点给出。
 */

/** 引用行的行间分割（与区域常量配套：不用 gap，间距由行的 padding 提供）。 */

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
    <section onClick={(event) => event.stopPropagation()} className={FACT_ASSOCIATION_ROWS_ZONE_CLASS}>
      <div className={FACT_ASSOCIATION_ROWS_LIST_CLASS}>
        {visibleRows.map(({ association, source }, index) => <FactAssociationCardRow key={`${source}:${factCardAssociationKey(association, index)}:${index}`} association={association} locale={locale} unavailableLabel={t('objectList.associationUnavailable')} />)}
      </div>
    </section>
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
  // 23 §8：Pitfall 的终态理由由 **`disposition`** 承载（仅 discarded 时条件必填）。
  //
  // 此处曾读 `disposition_summary`——那是 v4 字段，**已随 23 号移出闭集**
  // （`factFieldContract.ts` 的 pitfall 段注释逐字记着「disposition_summary 已随
  // 23 号移除」）。读取一个已被移出的字段永远得到 `undefined`，于是每一条
  // discarded Pitfall 都退到 `dispositionMissing`，卡片上恒显「处置说明缺失。」
  // 而载体里明明写着完整理由（实测 pitfall-e590edb8：API 的列表与详情两条
  // 路径都正常送回 `disposition`，只有本处取错了键）。
  //
  // 这是「字段在、数据在、唯独消费方读错名字」的典型形态：类型检查不报错
  // （`disposition_summary` 仍在 `ObjectItem` 的 v4 兼容声明里），仅靠肉眼
  // 看卡片才能发现。故由 `pitfall-disposition-terminal-contract` 契约测试守住。
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

function AdrTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t, locale } = useI18n();
  // 22 §9：ADR 终态原因由 retirement_reason 承载（闭集 superseded/absorbed/
  // outdated/out-of-scope/abolished）；v4 disposition_summary 已不属 ADR 字段闭集。
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

/** 26 §12 F1 投影要素的列表承载：phenomenon（现象单句）+ attribution（归因，
 * 条件出现）。卡片正文段复用 pitfall
 * 活跃决策块的 amber 表面语法，但语义归账本（待修的账）。 */
/** 26 §8/§9.1：voided / accepted 的终态卡——照 Spark 的终态形态（TerminalFactPanel），
 * 读 `disposition`（终态去向说明）呈现。该字段于 2026-11 进入 §8 闭集、2026-10 扩为
 * 「voided 的废弃理由或 accepted 的不可清偿理由」，正是为了让列表卡能直接读到去向，
 * 而不必进详情页读正文「处置」段。 */
function FrictionTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  const reason = typeof obj.disposition === 'string' && obj.disposition.trim()
    ? obj.disposition.trim()
    : t('objectList.dispositionMissing');

  return <TerminalFactPanel tone="retired" content={formatReasonText(reason)} />;
}

export function FrictionCardContent({ obj }: { obj: ObjectItem }) {
  // 26 §9 四态的卡体分工（Human 裁定 2026-11「card 只显示标题」）：
  //
  // - `voided` / `accepted`：终态理由由 `disposition`（§8 条件必填）承载，走终态
  //   说明框——与 Spark 的 discarded（`SparkTerminalCardContent`）、Pitfall 的
  //   discarded、Norm 的 retired **同一形态**（`TerminalFactPanel`），Human 在列表页
  //   即可读到废弃理由或不可清偿理由，不必进详情页。
  // - `open` / `resolved`：**卡体留空**，只由卡头（类型标签 + 重复观察 +
  //   修改次数）与标题托（`ldvh-card-title`）承载身份与状态。
  //   （原卡头的轻/中重影响标签随 26 §8 撤销分级制度于 2026-11-02 移除。）
  //   这与 Spark 活跃卡的「克制」同例（`SparkCardContent`：open 时返回 null）
  //   ——标题已是现象单句的浓缩，再复述一遍现象全文与归因是重复而非信息。
  //   现象全文、入账依据、处置段住详情页阅读布局；resolved 的解药由
  //   `FactAssociationsCardContent` 的关系行呈现。
  if (obj.status === 'voided' || obj.status === 'accepted') return <FrictionTerminalCardContent obj={obj} />;
  return null;
}

/** 27 号 §9/§11 的终态承载：retired 的退出理由由 `retirement_reason` 承担
 *（闭集同 22 号形态）。活跃态不出卡体——见下方 `NormCardContent` 的撤除记录。 */
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

/**
 * 活跃规范卡：**卡头即全部，卡体不承载任何内容**（Human 定案 2026-11-02）。
 *
 * 撤掉的是两样东西，撤除理由不同，须分开记：
 *
 * ① **方向键块**（`direction_key` + 紫壳 chip）。它此前以「27 §8 专属字段、机器
 *    可验证的方向标识」为由置顶。但卡头已由 `ObjectTypeIcon` + 类型名 + 标题承担
 *    「这是什么对象的什么方向规范」，方向键短串在卡面上**不增加扫读判别力**——
 *    它是唯一性与索引的机器作用域，不是读者在列表里挑选条目的依据。读者要判断
 *    「这份规范管哪」，得到的是标题与正文四段，不是 kebab-case 串。
 * ② **类型说明行**（`getTypeDescription('norm')` =「事实规范——一个工程方向的成体系
 *    规则体系（27 §1）」）。它是**类型定义的复述**：卡头 chip 已写「规范」，把同一
 *    结论再用一句话重说一遍，属 `docs/10` §5.5「同类信息只有一处行式」的违规——
 *    而它当初能存活，是因为它与 ① 同处一个壳里，被当作「这个块的说明」而非「类型的
 *    说明」。壳一撤，它的真实身份（第二处类型定义）就露出来了。
 *
 * 撤后本组件与 `AdrCardContent` 同形：活跃态返回 `null`，只剩终态卡。这不是「忘了
 * 写卡体」，而是本类型的正文四段（方向定位/核心规则体系/约束与反模式/验证与遵从性
 * 检查）本来就是**成体系的长文**，列表格子里读不成体系——它住在详情页阅读布局。
 *
 * 连带退场（不留死常量，见 `utils/decisionBlocks.ts`）：`DECISION_CARD_SHELL_CLASS.violet`、
 * `DECISION_TITLE_HUE_CLASS.violet`、`DECISION_VIOLET_CODE_CHIP_HUE_CLASS`、
 * `getTypeDescription` 及其 `TYPE_DESCRIPTION_LOCALES` 词表、`objectList.normDirectionKeyMissing`。
 */
export function NormCardContent({ obj }: { obj: ObjectItem }) {
  if (obj.status === 'retired') return <NormTerminalCardContent obj={obj} />;
  return null;
}

/**
 * 29 号 §8 `summary`（当前语义快照）的卡面承载：DevLog 卡。
 *
 * ## 为什么卡面要放 `summary`（与 Spark/Pitfall 的「克制」不同例）
 *
 * `title` 在 29 号是**明令不承载结论**的短标题（§8：「不承载结论」）——它只回答
 * 「这条日志大致关于什么」。而本类型的**存在理由**就是那条结论：读者打开列表是要
 * 找回「这件事当时得出什么」。若卡面只剩标题，每条都要下钻才知道说的是哪句话，
 * 而列表恰恰是「扫一遍找到我要找的那条」的地方。故卡面必须给出 `summary`。
 *
 * 这与 Spark 的克制不矛盾：Spark 卡之所以留空，是因为它的 `question` 与 `summary`
 * 都住详情、且标题已足够区分；DevLog 的 `title` 被规范明文排除在结论之外，故没有
 * 同一条退路。
 *
 * ## 只放 `summary`，不放正文五段
 *
 * 正文五块（背景/做法/实测/结论与边界/去向）是**详情阅读面**的事——它们合起来是一篇
 * 短报告的体量。卡面放摘要 + 正文也放，等于同一段话出现两遍（29 §8 不变量 1 规定
 * `summary` 必须逐字出现在「结论与边界」段，故它本来就在那里）。
 *
 * ## 承载面染本类型的色（Human 定案 2026-11-02：「要和类型的颜色对上」）
 *
 * 这个块起初复用另一类型判据面的**整面**样式（含蓝）——那是 2026-11-02
 * 早先「对齐判据面」时照抄的结果，但蓝是某个类型自己的类型色。DevLog 当时的类型色是
 * magenta `#ca21a0`，卡头那枚「开发日志」chip 是品红、块却是蓝的，同一张卡上两个色相
 * 各说各话（该类型色已于 2026-11-03 改为青绿 `#2c9e43`，本段的色相名字仍是历史记录）。
 * 现在几何仍取 `"min-w-0 rounded-lg border px-3 py-2"`（四边同宽 1px、8px 圆角、
 * 8/12 内距），**色相改由 `getTypeSurfaceTint(obj.type)` 从类型色单一来源计算**。
 * 由此本块与卡头 chip、侧栏图标天然同源，不再需要第二张色表。
 *
 * ## 终态不换成「理由框」（与其余类型的形态差异，理由在此）
 *
 * 其余类型的终态卡读 `disposition` 或 `retirement_reason` 呈现退出理由；DevLog 的
 * 三个终态里只有 `dropped` 带 `disposition`，`absorbed` / `superseded` 的「去向」
 * 写在 `relations` 的承接/推翻边上，由 `FactAssociationsCardContent` 的关系行呈现
 * ——那已经是卡级区域（`ObjectCardFrame` 在 children 之后渲染）。故卡体对终态**不做
 * 特殊分支**，`summary` 照常显示：结论不因终态而消失（§9.1「结论本身永不随压缩
 * 消失」），它仍是读者要读的那句话。
 */
export function DevLogCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

  // `summary` 是 29 §8 的必填字段。真的为空时**不画空框**（同子目标判据面的
  // 处置）：空框会让读者以为框里本该有内容而读取失败，实际是载体不合规——详情页
  // 的字段问题区会如实报出。此处给一句显式的缺失说明，因为卡面没有别处能承载
  // 这条结论，静默返回 null 会让这张卡看起来「没有可读内容」。
  if (!summary) {
    return (
      <p className={`ldvh-card-decision-body min-w-0 break-words text-ldvh-text-secondary/80`}>
        {t('objectList.devlogConclusionMissing')}
      </p>
    );
  }

  const tint = getTypeSurfaceTint(obj.type);
  return (
    <section
      className={"min-w-0 rounded-lg border px-3 py-2"}
      style={tint.surface}
      onClick={(event) => event.stopPropagation()}
    >
      <SummaryText
        value={summary}
        // 卡面是扫读窗口：`summary` 是「当前语义快照」，它随边界认识演化会长成
        // 一段话。超长时按段落折叠并给展开入口（同 SummaryText 的其余消费点），
        // 不截断到无法判断「这条结论还成不成立」——那是本类型最怕的失真。
        collapseThreshold={420}
        // 正文色必须经 `bodyStyle` 传到 `.ldvh-inline-markdown` 上，**不能**只给
        // 外层元素设 `style.color`：Markdown 渲染出的 `<p>` 由 `github-markdown-css`
        // 着色（`--fgColor-default`），**不继承**外层 color。2026-11-02 实测外层已
        // 生效、块内正文仍是近黑——「色相面与正文分家」正是那次实拍发现的。
        bodyStyle={tint.body}
        className="ldvh-card-decision-body [&_p]:my-0"
      />
    </section>
  );
}

/**
 * 28 号 §12 F1 投影的列表承载：子目标卡。
 *
 * 三件事必须在卡片层就能读出来，否则每一条都要下钻才知道自己看的是什么：
 *   ① 显示次序（`order`）——**不是身份**（2026-11-01 废止 SG-n 业务编号，28 §7）。
 *      它只回答「这一条在列表里排第几」，可缺失、可调整、不参与任何引用。
 *   ② 判据类型——它决定「这条子目标要靠什么材料才算达成」，比标题更能区分条目
 *   ③ 达成条件的一句话——**不是**标题重复，标题只有 40 字且不承载完整判据（§8）
 *
 * achieved / retired 走终态面板：达成与作废都是「这条已经不动了」，用统一的
 * 终态语言呈现，读者不必在活跃列表里逐条分辨。achieved 的说明只陈述状态本身，
 * 不写「名下工作都完成了」——那正是本类型最主要的误读（§18 红线 3）。
 */
function SubGoalTerminalCardContent({ obj }: { obj: ObjectItem }) {
  const { t } = useI18n();
  const disposition = typeof obj.disposition === 'string' && obj.disposition.trim()
    ? obj.disposition.trim()
    : '';
  if (obj.status === 'achieved') {
    // achieved 走 implemented 档（emerald 正向）：达成是正结果，不是收敛。
    // retired 走 retired 档（中性灰）：作废是收敛。
    return <TerminalFactPanel tone="implemented" content={t('objectList.subGoalAchievedNote')} />;
  }
  return (
    <TerminalFactPanel
      tone="retired"
      content={formatReasonText(disposition || t('objectList.dispositionMissing'))}
    />
  );
}


/**
 * 子目标卡的**关联区**（Human 决定 2026-11-02：「当前的子目标的 card，需要学习
 * spark 的 card 可以挂载关联对象，关联的对象按类型分层，每个类型
 * 最多展现 3 个，其他的要可以收起展开」）。
 *
 * 数据是 28 §8.1 的**读取时派生**（`serves` 反查），不是本对象存储的字段——故这
 * 一块不是「子目标的第二事实源」，它只是同一次反查的呈现。服务端已把索引算好
 * 随列表项送达，卡面不再逐条请求详情（同一判据不重算 N 遍）。
 *
 * 三条约束与既有卡面语言对齐：
 *  ① 区域形态沿用 `FACT_ASSOCIATION_ROWS_ZONE_CLASS`（顶部分割线 + 行间分割线，
 *    无块边框、无底色）——与 Spark 引用区同一处来源；
 *  ② 行式沿用 `FactAssociationCardRow`（类型图标 + 标题 + 行末状态图标，可点开
 *    扩展阅读）——不得自建第二套；
 *  ③ 空集是**歧义**不是进度 0（28 §8.1），读不到是**第三态**不得并入空集（00 §4.6）。
 *
 * **与 `docs/03` §3.2「不设类型分组标题」的关系（如实登记）**：那条约束的是
 * **正式 `relations` 关联区**——那里的行由类型图标自描述，分组标题不增加信息。
 * 本区是**多个不同类型簇并列**，且每簇各有自己的展示预算（先 3 条），没有层名读者
 * 就分不清「这 3 条是某一类的 3 条」还是「几类一共 3 条」。故本区设层名，
 * 并只写**类型名 + 计数**（不写「关联」「工作」一类概括词，避免冒领方向语义）。
 */
function SubGoalServingWorkCardZone({ obj }: { obj: ObjectItem }) {
  // 2026-11-03：名下工作区的**渲染**下沉到 `components/SubGoalCardParts`，与聚焦页
  // 目标区同源（两处读同一批字段，各写一份必分叉）。此处只保留调用与本区域的规格
  // 归属。
  //
  // 规格要点（随实现下沉，理由留在组件处）：
  // - **不设层名**（Human 定案 2026-11-02：圈出的两行计数去掉）：
  //   行本身**自描述**——行首的类型图标已经说出这是什么类型的对象，再写一遍类型名
  //   是同一信息的第二次呈现；计数由「其余 N 条」与可见行数共同给出。此前我曾在此
  //   加过「类型图标 + 类型名 + 计数」的层名并为它写了理由，那是**给违规找理由**——
  //   `docs/03` §3.2 明文「不设类型分组标题」。
  // - **空集必须显式标注歧义**（28 §8.1）：真的还没拆解，与拆解了却没人写 serves，
  //   在机械层长得一模一样。故既不画 0 也不画进度条。
  // - **读不到不等于没有**（00 §4.6）：无法枚举的类型单列，绝不并进空集。
  const rows: ServingWorkItem[] = Array.isArray(obj.serving_work) ? obj.serving_work : [];
  const unreadable = Array.isArray(obj.serving_unreadable) ? obj.serving_unreadable : [];
  return <SubGoalServingWorkZone rows={rows} unreadable={unreadable} />;
}

export function SubGoalCardContent({ obj }: { obj: ObjectItem }) {
  // 关联区与卡体**并列**、挂在卡级，不进 lime 判据框（Human 2026-11-02「学习 spark
  // 的 card」）：Spark 的关联行由 `ObjectCardFrame` 在 `children` 之后以顶部分割线
  // 承载，是卡级区域；把它塞进判据框会让「判据」与「名下工作」看起来同属一个判断。
  //
  // **不按状态分支**（同 Spark 的 2026-09-16 裁定）：达成/作废的子目标名下工作仍是
  // 可核对的历史——「这件工作曾服务于那条已达成的子目标」是事实（28 §12.3 第 4 条）。
  //
  // 判据面与名下工作区改为复用 `components/SubGoalCardParts`（2026-11-03）——聚焦页
  // 目标区与本卡读的是同一批字段，若各写一份，「判据长什么样」「空集歧义怎么提示」
  // 会分叉，而分叉时没有机械判据说哪边才是对的。
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

/** 活跃子目标的判据面（只说一件事：这一条怎么算达成）。
 *
 * **几何对齐判据面**（Human 定案 2026-11-02：「这里的样式对齐判据面的，
 * 左侧的线条不要加粗」）：复用 `"min-w-0 rounded-lg border px-3 py-2"` —— 四边同宽 1px、
 * `rounded-lg`、`px-3 py-2`，**没有左侧 2px 粗线**。故本框 2026-11-02 起退出
 * `DECISION_CARD_SHELL_CLASS` 家族（该家族的定义特征正是左色条）。
 *
 * **色相取本类型色，不取别的类型的蓝**（Human 定案 2026-11-02：「圈出来的要和类型的
 * 颜色对上，也就是同一个色系的」）。本框曾整面复用另一类型的判据面样式，
 * 那是把「对齐样式」读成了「用对方的颜色」——蓝是那个类型自己的
 * 类型色，子目标的类型色是 lime `#84cc16`。卡头 chip 说 lime、块说蓝，同一张卡上两个
 * 色相各说各话。现在几何取统一形态，色相改由 `getTypeSurfaceTint(obj.type)`
 * 从类型色算得（同一个函数也服务 DevLog 卡与后续同形块）。
 *
 * **框内只剩一句话**（Human 定案 2026-11-02「次序 闭环记录都不用显示」）：
 * - `order` 已在卡头（同一次定案「次序放到上面」）：它是跨条比较的扫读要素。
 * - `criterion_kind`（「闭环记录」等）不再上卡面：它是**判定口径**，回答「用什么材料
 *   判」；卡面只回答「算什么」。两者在卡面上并排时，读者看到的是两行标签加一句正文，
 *   扫读成本高于信息量。判定口径与其说明住详情页判据锚点（`SubGoalReadingLayout`）。
 *   28 §8 要求该字段必填，故它不会因为卡面不显示而在载体里消失。
 *
 * 2026-11-03：判据面的**渲染**下沉到 `components/SubGoalCardParts`（与聚焦页目标区
 * 同源）；此处保留本函数是为了留住上面那段规格说明的归属。 */
function SubGoalActiveCardBody({ obj }: { obj: ObjectItem }) {
  const criterion = typeof obj.criterion === 'string' ? obj.criterion.trim() : '';
  // `criterion` 是 28 §8 的必填字段。真的为空时**不画一个空框**——空框会让读者以为
  // 框里本该有东西而读取失败，而实际是载体不合规；详情页的字段问题区会如实报出。
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

  const currentType = type ?? 'spark';
  const statusParam = searchParams.get('status');
  const activeStatus = getEffectiveListStatus(currentType, statusParam);
  // Spark 三联过滤之三：priority（20 §8，仅 spark 生效；闭集 P0–P3）。
  const priorityParam = searchParams.get('priority');
  const supportsPriorityNavigation = currentType === 'spark';
  const activePriority = supportsPriorityNavigation
    && (priorityParam === 'P0' || priorityParam === 'P1' || priorityParam === 'P2' || priorityParam === 'P3')
    ? priorityParam
    : null;
  const sortParam = searchParams.get('sort');
  // `priority_asc` 只在 spark 生效：`priority` 是 Spark 专有字段（`20 §8`；
  // 其它类型闭集亦无此项），对它们提供该排序会让「按优先级排」
  // 对它们退化成纯时间序，名称与实际不符。
  const supportsPrioritySort = currentType === 'spark';
  const activeSort: ObjectListSort = supportsPrioritySort && sortParam === 'priority_asc'
    ? 'priority_asc'
    : sortParam === 'created_desc' ? 'created_desc' : 'updated_desc';
  // v5 无 priority 字段：20 §289（v4 priority 不迁入）与 21 §8 字段闭集均无此项，
  // 且 22 §271/23 §252/26 §258 判定 priority 类为无消费方装饰字段（03 §11.3-4
  // 要求字段扩展先说明消费方）。两侧 tab 均不提供优先级过滤。

  useEffect(() => {
    const removesLegacyCategory = currentType === 'spark' && searchParams.has('category');
    const removesForeignProgress = searchParams.has('progress');
    // 2026-11-01：`serves` 筛选已从 Web 撤除（见下方撤除说明），旧链接里的
    // `?serves=<uid>` 一律清掉——留着会让 URL 看起来仍在生效。
    const removesRetiredServes = searchParams.has('serves');
    if (!removesLegacyCategory && !removesForeignProgress && !removesRetiredServes) return;
    const nextParams = new URLSearchParams(searchParams);
    if (removesLegacyCategory) nextParams.delete('category');
    if (removesForeignProgress) nextParams.delete('progress');
    if (removesRetiredServes) nextParams.delete('serves');
    setSearchParams(nextParams, { replace: true });
  }, [currentType, searchParams, setSearchParams]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setStatusOptions([]);
    setPriorityOptions([]);
    setStatusTotal(0);
    setCoverageStatus('complete');
    setCoverageProblemCount(0);
    setCoverageProblems([]);
    fetchObjects(currentType, activeStatus ?? undefined, undefined, activePriority ?? undefined)
      .then((result) => {
        const receivedItems = result.data?.items ?? [];
        const nextItems = receivedItems
          .filter((item) => !isDeprecatedListCard(item) || searchParams.get('status') === ALL_STATUS_PARAM || activeStatus === item.status);
        setItems(nextItems);
        setStatusOptions(result.data?.statusOptions ?? []);
        setPriorityOptions(result.data?.priorityOptions ?? []);
        setStatusTotal(result.data?.statusTotal ?? nextItems.length);
        setCoverageStatus(result.data?.coverage_status ?? 'complete');
        const nextCoverageProblems = result.data?.collection_issues ?? [];
        setCoverageProblems(nextCoverageProblems);
        setCoverageProblemCount(nextCoverageProblems.length);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  // 本 effect 对 searchParams 的唯一读取是 `searchParams.get('status')`，其值已作为
  // statusParam 列入下方依赖（第 884 行定义），故不存在陈旧闭包：status 一变，
  // statusParam 即变，effect 必然重跑。而把整个 searchParams 对象加入依赖会适得其反——
  // sort/serves 只改 URL、不改取数参数（fetchObjects 只吃 type 与三个筛选），
  // 却会因此触发重取并把列表清成 spinner。最干净的写法是在该 filter 里直接用
  // statusParam，但那行表达式被 pitfall-card-contract.test.ts:13 逐字钉住。
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上方说明：读取值已在依赖中，加对象反致多余重取
  }, [currentType, activeStatus, activePriority, statusParam]);

  const sortedItems = sortObjectsForList(items, activeSort);
  const normalizedObjectSearch = objectSearch.trim().toLowerCase();
  const filteredItems = normalizedObjectSearch
    ? sortedItems.filter((item) => {
      const title = getLocalizedObjectTitle(item, locale).toLowerCase();
      const objectId = item.id.toLowerCase();
      return title.includes(normalizedObjectSearch) || objectId.includes(normalizedObjectSearch);
    })
    : sortedItems;

  // 2026-11-01（Human 定案）：**`serves` 不再在 Web 上呈现或筛选**。
  //
  // 原先这里有两块：一处客户端的 serves 二次筛选 + 一处按 serves 聚合的计数
  // （配一行筛选 tab）。撤除的理由不是「不好用」，而是**方向错
  // 了**：子目标才是承载体，spark 挂到子目标上只是归属引用；「这个子目
  // 标下面有哪些工作」由子目标详情页的「名下的工作」正向回答（`deriveServingWork`
  // 反查），不需要让 Human 在每个列表页先选一个子目标再看被过滤的池子。
  //
  // 撤除同时省掉一个真实成本：这段筛选每次进列表页都 `fetchCognitionGoal()`
  // 拉整份目标投影，只为换一行四个 tab。
  //
  // **字段本身不动**——`serves` 有四个非呈现消费方（25 §9 达成判定、21 §10.3
  // 局部重批、子目标详情反查、召回 F1/F2）。撤的是呈现，不是引用。

  const handleStatusChange = (status: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    writeListStatusParam(currentType, nextParams, status);
    setSearchParams(nextParams);
  };

  const handlePriorityChange = (priority: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (priority) nextParams.set('priority', priority);
    else nextParams.delete('priority');
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

    if (currentType === 'subgoal') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <SubGoalCardContent obj={obj} />
        </ObjectCardFrame>
      );
    }

    if (currentType === 'devlog') {
      return (
        <ObjectCardFrame key={obj.id} obj={obj} locale={locale} onOpen={openObject} showNonActiveReason={false}>
          <DevLogCardContent obj={obj} />
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
        {/* 2026-11-01（Human 定案）：子目标筛选条已撤除——`serves` 不再参与
            Web 呈现与筛选。子目标名下的工作由子目标详情页正向回答。 */}
        <div className="relative flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
            <ObjectStatusFilter
              type={currentType}
              activeStatus={activeStatus}
              onChange={handleStatusChange}
              options={statusOptions}
              total={statusTotal}
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
                // `20 §8`/§12「按 `priority` 或时间排序」：仅在 spark 列出该档，
                // 因为 `priority` 是 Spark 专有字段（21 §8 闭集无此项）。
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

      {/* Content */}
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
        // 空态分两句（Human 定案 2026-11-02）：读者看到空屏时问的是两个不同的问题——
        // 「这个类型本来就没有东西」还是「我筛得太窄」。此前一律答「未找到 {type} 对象」，
        // 既没区分，`{type}` 又传的是**原始类型键**（norm / devlog），中文界面里冒出英文键。
        //
        // 判据用 `statusTotal`（服务端按**未应用状态筛选**的池子计数）：它为 0 才说明该
        // 类型一条对象都没有；大于 0 而当前列表为空，只能是筛选/搜索把它们挡掉了。
        // 不用 `items.length`——那正是被筛过的结果，用它判会把「筛选后为空」误报成「本来没有」。
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
