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
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, CirclePlay, HeartPulse, History, Inbox } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import GoalSection from '@/components/GoalSection';
import ObjectReferenceCopyButton from '@/components/ObjectReferenceCopyButton';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import ServesSgBadge from '@/components/ServesSgBadge';
import FrictionImpactBadge from '@/components/FrictionImpactBadge';
import FrictionOccurrenceBadge from '@/components/FrictionOccurrenceBadge';
import {
  FrictionCardContent,
  ObjectCardFrame,
  PitfallCardContent,
} from '@/pages/ObjectList';
import StatusBadge from '@/components/StatusBadge';
import PriorityIcon from '@/components/PriorityIcon';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import {
  fetchCognition,
  type CognitionActiveWorkCaseItem,
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
import { WorkCaseCriteriaList, WORKCASE_CRITERIA_SURFACE_CLASS } from '@/components/WorkCaseCriteriaList';
import WorkCaseExecFlow from '@/components/WorkCaseExecFlow';
import WorkCaseGistLine from '@/components/WorkCaseGistLine';
import WorkCaseResultDraft from '@/components/WorkCaseResultDraft';
import { usePanel } from '@/utils/panelContext';
import { useProjectScope } from '@/utils/projectContext';
import { useI18n } from '@/i18n/context';
import { getLocalizedObjectTitle, getObjectStatusDisplayLabel, getObjectStatusLocale, getTypeLabel, type LocaleKey } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { getDefaultSparkHealthAgeFilter, type SparkHealthAgeFilter } from '@/utils/cognitionSparkHealth';
import { LDVH_ERROR_TEXT_CLASS } from '@/utils/semanticColors';
import FieldReadNotes from '@/components/FieldReadNotes';

/** 首屏截断阈值：Web 展示参数，不是事实；截断时底部如实提示总数与未显示数量。 */
const INBOX_FIRST_SCREEN_LIMIT = 8;
const ACTIVE_WORKCASE_FIRST_SCREEN_LIMIT = 8;
const RECENT_ACTIVITY_FIRST_SCREEN_LIMIT = 6;
const RECENT_ACTIVITY_MAX_VISIBLE = Number.MAX_SAFE_INTEGER;
const SPARK_HEALTH_FIRST_SCREEN_LIMIT = 6;
const SPARK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

const RECENT_ACTIVITY_WINDOWS: CognitionRecentActivityWindow[] = ['1d', '3d', '7d'];
const SPARK_HEALTH_AGE_FILTERS: SparkHealthAgeFilter[] = ['all', '3d', '7d'];


const INBOX_KIND_LABEL_KEYS: Record<CognitionInboxKind, LocaleKey> = {
  plan_confirmation: 'cognition.kind.plan_confirmation',
  closure_confirmation: 'cognition.kind.closure_confirmation',
  pitfall_confirmation: 'cognition.kind.pitfall_confirmation',
  // 26 §12：open 摩擦账目进待决定事项（Human 2026-10-19 决定）。标签词刻意用
  // 「待修摩擦」而非「待确认」——它不是 Human Gate、没有一步待授权动作，混用
  // 「待确认」会让 Human 去找一个不存在的批准按钮（26 §9 的流转由
  // Human Gate 与补充级更新各自承载，本页只呈现）。
  friction_repair: 'cognition.kind.friction_repair',
};

type Translate = ReturnType<typeof useI18n>['t'];

function formatHumanObjectReference(type: string, title: string, locale: string): string {
  return `${getTypeLabel(type, locale)}《${title}》`;
}

// 五个「面向 AI 对话的模块摘要」构造器：**当前无渲染调用方**，但按契约测试保留。
//
// 来历：9cec955（2026-09-09「去掉非事实对象的复制按钮」）移除了它们的全部调用方
// （模块区头的复制入口），定义随之成为孤儿；tests/api/cognition-inbox-contract.test.ts
// 的「all five AI module summaries use human-readable type and title without machine
// locators」逐名断言这五个函数**必须存在且各自可独立检视**，并钉住其语义
// （用 `类型《当前 Title》`、不得暴露 projectId 等机器定位符）。
//
// 故此处不删除：删除会使该契约测试失败，且那是一次产品语义的取舍（要不要恢复
// 摘要出口），超出「清 lint」的范围。豁免只覆盖这一段，不掩盖该区域将来新增的
// 未使用变量——它由下一行的 eslint-enable 收口。
/* eslint-disable @typescript-eslint/no-unused-vars -- 见上方说明：契约测试逐名钉住的 AI 对话摘要构造器 */
/** 面向 AI 对话的模块摘要：模块名、关键计数与类型《当前标题》（不含机器身份与未精确读取的路径）。 */
function buildModuleSummary(data: CognitionData, locale: string, t: Translate): string {
  const lines: string[] = [];
  lines.push(t('cognition.inbox.title'));
  const counts: Record<CognitionInboxKind, number> = {
    plan_confirmation: 0,
    closure_confirmation: 0,
    pitfall_confirmation: 0,
    friction_repair: 0,
  };
  for (const item of data.inbox.items) counts[item.inboxKind] += 1;
  const countParts = (Object.keys(counts) as CognitionInboxKind[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${t(INBOX_KIND_LABEL_KEYS[kind])} ${counts[kind]}`);
  lines.push(`total: ${data.inbox.total}${countParts.length > 0 ? ` (${countParts.join(', ')})` : ''}`);
  // 26 §12：已接受成本单列——**不进** inbox 计数（accepted 不是待决定事项），
  // 只作独立观测量随摘要呈现，避免把「记录一次、不再报告」读成待办。
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
  ];
  // 2026-09-27：原此处遍历 `health.silentItems`（按无规范来源的 5 天阈值筛出的
  // 「沉默」子集）逐条列出。该阈值已移除，改为列出**全部待处理 Spark**——摘要的
  // 定位（面向 AI 对话、用「类型《当前标题》」、不暴露机器身份）不变，只是不再
  // 由一条无来源的判据预先过滤。
  for (const item of health.openItems) {
    lines.push(`- ${formatHumanObjectReference('spark', getLocalizedObjectTitle(item, locale, item.id), locale)} · ${t('cognition.sparkHealth.silentDays', { days: String(item.silentDays) })}`);
  }
  return lines.join('\n');
}

/* eslint-enable @typescript-eslint/no-unused-vars -- 五个 AI 对话摘要构造器到此为止 */

/** 读取问题与未解析结构在消费位置就地显示（02 §5.4）。 */
type CognitionCardItem = CognitionInboxItem | CognitionActiveWorkCaseItem;

function InboxItemReadNotes({ item, locale }: { item: CognitionCardItem; locale: string }) {
  return <FieldReadNotes source={item} locale={locale} className="mt-2" />;
}

// `t` 已不再是本函数的依赖：改用共享组件后不再在此拼接文案（Human 2026-09-24）。
function InboxCardContent({ item }: { item: CognitionInboxItem }) {
  if (item.type === 'pitfall') return <PitfallCardContent obj={toObjectCard(item)} />;
  // 26 §9 卡体分工：`open` 摩擦的卡体**留空**（与 `resolved` 同），身份与
  // 状态由卡头（类型 + 影响 + 重复观察 + 修改次数）与标题托承载——标题已是现象单句的
  // 浓缩。现象全文、入账依据住详情页；故这里与列表卡同走 `FrictionCardContent`
  // （它对非 `voided` 返回 null），不另写一套聚焦专属卡体。
  if (item.type === 'friction') return <FrictionCardContent obj={toObjectCard(item)} />;
  if (item.inboxKind === 'plan_confirmation') {
    // 「待批准执行」的待决定卡：与列表卡的 pending_gate1 卡体**同构**（2026-10-17）。
    //
    // 此前本分支只有 gist + 计划清单，**缺变更流水**——而列表卡早有它。Human 于
    // 2026-10-17 指出「显示了『待批准执行 · 待审核』但没有 changelog」：徽标恢复了，
    // 流水仍是缺的。根因同上一条（`displayStatus` 那条）：块的选择不同，不是样式差异。
    //
    // 建前审核场景下这条流水尤其必要——它是 Human 判断「这份候选有没有动静、是不是
    // 已经派过审核」的唯一时间线线索。组件与执行中卡、列表卡**同一份**。
    return (
      <div className="grid min-w-0 gap-2">
        <WorkCaseGistLine gist={item.card.gist} group="pending_gate1" boxed />
        {Array.isArray(item.card.plan) && item.card.plan.length > 0 ? (
          <div className={WORKCASE_CRITERIA_SURFACE_CLASS}>
            <WorkCaseCriteriaList
            density="card"
              items={item.card.plan.map((step, index) => ({ key: String(index), statement: step.step ?? '' }))}
            />
          </div>
        ) : null}
        <WorkCaseExecFlow
          changeLog={item.card.change_log}
          reviews={item.card.reviews}
          selfUid={item.id}
        />
      </div>
    );
  }
  if (item.inboxKind === 'closure_confirmation') {
    // Human 2026-09-24：「聚焦里，待决定事项中的 wc card…保持与 wc card 一样的显示」。
    //
    // 此前本分支**另写一套**：outcome chip + `criteria_checks` 纯列表 + `gate_1` 行。
    // 与列表卡的差异不只是样式——**块的选择就不同**：列表卡有核对 + 残留（含去向）两块
    // （残留与去向在本分支**完全缺失**），且核对用的是带三态标记与分割线的
    // `WorkCaseResultDraft`，而本分支用裸列表 + `workCaseCheckStatement`（证据长句，
    // 实测最长 258 字，正是列表卡早已废弃的形态）。
    //
    // 现改用**同一个组件**：块、标记、分割线、折叠阈值全部同源；`gate_1` 行归详情面
    // （列表卡亦不在卡体显示）。聚焦卡的外层结构（`ObjectCardFrame` 等）不变。
    return (
      <div className="grid min-w-0 gap-2">
        <WorkCaseGistLine gist={item.card.gist} group="awaiting_gate2" boxed />
        <WorkCaseResultDraft
          plan={item.card.plan}
          checks={item.card.result_checks}
          advice={item.card.advice}
          adviceNote={item.card.advice_note}
          residual={item.card.result_residual}
          residualEntries={item.card.result_residual_entries}
        />
        {/* 变更流水（Human 2026-10-17：全部 WC 卡都要显示 changelog）：与列表卡的
            awaiting_gate2 卡体同构，默认展开。 */}
        <WorkCaseExecFlow
          changeLog={item.card.change_log}
          reviews={item.card.reviews}
          selfUid={item.id}
        />
      </div>
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
    status: item.type === 'workcase' ? item.group : item.status,
    ...(item.type === 'workcase' ? { group: item.group } : {}),
    // 建前审核后缀的数据（21 §8 `pre_reviews`）：聚焦卡的徽标走与列表卡同一个
    // `ObjectCardFrame` + 同一个 `getObjectStatusDisplayLabel` 入口，故这里只要把
    // 判据透传进去。显式赋值而非依赖 `...item.card` 展开——展开是隐式的，
    // 字段从 card 上消失时不会有任何报错，正是「两处不同步」的温床。
    ...(item.type === 'workcase' && item.card.pre_audit_passed !== undefined
      ? { pre_audit_passed: item.card.pre_audit_passed }
      : {}),
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
  const { locale } = useI18n();
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
        displayStatus="executing"
      >
        <div className="grid min-w-0 gap-2">
          {/* 10 §5.5 登记「聚焦收件箱卡体（待决定事项 / 推进中事项）」两处都渲染 gist。
              本行是「推进中事项」。它与下方 InboxCardContent 是同一呈现契约的两个落点，
              不得只改一处。 */}
          <WorkCaseGistLine gist={item.card.gist} group="executing" boxed />
          {/* Human 2026-09-24：「推进中事项的 wc card，保持与 wc card 一样的显示」。
              此前本处用 attempt 行 + 计划清单，与列表卡的「变更流水」不同——
              **块的选择就不同**，不是样式差异。现改用同一个组件 `WorkCaseExecFlow`
              （复核/修订标记的口径全部来自 shared/workcaseLifecycle，本组件不自行判断）。
              attempt 的控制者与心跳归详情面（列表卡亦不在卡体显示）。 */}
          <WorkCaseExecFlow
            changeLog={item.card.change_log}
            reviews={item.card.reviews}
            selfUid={item.id}
          />
        </div>
        <InboxItemReadNotes item={item} locale={locale} />
      </ObjectCardFrame>
    </li>
  );
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
        displayStatus={item.type === 'workcase' ? item.group : undefined}
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
  const status = item.type === 'workcase' ? item.group : item.status;
  const typeColor = CATEGORY_COLORS[item.type] || CATEGORY_COLORS.other;
  const open = () => openPanel({ type: 'object', title, objectType: item.type, objectId: item.id });
  return (
    <li className="min-w-0 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="ldvh-caption shrink-0 text-ldvh-text-secondary">{item.relativeTime}</span>
        <span
          className="ldvh-chip-sm shrink-0"
          style={{ backgroundColor: `${typeColor}18`, borderColor: `${typeColor}55`, color: typeColor }}
        >
          {getTypeLabel(item.type, locale)}
        </span>
        {/* Human 2026-09-10 定案：近期动态行不显示研究问题——该行是动态摘要不是
            F1 卡（24 §12 的 research_question 卡片摘要投影归对象列表卡片承载）。 */}
        <PriorityIcon source={item} type={item.type} locale={locale} size="xs" />
        <ServesSgBadge value={item.serves} locale={locale} />
        {/* 26 §8 impact（轻/中/重）：与列表卡卡头、详情身份头**同序同形**（类型 →
            优先级 → SG → 影响 → 修改次数），经同一个共享组件渲染。
            Human 2026-11：「聚焦里依然没有重中轻的标签」——此前本行只挂了
            PriorityIcon 与 ServesSgBadge，且 API 侧未投影 impact。 */}
        {item.type === 'friction' && <FrictionImpactBadge value={item.impact} locale={locale} />}
        {/* 26 §8 occurrence：同上（三处同序同形，共享组件）。 */}
        {item.type === 'friction' && <FrictionOccurrenceBadge value={item.occurrence} />}
        <ActivityCountBadge count={item.activityCount} label={t('cognition.recent.activityCount', { count: String(item.activityCount) })} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Human 定案 2026-09-12：goal 不显示状态徽章；复制与其他对象一致
              （projectId@目标md路径——goal 单例路径即身份，引用形态是 md 路径）。 */}
          {status && item.type !== 'goal' && <StatusBadge status={status} statusLabel={getObjectStatusDisplayLabel(item.type, status, locale, item.pre_audit_passed)} objectType={item.type} size="xs" variant="compact" />}
          <ObjectReferenceCopyButton projectId={selectedProjectId} objectId={item.type === 'goal' ? 'ldvh-base/goal.md' : item.id} />
        </span>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => openOnKeyboard(event, open)}
        className="group ldvh-object-title-tray ldvh-object-title-tray-compact mt-1.5 -mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 px-2.5 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
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
          className="ldvh-chip-sm shrink-0"
          style={{ backgroundColor: `${item.typeColor}18`, borderColor: `${item.typeColor}55`, color: item.typeColor }}
        >
          {getTypeLabel(item.type, locale)}
        </span>
        <PriorityIcon source={item} type="spark" locale={locale} size="xs" />
        <ServesSgBadge value={item.serves} locale={locale} />
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
        className="group ldvh-object-title-tray ldvh-object-title-tray-compact mt-1.5 -mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 px-2.5 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
      >
        <ObjectTypeIcon type="spark" size={15} className="shrink-0" style={{ color: item.typeColor }} />
        <h4 className="ldvh-card-title min-w-0 flex-1 whitespace-normal break-words group-hover:text-ldvh-accent">{title}</h4>
      </div>
      {showReadNotes && <FieldReadNotes source={item} locale={locale} />}
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

export default function CognitionCenter({ embedded = false }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<CognitionData | null>(null);
  // 「本模块是否已有快照」不能用 data 作为 effect 依赖：setData 后 data 变化会重新
  // 触发取数，形成自激循环（react-hooks/exhaustive-deps）。故用 ref 记录同一事实——
  // setData 是 data 的唯一写入点，ref 与它同步写入，语义与 `data !== null` 等价。
  const hasSnapshotRef = useRef(false);
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
  const { t, locale } = useI18n();

  // 首次进入才阻塞整页；切换近期窗口保留当前内容，只在本模块内更新快照。
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
  return (
    <div className={`flex min-h-full flex-col${embedded ? '' : ' p-6'}`}>
      <div className="ldvh-page-toolbar mb-4 min-w-0 shrink-0">
        <PageHeader title={t('cognition.title')} compact />
      </div>

      {/* 模块零 目标：Goal(25) 投影，置顶于待决定事项之前 */}
      <GoalSection />

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

      {/* 推进中事项：只收纳派生 group=executing 的 WorkCase（v5 三态直读），并复用对象列表进行中 Card。 */}
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
            <button
              type="button"
              aria-expanded={activeExpanded}
              aria-controls="cognition-active-workcases-content"
              onClick={(event) => {
                event.stopPropagation();
                setActiveExpanded((expanded) => !expanded);
              }}
              className="ldvh-icon-button"
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
    </div>
  );
}
