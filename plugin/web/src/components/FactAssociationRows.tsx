import { Activity, CircleCheck, CircleHelp, CircleMinus, CirclePlay } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n/context';
import { getLocalizedObjectTitle } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { usePanel } from '@/utils/panelContext';
import { ObjectTypeIcon, OBJECT_TYPE_ICONS } from '@/components/SemanticIcon';
import type { FactCardAssociation, FactRefSource, ServingWorkItem, WorkCaseV5Group } from '@/utils/api';

/**
 * 卡片**关联行**的共享实现（2026-11-03 自 `pages/ObjectList.tsx` 抽出）。
 *
 * ## 为什么抽出来
 *
 * 关联行（类型图标 + 标题 + 行末状态图标）被三个呈现面共用：Spark 卡的关联区、
 * WorkCase 已关闭卡的反向引用区、**子目标卡的名下工作区**。原先它住在
 * `pages/ObjectList.tsx` 里，聚焦页目标区要复用就得从页面模块里挖——那会形成
 * 页面 → 组件 → 页面的循环依赖。故抽成本文件：它是**呈现件**，不属于任何页面。
 *
 * 抽取后单点纪律不变：关联行的画法只有一处（`docs/01` §1.9「工作对象卡片通用
 * 交互」），Spark 卡与子目标卡不可能各画各的。
 */

const CommitRelationIcon = OBJECT_TYPE_ICONS.commit;

export function associationLocator(association: FactCardAssociation) {
  if (association.resolvedTarget) return association.resolvedTarget;
  // commit 目标（02 §8.1）不是对象 locator——没有 factTypeKey/objectId 可开面板。
  if (association.target && 'commit' in association.target) return null;
  return association.target && !('objectUid' in association.target) ? association.target : null;
}

/**
 * 卡片关联行的 React key。commit 目标（02 §8.1）与对象目标分属不同命名空间，
 * 不能用同一套字段拼 key——否则 commit 行会退化成 'unavailable:unknown:0'。
 */
function factCardAssociationKey(association: FactCardAssociation, index: number): string {
  const target = association.target;
  if (!target) return `unavailable:${index}`;
  if ('commit' in target) return `commit:${target.commit}`;
  if ('objectUid' in target) return `uid:${target.objectUid}`;
  return `${target.governedProjectId}:${target.factTypeKey}:${target.objectId}`;
}

export function dedupeFactCardAssociations<T extends { association: FactCardAssociation; source: string }>(rows: T[]): T[] {
  const seenTargets = new Set<string>();
  return rows.filter((row) => {
    const target = row.association.target;
    if (!target) return true;
    const targetKey = 'commit' in target
      ? `commit\u0000${target.commit}`
      : 'objectUid' in target
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

export function FactAssociationCardRow({ association, locale, unavailableLabel }: { association: FactCardAssociation; locale: string; unavailableLabel: string }) {
  const { t } = useI18n();
  const commitHash = association.available && association.target && 'commit' in association.target
    ? association.target.commit
    : null;
  // commit 目标呈现「这次提交做了什么」——服务端已读出提交标题（08 §5：定位符
  // 不当内容呈现）。标题缺失（提交不可达等）时退回短 hash，仍不落到
  // unavailableLabel——提交存在就是可用关联。
  const commitTitle = commitHash
    ? ((typeof association.title === 'string' && association.title.trim()) || commitHash.slice(0, 7))
    : null;
  const title = commitTitle
    ?? (association.available ? getLocalizedObjectTitle(association, locale) : unavailableLabel);
  const legacyTarget = associationLocator(association);
  const typeColor = legacyTarget ? (CATEGORY_COLORS[legacyTarget.factTypeKey] || CATEGORY_COLORS.other) : CATEGORY_COLORS.other;
  const { openPanel } = usePanel();
  const navigate = useNavigate();
  // commit 目标可点（跳提交详情页）；对象目标仍走面板打开。二者互斥——commit 无
  // 对象 locator，不能落进面板路径（canOpen 为 false 就静默不可点）。
  const canOpen = Boolean(association.available && (legacyTarget || commitHash));
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
    if (!canOpen) return;
    if (commitHash) { navigate(`/changelog/${commitHash}`); return; }
    if (!legacyTarget) return;
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
      {commitHash
        ? <CommitRelationIcon size={13} className={`shrink-0 ${isDiscarded ? 'text-slate-400/65 dark:text-slate-500/60' : 'text-ldvh-text-secondary'}`} />
        : <ObjectTypeIcon type={legacyTarget?.factTypeKey} size={13} className={`shrink-0 ${isDiscarded ? 'text-slate-400/65 dark:text-slate-500/60' : ''}`} style={isDiscarded ? undefined : { color: typeColor }} />}
      {/* 标题行只显示标题（hash 由 title 属性承担，不占正文位） */}
      <span
        title={commitHash ?? undefined}
        className={`ldvh-meta-primary min-w-0 flex-1 whitespace-normal break-words ${isDiscarded ? 'text-slate-400/65 dark:text-slate-500/60' : 'text-ldvh-text-secondary/95 group-hover:text-ldvh-accent'}`}
      >{title}</span>
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

export function getFactAssociationState(association: FactCardAssociation): FactAssociationState | null {
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
  // 26 §9：friction 关联目标——open 是活账（待修），resolved 已销、voided 已废弃、
  // accepted 已接受（不可清偿），后三者均属终态族。（2026-10 修订：原第四值
  // observing 已退出闭集。）
  if (targetType === 'friction') {
    if (association.status === 'open') return 'pending';
    if (association.status === 'resolved' || association.status === 'voided' || association.status === 'accepted') return 'closed';
  }
  // 27 号 §9：norm 关联目标——retired 已退役（历史档案），active 生效中（下方默认）。
  if (association.status === 'retired') return 'discarded';
  return 'active';
}

export function getFactAssociationStateRank(association: FactCardAssociation): number {
  const state = getFactAssociationState(association);
  return state === null ? Number.MAX_SAFE_INTEGER : FACT_ASSOCIATION_STATE_RANK[state];
}

function FactAssociationStateIcon({ state, tooltip }: { state: FactAssociationState; tooltip: string }) {
  const presentation = {
    // 待确认族（Pitfall draft、WorkCase 方案/关闭待确认、Spark open、Friction open）用
    // **带圈问号 CircleHelp**：这一族的共同点是「等一个决定」，不是「进度走到一半」——
    // 此前是自绘的四分填充圆（读起来像进度环，未开始的条目被画成已完成 25%，隐喻错）。
    // 2026-11-02 曾二次定案撤掉外圈改用裸问号，2026-11-03 Human 改回带圈形态（裸问号
    // 与同排其余四族的圆形图标不成族，一眼看不出这是「状态」而不是正文里的问号）。
    pending: { Icon: CircleHelp, className: 'text-amber-500 dark:text-amber-400' },
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

/** 反向引用（`factRefSources`：**谁声明引用了本单**）→ 统一关联行的入参形状。
 *
 * 为什么要适配而不是另写一套行式（Human 2026-09-30：「这里的引用样式学习一下 spark 的
 * 引用方案」）：Spark 的引用行由 `FactAssociationCardRow` 单点给出（类型图标 13px +
 * 标题撑满 + 行末状态图标）；已关闭卡此前自建 `WorkCaseRefSourceRow`（无类型图标、
 * 状态写成文字），于是**同一类信息出现两套行式**——正是本仓反复出现的"两处各写一套"
 * 病。反向引用与关联的形状本就同构（`resolvedTarget`/`title`/`available`/`status`），
 * 故此处只做**字段搬运**，行式仍由统一行给出。
 *
 * 注意二者**不是同一批数据**、也不互相替代（`api/services/facts.ts` 的登记）：
 * `factRefs` 是**外向**（本单引用了谁），`factRefSources` 是**反向**（谁引用了本单）。 */
// eslint-disable-next-line react-refresh/only-export-components

/**
 * 引用行的**无标题区域**形态（Spark 卡的引用区画法，Human 2026-09-30「学习 spark 的
 * 引用方案」→ 2026-09-30 再裁定「不要标题」）：区域 = 顶部一条细分割线（`border-t`），
 * 行与行之间 `divide-y`——**没有标题、没有块边框、没有底色**。
 *
 * 为什么无标题：行本身**自描述**——类型图标（13px、类型色）说出这是什么类型的对象，
 * 行末状态图标说出它的状态；标题是「声明引用此工单的对象」这类概括词，要么太长、
 * 要么冒领方向语义。无标题即无冒领面。
 *
 * 为什么导出为常量（单一来源纪律，`10 §5.5`）：Spark 卡与子目标卡呈现的是**同一类
 * 信息**（指向别的对象的行）。两处各写一份类名时，改一处另一处必然漂移。
 */
export const FACT_ASSOCIATION_ROWS_ZONE_CLASS = 'min-w-0 border-t border-ldvh-border/60 pt-1.5';

/** 引用行的行间分割（与区域常量配套：不用 gap，间距由行的 padding 提供）。 */
export const FACT_ASSOCIATION_ROWS_LIST_CLASS = 'divide-y divide-ldvh-border/45';

/** 关联行的 React key（供各处列表渲染使用）。 */
export { factCardAssociationKey };

/**
 * 子目标卡「名下的工作」区内，**每个类型层**默认先展的条数（Human 决定 2026-11-02：
 * 「每个类型最多展现 3 个，其他的要可以收起展开」）。
 *
 * **这是扫读预算，不是呈现收窄**：超出部分不是不呈现，而是先收起、可一键展开；
 * 展开后的条目、次序与折叠时逐条相同——只改变可见条数，不改变内容。故本常量
 * 不得被用作 `slice` 之外的任何语义（如「只取前 N 条就够」的筛选口径）。
 */
export const SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT = 3;

/**
 * 类型分层的**固定次序**：工单在前、火花在后。
 *
 * 为什么定序而不按条目数排：类型层是**稳定的读法**（读者知道先看工单的落实情况、
 * 再看火花），按数量排会让同一屏在不同对象间换次序，读者每次都要重新定位。剩余的
 * 类型（契约上只会出现 workcase/spark 两类，见 `facts.ts` 的 `deriveServingWork`）
 * 追加在登记次序之后，不因未登记而消失。
 */
const SUB_GOAL_SERVING_TYPE_ORDER: readonly string[] = ['workcase', 'spark'];

type ServingWorkGroup = { type: string; rows: FactCardAssociation[] };

/**
 * 把「名下的工作」按类型分层，层内按**关联状态**排序（活跃 → 推进中 → 待处理 →
 * 已关闭 → 已废弃，`FACT_ASSOCIATION_STATE_RANK` 单点给出）。
 *
 * 层内排序与卡片关联区的排序**同一条判据**：两处都是「指向另一个对象的行」，
 * 一处按状态排、一处按文件名排会让同一条工作在两个呈现面上顺序不同。
 */
export function groupServingWorkByType(rows: readonly ServingWorkItem[]): ServingWorkGroup[] {
  const byType = new Map<string, FactCardAssociation[]>();
  rows.forEach((row) => {
    const association = servingWorkToAssociation(row);
    const bucket = byType.get(row.type) ?? [];
    bucket.push(association);
    byType.set(row.type, bucket);
  });
  return [...byType.entries()]
    .map(([type, associations]) => ({
      type,
      rows: associations
        .map((association, index) => ({ association, index }))
        .sort((left, right) => {
          const rankDelta = getFactAssociationStateRank(left.association) - getFactAssociationStateRank(right.association);
          return rankDelta !== 0 ? rankDelta : left.index - right.index;
        })
        .map(({ association }) => association),
    }))
    .sort((left, right) => {
      const leftRank = SUB_GOAL_SERVING_TYPE_ORDER.indexOf(left.type);
      const rightRank = SUB_GOAL_SERVING_TYPE_ORDER.indexOf(right.type);
      const leftKey = leftRank === -1 ? SUB_GOAL_SERVING_TYPE_ORDER.length : leftRank;
      const rightKey = rightRank === -1 ? SUB_GOAL_SERVING_TYPE_ORDER.length : rightRank;
      return leftKey !== rightKey ? leftKey - rightKey : left.type.localeCompare(right.type);
    });
}

/**
 * 名下工作行 → 统一关联行的入参形状（只做**字段搬运**，行式仍由
 * `FactAssociationCardRow` 单点给出）。
 *
 * 理由与 `refSourceToAssociation` 同：`10 §5.5`「同类信息只有一处行式」——凡呈现
 * 「引用／关联某个事实对象」的行，一律复用统一关联行，不得自建第二套。此处若为
 * 「名下的工作」另写一套行（自己的图标尺寸、自己的状态写法），就会出现同一张卡上
 * 两种「指向对象」的形态。
 */
export function servingWorkToAssociation(row: ServingWorkItem): FactCardAssociation {
  return {
    // 行来自已精确读取的下游对象（`facts.ts` 反查时只收可读项），故恒为可用。
    // 项目取**行自己的**归属（而不是卡片当前项目）：联邦视图里两者可以不同，
    // 用当前项目会把跨项目的行伪装成本项目对象（那是伪造定位，不是呈现选择）。
    available: true,
    resolvedTarget: {
      governedProjectId: row.governed_project_id ?? '',
      factTypeKey: row.type,
      objectId: row.id,
    },
    title: row.title,
    status: row.status,
    // workcase 的派生分组随行搬运（21 号，服务端单点派生）——行末状态图标据此判
    // 「推进中／待处理」，呈现层不重算。
    ...(row.group ? { group: row.group as WorkCaseV5Group } : {}),
  };
}

export function refSourceToAssociation(source: FactRefSource): FactCardAssociation {
  return {
    available: source.available,
    resolvedTarget: source.resolvedTarget,
    title: source.title,
    title_en: source.title_en,
    title_zh: source.title_zh,
    status: source.status,
  };
}
