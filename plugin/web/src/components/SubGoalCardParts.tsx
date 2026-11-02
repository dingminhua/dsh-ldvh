import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { getTypeSurfaceTint } from '@/utils/typeSurface';
import { getObjectStatusLocale } from '@/i18n/locales';
import type { ServingWorkItem } from '@/utils/api';
import ServingSparkProgressBar from '@/components/ServingSparkProgressBar';
import SubGoalOrderBadge from '@/components/SubGoalOrderBadge';
import { WORKCASE_SURFACE_GEOMETRY_CLASS } from '@/components/WorkCaseCriteriaList';
import {
  FACT_ASSOCIATION_ROWS_LIST_CLASS,
  FACT_ASSOCIATION_ROWS_ZONE_CLASS,
  FactAssociationCardRow,
  groupServingWorkByType,
  SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT,
} from '@/components/FactAssociationRows';
import { LDVH_WARN_SURFACE_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';

/**
 * 子目标卡的**可复用呈现件**（2026-11-03）。
 *
 * ## 为什么抽这一层
 *
 * 子目标此前有两种呈现：
 * - 列表卡（`ObjectList` 的 `SubGoalCardContent`）——卡头 + 标题托盘 + 判据面 +
 *   名下工作区，全部常显；
 * - 聚焦页目标区（`GoalSection`）——只有标题 + 一条火花进度条。
 *
 * 二者并非同一件事的两种皮肤，而是**同一对象在不同密度下的两种读法**，但它们
 * 读的是同一批字段。若各自手写，「判据长什么样」「空集歧义怎么提示」这些
 * 呈现决定就会分叉——而分叉时没有机械判据说哪边才是对的（与 25 §7「目标只有
 * 一条陈述」同一纪律：两份并存必有一份失真）。
 *
 * 故把**判据面**与**名下工作区**抽成本文件，列表卡与聚焦页同源调用。
 *
 * ## 聚焦页为什么默认收起
 *
 * Human 定案（2026-11-03）：聚焦页的子目标行**除标题外默认收起**，点击展开。
 *
 * 理由：聚焦页一屏要并列回答五件事（目标、待决、推进中、动态、火花健康）。
 * 目标区若把四条子目标的判据与名下工作全展开，它就变成整页最重的一块，把
 * 「待决定事项」这类**需要立即行动**的模块压到下面——而聚焦页的首要职责是
 * 让人知道「现在该动什么」，不是「长期意图的完整档案」。
 *
 * 收起不等于删：判据与名下工作一行不少地在那里，点开即得。子目标的完整档案
 * 仍在 `/objects/subgoal/<uid>` 详情页，聚焦页这条展开只是省一次跳转。
 */

/**
 * 子目标的**判据面**（28 §8 `criterion` 全文）。
 *
 * 几何与 WorkCase 判据面同源（`WORKCASE_SURFACE_GEOMETRY_CLASS`：四边同宽 1px、
 * `rounded-lg`、`px-3 py-2`、无左侧粗线），色相取**本类型色**（子目标 = lime）——
 * 两者必须**成对**取自 `getTypeSurfaceTint`，只贴面会让正文沿用中性近黑，色相面
 * 与正文分家（`docs/01` §1.6）。
 *
 * `criterion` 为空时**不画空框**：空框会让读者以为「框里本该有东西而读取失败」，
 * 而实际是载体不合规——那是详情页字段问题区该如实报出的事。
 */
export function SubGoalCriterionSurface({
  criterion,
  type = 'subgoal',
}: {
  criterion: string;
  type?: string;
}) {
  const text = typeof criterion === 'string' ? criterion.trim() : '';
  if (!text) return null;

  const tint = getTypeSurfaceTint(type);
  return (
    <section className={WORKCASE_SURFACE_GEOMETRY_CLASS} style={tint.surface}>
      {/* 12px 扫读档 + 本类型色正文。**不画圆点**：WorkCase 判据面的圆点是「并列
          条目之间的分隔记号」（它的清单恒 ≥1 条且常有多条）；本框恒为**一句**判据，
          孤零零一枚圆点会被读成「一个只写了一句的清单」。 */}
      <p className="ldvh-card-decision-body min-w-0 break-words" style={tint.body}>
        {text}
      </p>
    </section>
  );
}

/** 展开/收起按钮的共享形态（聚焦页与列表卡同一枚）。 */
export function SubGoalDisclosureButton({
  expanded,
  onToggle,
  label,
  className = '',
}: {
  expanded: boolean;
  onToggle: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left ldvh-meta text-ldvh-text-secondary/85 transition-colors hover:bg-ldvh-border/25 hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50 ${className}`}
    >
      {expanded
        ? <ChevronUp size={12} aria-hidden="true" className="shrink-0" />
        : <ChevronDown size={12} aria-hidden="true" className="shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/**
 * 子目标的**名下工作区**（`serves` 反查的派生，28 §8.1；不落盘）。
 *
 * ## 三条不可让步的纪律
 *
 * 1. **空集是歧义，不是进度 0**（28 §8.1）：真的还没拆解，与拆解了却没人写
 *    `serves`，在机械层长得一模一样。故空集既不画 0 也不画条，而是显式说明这两种
 *    可能——用一个状态值去猜测缺声明的原因，会把它固化成一条不可核对的事实。
 * 2. **读不到不等于没有**（00 §5.6）：无法枚举的类型单列，绝不并进空集。
 * 3. **进度只数火花**：分子＝已落实，分母＝待处理＋已落实（Human 定案
 *    2026-11-02）。分母排除 `discarded`——废弃一条火花不使这条子目标少一件该
 *    做的事（20 §9）。口径的完整推导见 `utils/servingSparkProgress.ts`。
 *
 * **不按状态分支**（同 Spark 的 2026-09-16 裁定）：达成/作废的子目标名下工作仍是
 * 可核对的历史——「这件工作曾服务于那条已达成的子目标」是事实（28 §12.3 第 4 条）。
 */
export function SubGoalServingWorkZone({
  rows,
  unreadable,
  /** 是否显示火花落实比值（聚焦页收起态已单独给摘要，故展开区可关）。 */
  showProgress = true,
  /**
   * 进度条的呈现形态。
   *
   * - `block`（默认）：列表卡形态——标题 + 分数 + 两档明细 + 条。
   * - `inline`：聚焦页目标区形态——条 + 分数同排，无标题、无两档明细。
   *
   * 两者共用同一个 `summarizeServingSparkProgress`，因此**数值不可能不一致**；
   * 差别只在展示密度。目标区一行只有 20px 高，塞进两档明细会把子目标标题挤成
   * 两行——那反而让「哪几条子目标」这件事更难扫。
   */
  progressVariant = 'block',
}: {
  rows: readonly ServingWorkItem[];
  unreadable?: readonly string[];
  showProgress?: boolean;
  progressVariant?: 'block' | 'inline';
}) {
  const { t, locale } = useI18n();
  const [expandedTypes, setExpandedTypes] = useState<ReadonlySet<string>>(() => new Set());
  const unreadableTypes = unreadable ?? [];

  // 比值必须读**原始行**而不是 `group.rows`：`groupServingWorkByType` 已把
  // `ServingWorkItem` 投影成 `FactCardAssociation`（那是关联行需要的形状），
  // `status` 在这一步被换成了关联状态轴。拿投影后的行去数火花，会得到 0 条火花、
  // 于是每一处都显示「名下没有火花」——实测正是如此（2026-11-02）。
  const sparkRows = rows.filter((row) => row.type === 'spark');
  const groups = groupServingWorkByType(rows);
  const isEmpty = groups.length === 0;

  if (isEmpty && unreadableTypes.length === 0) {
    return (
      <section onClick={(event) => event.stopPropagation()} className={FACT_ASSOCIATION_ROWS_ZONE_CLASS}>
        <p className={`ldvh-meta rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-2 py-1.5 ${LDVH_WARN_TITLE_CLASS}`}>
          {t('objectList.subGoalServingEmpty')}
        </p>
      </section>
    );
  }

  return (
    <section onClick={(event) => event.stopPropagation()} className={`${FACT_ASSOCIATION_ROWS_ZONE_CLASS} flex flex-col gap-1.5`}>
      {groups.map((group) => {
        const expanded = expandedTypes.has(group.type);
        const hidden = Math.max(0, group.rows.length - SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT);
        const visible = expanded ? group.rows : group.rows.slice(0, SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT);
        return (
          <div key={group.type} data-subgoal-serving-type={group.type}>
            {/* **不设层名**（Human 定案 2026-11-02）：行本身自描述——行首的类型图标
                已经说出这是什么类型的对象；计数由「其余 N 条」与可见行数共同给出。 */}
            <div className={FACT_ASSOCIATION_ROWS_LIST_CLASS}>
              {visible.map((association, index) => (
                <FactAssociationCardRow
                  key={`${group.type}:${index}`}
                  association={association}
                  locale={locale}
                  unavailableLabel={t('objectList.associationUnavailable')}
                />
              ))}
            </div>
            {/* 展开/收起：只改可见条数，不改条目本身（折叠时不丢弃、不排序、不合并）。 */}
            {(hidden > 0 || expanded) && (
              <SubGoalDisclosureButton
                expanded={expanded}
                onToggle={() => setExpandedTypes((current) => {
                  const next = new Set(current);
                  if (next.has(group.type)) next.delete(group.type);
                  else next.add(group.type);
                  return next;
                })}
                label={expanded
                  ? t('objectList.subGoalServingCollapse')
                  : t('objectList.subGoalServingExpand', { count: String(hidden) })}
                className="mt-0.5"
              />
            )}
            {/* 火花落实比值：只挂在 spark 这一组下——它是**火花**的落实进度，与工单的
                进展分组是两个轴。放在行列表**之后**：它是对上面那些行的汇总，读者先
                看到有哪几条，再看到「其中多少已落实」才有意义。

                展开/收起**不改变**它：分母始终是全部 spark，不是可见的那几条。按可见
                条数算会让「展开」这个动作本身改变进度值——那是一个由交互制造出来
                的假象。 */}
            {group.type === 'spark' && showProgress && (
              <div className="mt-1">
                <ServingSparkProgressBar
                  rows={sparkRows}
                  unreadable={unreadableTypes}
                  progressLabel={t('objectList.subGoalSparkProgress')}
                  emptyLabel={t('objectList.subGoalSparkProgressEmpty')}
                  allDiscardedLabel={t('objectList.subGoalSparkProgressAllDiscarded')}
                  unavailableLabel={t('objectList.subGoalSparkProgressUnavailable')}
                  unknownStatusLabel={(count) => t('objectList.subGoalSparkProgressUnknown', { count: String(count) })}
                  variant={progressVariant}
                />
              </div>
            )}
          </div>
        );
      })}
      {unreadableTypes.length > 0 && (
        // 读不到不等于没有（00 §5.6）：无法枚举的类型单列，绝不并进空集。
        <p className={`ldvh-meta rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-2 py-1.5 ${LDVH_WARN_TITLE_CLASS}`}>
          {t('objectList.subGoalServingUnreadable')}：{unreadableTypes.join('；')}
        </p>
      )}
    </section>
  );
}

/**
 * 子目标行的**卡头件**（次序 chip + 状态 chip）。
 *
 * 次序是扫读要素（跨条比较），状态只在非 active 时出现（docs/02 §4.0：状态词经
 * `getObjectStatusLocale` 本地化，不渲染 raw 枚举）。
 */
export function SubGoalRowChips({
  order,
  status,
  children,
}: {
  order?: number;
  status?: string;
  children?: ReactNode;
}) {
  const { locale } = useI18n();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <SubGoalOrderBadge value={order} />
      {status && status !== 'active' && (
        <span className="ldvh-chip-sm shrink-0" data-subgoal-status={status}>
          {getObjectStatusLocale('subgoal', status, locale)}
        </span>
      )}
      {children}
    </div>
  );
}
