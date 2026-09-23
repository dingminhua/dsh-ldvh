import { useState } from 'react';
import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import type { ObjectItem, WorkCasePlanStep, WorkCaseResultCheck } from '@/utils/api';
import {
  WORKCASE_CHECK_TAG_BASE,
  WORKCASE_CHECK_TAG_CLASS,
  workCaseCheckLabelFor,
  workCaseResultCheckRows,
} from '@/utils/workcaseCheckState';

/**
 * WorkCase「已关闭」卡主体（Human 2026-09-24 定，方案 A）。
 *
 * 三块，**均无标题栏**（与「待批准关闭」同一形态纪律）：
 * 1. **结论行**——`outcome` + 核对达成计数 + 残留条数，压成一行。此前 `outcome`
 *    是一个孤立 chip、核对是另一串「已满足」行，读者要自己数才能把两者对上。
 * 2. **逐条核对**——`[达成] plan[N].step`。与「待批准关闭」卡同一形态：**只给标题，
 *    证据不上卡**。此前显示的是「已满足 · <整段证据>」，实测最长 258 字，一张卡被
 *    撑到十几行，扫读窗口失效（10 §5.2）。证据归详情面（10 §5.3）。
 * 3. **残留块**——`result.residual`。这是「关闭后还剩什么」，此前卡上完全看不到。
 *    超过 `COLLAPSED_RESIDUAL` 条经「更早 N 条」展开，与变更流水同一交互。
 *
 * 数据来源与边界：
 * - `plan` 由投影层补入（closed 期此前不投影 `plan`，卡上因此拿不到步骤标题——
 *   `21 §8` 的 `criteria_checks[]` 只有 `{satisfied, evidence}`，不含判据文本）；
 * - 核对状态只认 `21 §8` 登记的三词映射（达成 ⇔ `true`；未达成 ⇔ `false`；缺失 ⇒
 *   未记录），复用 `@/utils/workcaseCheckState` 的单一实现，不另造一套；
 * - **卡面按纯文本渲染**：`residual` 与 `achieved_scope` 里的 Markdown 标记不解析、
 *   直接显示。写作侧纪律见 `21 §8`（建议段同纪律）。
 */

/** 残留默认显示条数；其余经「更早 N 条」展开。 */
const COLLAPSED_RESIDUAL = 2;

const NEUTRAL_TAG_CLASS = 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary';

const OUTCOME_CLASS: Record<string, string> = {
  completed: 'border-emerald-600/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  partial: 'border-amber-600/50 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'not-achieved': 'border-red-600/45 bg-red-500/10 text-red-700 dark:text-red-300',
  cancelled: 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary',
};

export interface WorkCaseClosedSummaryProps {
  obj: ObjectItem;
  className?: string;
}

export default function WorkCaseClosedSummary({ obj, className = '' }: WorkCaseClosedSummaryProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const steps: WorkCasePlanStep[] = Array.isArray(obj.plan) ? obj.plan : [];
  const checks: WorkCaseResultCheck[] = Array.isArray(obj.result?.criteria_checks)
    ? obj.result.criteria_checks
    : [];
  const residual = Array.isArray(obj.result?.residual) ? obj.result.residual : [];

  if (checks.length === 0 && residual.length === 0) return null;

  const achieved = checks.filter((c) => c.satisfied === true).length;
  const hidden = Math.max(0, residual.length - COLLAPSED_RESIDUAL);
  const visibleResidual = expanded ? residual : residual.slice(0, COLLAPSED_RESIDUAL);

  return (
    <div className={`${className} grid min-w-0 gap-1.5`.trim()}>
      {/* ① 结论行 */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 ldvh-caption">
        {obj.outcome && (
          <span
            data-workcase-outcome={obj.outcome}
            className={`inline-block shrink-0 rounded border px-2 text-[11px] font-semibold leading-5 ${
              OUTCOME_CLASS[obj.outcome] ?? NEUTRAL_TAG_CLASS
            }`}
          >
            {t(`objectList.workcaseOutcome.${obj.outcome}` as LocaleKey)}
          </span>
        )}
        {checks.length > 0 && (
          <>
            {obj.outcome && <span className="text-ldvh-text-secondary/50" aria-hidden="true">·</span>}
            <span
              data-workcase-check-tally={`${achieved}/${checks.length}`}
              className="text-ldvh-text-primary"
            >
              {t('objectList.workcaseCheckTally', {
                achieved: String(achieved),
                total: String(checks.length),
              })}
            </span>
          </>
        )}
        <span className="text-ldvh-text-secondary/50" aria-hidden="true">·</span>
        {residual.length > 0 ? (
          <span className="text-ldvh-text-primary">
            {t('objectList.workcaseResidualTally', { count: String(residual.length) })}
          </span>
        ) : (
          <span className="text-ldvh-text-secondary">{t('objectList.workcaseResidualNone')}</span>
        )}
      </div>

      {/* ② 逐条核对：只给标题（证据归详情） */}
      {checks.length > 0 && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/45 px-2.5 py-2">
          {workCaseResultCheckRows(checks, steps).map((row) => (
            <div
              key={row.planIndex}
              data-workcase-check-status={row.state}
              className="border-t border-ldvh-border/60 py-1.5 first:border-t-0 first:pt-0.5 ldvh-caption text-ldvh-text-primary"
            >
              <span className={`${WORKCASE_CHECK_TAG_BASE} ${WORKCASE_CHECK_TAG_CLASS[row.state]}`}>
                {workCaseCheckLabelFor(row.state, t)}
              </span>
              <span>{row.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* ③ 残留 */}
      {residual.length > 0 && (
        <div className="min-w-0 rounded-md border border-amber-600/25 bg-amber-500/[0.05] px-2.5 py-2">
          {visibleResidual.map((item, index) => (
            <div
              key={index}
              className="border-t border-ldvh-border/60 py-1.5 first:border-t-0 first:pt-0.5 ldvh-caption text-ldvh-text-primary"
            >
              {item}
            </div>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="ldvh-meta-muted mt-1 block cursor-pointer text-left hover:text-ldvh-text-primary"
            >
              {expanded
                ? t('objectList.workcaseFlowCollapse')
                : t('objectList.workcaseFlowMore', { count: String(hidden) })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
