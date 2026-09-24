import { useState } from 'react';
import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import type { ObjectItem, WorkCasePlanStep, WorkCaseResultCheck } from '@/utils/api';
import { stripCardMarkdown } from '@/utils/cardText';
import {
  WORKCASE_CHECK_TAG_BASE,
  WORKCASE_CHECK_TAG_CLASS,
  WORKCASE_RESIDUAL_BLOCK_CLASS,
  WORKCASE_RESIDUAL_ROW_CLASS,
  WORKCASE_RESIDUAL_TAG_CLASS,
  workCaseAdviceTagClass,
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

/** 取消记录的行标记：与状态标记同族（行内、宽度自适应），取中性色。 */
const CANCEL_TAG_CLASS =
  'mr-1.5 inline-block shrink-0 rounded border border-ldvh-border bg-ldvh-bg px-1.5 text-[10px] font-semibold leading-4 text-ldvh-text-secondary';

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
  const cancellation = obj.cancellation ?? null;
  // 去向（21 §8 建议段）：与「待批准关闭」期**同一处承载**（正文，关闭不删正文）。
  // 语义是「提请时如实说明的打算」，**不因关闭而被批准**（§10.2，Human 2026-09-24）——
  // 故此处用中性表述呈现，不写「后续去向」一类暗示已批准的措辞。
  const advice = Array.isArray(obj.advice) ? obj.advice : [];

  if (cancellation === null && checks.length === 0 && residual.length === 0 && advice.length === 0) {
    return null;
  }

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
        {/* cancelled 无核对可报（没有执行就没有核对结论，21 §9.2）——改述为
            「未执行任何计划步骤」，而不是显示「核对 0/0 达成」这种无信息的形式。 */}
        {cancellation !== null ? (
          <>
            {obj.outcome && <span className="text-ldvh-text-secondary/50" aria-hidden="true">·</span>}
            <span className="text-ldvh-text-primary">{t('objectList.workcaseNotExecuted')}</span>
          </>
        ) : (
          checks.length > 0 && (
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
          )
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

      {/* ②' 取消记录（21 §8，仅 cancelled）：理由 + 未发生的范围。
          取代逐条核对块——取消对象没有核对结论可报。用中性灰，与 outcome 徽标同色系，
          不与「核对」的绿/琥珀/红抢语义。 */}
      {cancellation !== null && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/60 px-2.5 py-2">
          {cancellation.reason && (
            <div className="py-1 first:pt-0.5 ldvh-caption text-ldvh-text-primary">
              <span className={CANCEL_TAG_CLASS}>{t('objectList.workcaseCancelReason')}</span>
              <span>{cancellation.reason}</span>
            </div>
          )}
          {cancellation.unstartedScope && (
            <div className="border-t border-ldvh-border/60 py-1 ldvh-caption text-ldvh-text-primary">
              <span className={CANCEL_TAG_CLASS}>{t('objectList.workcaseCancelUnstarted')}</span>
              <span>{cancellation.unstartedScope}</span>
            </div>
          )}
        </div>
      )}

      {/* ② 逐条核对：只给标题（证据归详情） */}
      {cancellation === null && checks.length > 0 && (
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

      {/* ② 残留——Human 2026-09-24 裁定排在去向之上：残留是「还剩什么」，
          去向是「打算怎么办」；先陈述事实、再给去向。 */}
      {residual.length > 0 && (
        <div className={WORKCASE_RESIDUAL_BLOCK_CLASS}>
          {visibleResidual.map((item, index) => (
            <div
              key={index}
              className={WORKCASE_RESIDUAL_ROW_CLASS}
            >
              {/* 与核对、去向一致的「[标记] 正文」行结构（Human 裁定逐条加标记） */}
              <span className={`${WORKCASE_CHECK_TAG_BASE} ${WORKCASE_RESIDUAL_TAG_CLASS}`}>
                {t('objectList.workcaseResidualTag')}
              </span>
              <span>{stripCardMarkdown(typeof item === 'string' ? item : String(item))}</span>
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

      {/* ②'' 去向（21 §8 建议段）：与「待批准关闭」期同一处承载。
          名称用中性「去向」——§10.2 明写批准对象只有「关闭」与 outcome，
          去向不因关闭而成为承诺，故不得写成「后续去向」一类暗示已批准的措辞。
          块底中性（与建议块一致）：标记已是四色，底再着色会与标记混淆。 */}
      {advice.length > 0 && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/45 px-2.5 py-2">
          {advice.map((item, index) => (
            <div
              key={`${item.kind ?? 'other'}-${index}`}
              data-workcase-advice-kind={item.kind ?? 'unclassified'}
              className="border-t border-ldvh-border/60 py-1.5 first:border-t-0 first:pt-0.5 ldvh-caption text-ldvh-text-primary"
            >
              <span className={`${WORKCASE_CHECK_TAG_BASE} ${workCaseAdviceTagClass(item.kind)}`}>
                {item.kind
                  ? t(`objectList.workcaseAdvice.${item.kind}` as LocaleKey)
                  : t('objectList.workcaseAdvice.unclassified')}
              </span>
              <span>{stripCardMarkdown(item.text)}</span>
              {item.from && (
                <span className="mt-0.5 block text-[11px] text-ldvh-text-secondary">
                  {t('objectList.workcaseAdviceFrom', { source: item.from })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
