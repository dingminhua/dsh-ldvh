import { useState } from 'react';
import { stripCardMarkdown } from '@/utils/cardText';
import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import type { WorkCasePlanStep } from '@/utils/api';
import type {
  WorkCaseDraftCheck,
  WorkCaseDraftResidualEntry,
} from '../../shared/workcaseResultDraft';
import {
  WORKCASE_CHECK_TAG_BASE,
  WORKCASE_CHECK_TAG_CLASS,
  WORKCASE_COLLAPSED_RESIDUAL,
  WORKCASE_DIRECTION_ROW_CLASS,
  WORKCASE_RESIDUAL_BLOCK_CLASS,
  WORKCASE_RESIDUAL_ROW_CLASS,
  WORKCASE_ITEM_ROW_CLASS,
  WORKCASE_RESIDUAL_TAG_CLASS,
  workCaseAdviceTagClass,
  workCaseCheckLabelFor,
  workCaseDraftCheckRows,
  workCaseDirectionRows,
  workCaseResidualRows,
} from '@/utils/workcaseCheckState';

/**
 * WorkCase「待批准关闭」卡主体（`10 §5.5`，2026-09-28 二次修订）。
 *
 * 呈现**两块、无标题栏**（与其余三组卡体同一形态纪律）：
 * 1. **逐条核对**——`[达成／部分达成／未达成／未记录] plan[N].step`；
 * 2. **残留（含去向）**——逐条 `[残留] <正文>`；其下**缩进一行**
 *    `[<去向词>] <去向正文>`。
 *
 * **块序是核对 → 残留（含去向）**（`10 §5.5`「块序与逐条标记」）：残留是「还剩什么」
 * （事实），其去向子项是「打算怎么办」（拟议）；先陈述事实再给去向，读者才不必回头。
 *
 * **为什么去向不再是独立一块**（`21 §8`「为什么合并为一段」，Human 裁定 2026-09-28）：
 * 去向由**独立的一段**改为**长在每条残留里面**——「还剩什么」与「打算怎么办」合成一个
 * **不可分离的单元**。原两段分离形态有三项实测缺陷：①「第 k 条建议 ↔ 第 k 项 residual」
 * 的对应不可机械核验（作者为建立回指发明「出自「…」」尾注，实测 56 条、跨 16 份）；
 * ② 计数对齐只防总数错、不防错配；③ 关闭后同一信息出现两遍。合并后对应关系由**结构**
 * 承载（不是约定），故本卡把去向子项**缩进显示在所属残留之下**，使主从关系可见。
 *
 * 数据来源与边界（`21 §8`）：
 * - `status = open` 时 `result` 字段尚不存在（`result` 出现 ⇔ `status = closed`），
 *   核对结论与残留（含去向）**只在正文「## 结果」节**；由投影层解析后以
 *   `result_checks` / `result_residual_entries` 传来（见 `shared/workcaseResultDraft`）。
 * - **两种形态都要能读**（`§15.3`）：新写入是**合并式**（去向长在残留里，走
 *   `residualEntries`）；存量是**分离式**（`- residual:` 段 + `- advice:` 段各自独立）。
 *   分离式下本卡**如实**呈现残留块（`directions` 为空，不缩进行）与去向块——不假装
 *   存量的残留带着去向。
 * - **条目正文不加粗**：与「执行中」卡的变更流水一致——那里只有时刻与标记是
 *   semibold，条目正文是 `ldvh-caption` 的常规字重。加粗正文会让并排一张卡里的
 *   两块字重失衡（Human 2026-09-24：「用的标题不要加粗，看起来太重了」）。
 * - **不呈现计划列表**：核对条目已带 `plan[].step` 标题，重复列出计划无增益。
 * - 解析不出状态的步骤呈现为「未记录」，不猜；判不出去向词时呈现「未归类」。
 * - **卡面按纯文本渲染**（`10 §5.5`）：去向与残留正文渲染前经 `stripCardMarkdown`
 *   剥标记——「不解析」不等于「不显示标记」，纯文本插值会把 `**加粗**` 的星号
 *   显示给读者。剥的是**显示**、不是数据（详情面仍用 Markdown）。
 */

export interface WorkCaseResultDraftProps {
  plan?: WorkCasePlanStep[];
  checks?: WorkCaseDraftCheck[];
  /** 去向条目（**平铺**）——存量分离式形态的来源；合并式下由 `residualEntries` 给出。 */
  advice?: unknown;
  /** 残留段（或存量建议段）前的事后补记声明（`21 §8`）；无则 null。 */
  adviceNote?: string | null;
  /** 「待批准关闭」期的残留条目（正文承载，平铺文本）；与「已关闭」卡同套样式。 */
  residual?: string[];
  /** 「待批准关闭」期的残留条目**及其去向子项**（合并式主从结构，`21 §8`）。 */
  residualEntries?: WorkCaseDraftResidualEntry[];
  className?: string;
}

export default function WorkCaseResultDraft({
  plan,
  checks,
  advice,
  adviceNote = null,
  residual = [],
  residualEntries,
  className = '',
}: WorkCaseResultDraftProps) {
  const { t } = useI18n();
  const [residualExpanded, setResidualExpanded] = useState(false);
  const steps = Array.isArray(plan) ? plan : [];
  const rows = Array.isArray(checks) ? checks : [];

  // 残留（含去向）：合并式走主从结构；分离式回落到平铺文本（`directions` 为空）。
  const residualRows = workCaseResidualRows(residualEntries, residual);

  // 去向块的**独立**来源只剩存量分离式（`- advice:` 段）——合并式下每条去向都已挂在
  // 其残留之下，再平铺一块会让同一条去向出现两遍（`21 §8` 缺陷③正是这个）。
  // 故判据是「有没有残留条目**没有**带去向」：带了就已在残留块内呈现，不再另起一块。
  const looseDirections = workCaseDirectionRows(advice);
  const residualCarriesDirections = residualRows.some((row) => row.directions.length > 0);
  const showLooseDirections = looseDirections.length > 0 && !residualCarriesDirections;

  if (rows.length === 0 && residualRows.length === 0 && !showLooseDirections) return null;

  const hiddenResidual = Math.max(0, residualRows.length - WORKCASE_COLLAPSED_RESIDUAL);
  const visibleResidual = residualExpanded
    ? residualRows
    : residualRows.slice(0, WORKCASE_COLLAPSED_RESIDUAL);

  return (
    <div className={`${className} grid min-w-0 gap-1.5`.trim()}>
      {rows.length > 0 && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/45 px-2.5 py-2">
          {workCaseDraftCheckRows(rows, steps).map((row) => (
            <div
              key={row.planIndex}
              data-workcase-check-status={row.state}
              className={WORKCASE_ITEM_ROW_CLASS}
            >
              <span
                className={`${WORKCASE_CHECK_TAG_BASE} ${WORKCASE_CHECK_TAG_CLASS[row.state]}`}
              >
                {workCaseCheckLabelFor(row.state, t)}
              </span>
              <span>{row.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* ② 残留（含去向）——Human 2026-09-24 裁定排在去向之上：残留是「还剩什么」，
          去向是「打算怎么办」；先陈述事实、再给去向。
          `10 §5.5`：去向子项在**待批准关闭**期**缩进一行显示于所属残留之下**
          （主从关系可见）——已关闭期才因残留一侧不呈现而提升为平级行。 */}
      {residualRows.length > 0 && (
        <div className={WORKCASE_RESIDUAL_BLOCK_CLASS}>
          {visibleResidual.map((item, index) => (
            <div key={index} data-workcase-residual-row>
              <div className={WORKCASE_RESIDUAL_ROW_CLASS}>
                {/* 与核对、去向一致的「[标记] 正文」行结构（Human 裁定逐条加标记） */}
                <span className={`${WORKCASE_CHECK_TAG_BASE} ${WORKCASE_RESIDUAL_TAG_CLASS}`}>
                  {t('objectList.workcaseResidualTag')}
                </span>
                <span>{stripCardMarkdown(item.text)}</span>
              </div>
              {/* 该残留的**去向子项**（合并式）：缩进一行，主从关系可见。 */}
              {item.directions.map((direction, directionIndex) => (
                <div
                  key={`${direction.kind ?? 'other'}-${directionIndex}`}
                  data-workcase-advice-kind={direction.kind ?? 'unclassified'}
                  className={WORKCASE_DIRECTION_ROW_CLASS}
                >
                  <span className={`${WORKCASE_CHECK_TAG_BASE} ${workCaseAdviceTagClass(direction.kind)}`}>
                    {direction.kind
                      ? t(`objectList.workcaseAdvice.${direction.kind}` as LocaleKey)
                      : t('objectList.workcaseAdvice.unclassified')}
                  </span>
                  <span>{stripCardMarkdown(direction.text)}</span>
                </div>
              ))}
            </div>
          ))}
          {hiddenResidual > 0 && (
            <button
              type="button"
              onClick={() => setResidualExpanded((current) => !current)}
              className="ldvh-meta-muted mt-1 block cursor-pointer text-left hover:text-ldvh-text-primary"
            >
              {residualExpanded
                ? t('objectList.workcaseFlowCollapse')
                : t('objectList.workcaseFlowMore', { count: String(hiddenResidual) })}
            </button>
          )}
        </div>
      )}

      {/* ②' 存量分离式（`21 §15.3` 存量不溯及）：`- advice:` 段与 `- residual:` 段各自
          独立存在，去向不挂在残留之下——故此处仍如实给一块去向，形态与旧版一致。
          块底中性：标记自带去向色，底再着色会与标记混淆。 */}
      {showLooseDirections && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/45 px-2.5 py-2">
          {adviceNote && (
            <div className="ldvh-meta-muted border-b border-ldvh-border/60 pb-1.5">
              {stripCardMarkdown(adviceNote)}
            </div>
          )}
          {looseDirections.map((direction, index) => (
            <div
              key={`${direction.kind ?? 'other'}-${index}`}
              data-workcase-advice-kind={direction.kind ?? 'unclassified'}
              className={WORKCASE_ITEM_ROW_CLASS}
            >
              {/* 按去向着色（`21 §8` 闭集二词）——色值取自共享表，不在此硬编码 */}
              <span className={`${WORKCASE_CHECK_TAG_BASE} ${workCaseAdviceTagClass(direction.kind)}`}>
                {direction.kind
                  ? t(`objectList.workcaseAdvice.${direction.kind}` as LocaleKey)
                  : t('objectList.workcaseAdvice.unclassified')}
              </span>
              <span>{stripCardMarkdown(direction.text)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
