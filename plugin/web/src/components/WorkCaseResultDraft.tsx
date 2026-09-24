import { useState } from 'react';
import { stripCardMarkdown } from '@/utils/cardText';
import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import type { WorkCasePlanStep } from '@/utils/api';
import type {
  WorkCaseDraftAdvice,
  WorkCaseDraftCheck,
} from '../../shared/workcaseResultDraft';
import {
  WORKCASE_CHECK_TAG_BASE,
  WORKCASE_CHECK_TAG_CLASS,
  WORKCASE_RESIDUAL_BLOCK_CLASS,
  WORKCASE_RESIDUAL_ROW_CLASS,
  workCaseAdviceTagClass,
  workCaseCheckLabelFor,
  workCaseDraftCheckRows,
} from '@/utils/workcaseCheckState';

/**
 * WorkCase「待批准关闭」的核对与建议（卡片主体）。
 *
 * 数据来源与边界（`21 §8`）：
 * - `status = open` 时 `result` 字段尚不存在，核对结论与建议**只在正文「## 结果」节**；
 *   由投影层解析后以 `result_checks` / `advice` 传来（见 `shared/workcaseResultDraft`）。
 * - 呈现为**三块、无标题栏**：核对（步骤标题 + 状态标记）· 建议（去向标记 + 内容）·
 *   残留（琥珀块，与「已关闭」卡的残留块**同一套类名**）。条目同为「标记 + 内容」
 *   的行内流结构，只有颜色不同。
 * - **残留块的数据源是正文**（`- residual:` 段）：该期无 `result` 字段可读。已关闭期
 *   相反——读 `result.residual` 字段（权威）。两期**各自取当期权威**，不互相顶替；
 *   同一份信息本身仍只有一处承载（正文），只是关闭时字段成为权威副本。
 * - **条目正文不加粗**：与「执行中」卡的变更流水一致——那里只有时刻与标记是
 *   semibold，条目正文是 `ldvh-caption` 的常规字重。加粗正文会让并排一张卡里的
 *   两块字重失衡（Human 2026-09-24：「用的标题不要加粗，看起来太重了」）。
 * - **不呈现计划列表**：核对条目已带 `plan[].step` 标题，重复列出计划无增益。
 * - 解析不出状态的步骤呈现为「未记录」，不猜；建议判不出去向时呈现「未归类」。
 */

export interface WorkCaseResultDraftProps {
  plan?: WorkCasePlanStep[];
  checks?: WorkCaseDraftCheck[];
  advice?: WorkCaseDraftAdvice[];
  /** 「待批准关闭」期的残留条目（正文承载）；与「已关闭」卡同套样式。 */
  residual?: string[];
  className?: string;
}

/** 残留块默认折叠阈值——与「已关闭」卡取同一值，两卡交互一致。 */
const COLLAPSED_RESIDUAL = 2;

export default function WorkCaseResultDraft({
  plan,
  checks,
  advice,
  residual = [],
  className = '',
}: WorkCaseResultDraftProps) {
  const { t } = useI18n();
  const [residualExpanded, setResidualExpanded] = useState(false);
  const steps = Array.isArray(plan) ? plan : [];
  const rows = Array.isArray(checks) ? checks : [];
  const advices = Array.isArray(advice) ? advice : [];

  if (rows.length === 0 && advices.length === 0) return null;

  return (
    <div className={`${className} grid min-w-0 gap-1.5`.trim()}>
      {rows.length > 0 && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/45 px-2.5 py-2">
          {workCaseDraftCheckRows(rows, steps).map((row) => (
            <div
              key={row.planIndex}
              data-workcase-check-status={row.state}
              className="border-t border-ldvh-border/60 py-1.5 first:border-t-0 first:pt-0.5 ldvh-caption text-ldvh-text-primary"
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

      {/* 块底中性：标记已是四色，底再带靛蓝会让「另立工单」的蓝标记与底色混淆 */}
      {advices.length > 0 && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/45 px-2.5 py-2">
          {advices.map((item, index) => (
            <div
              key={`${item.kind ?? 'other'}-${index}`}
              data-workcase-advice-kind={item.kind ?? 'unclassified'}
              className="border-t border-ldvh-border/60 py-1.5 first:border-t-0 first:pt-0.5 ldvh-caption text-ldvh-text-primary"
            >
              {/* 四色按去向区分（21 §8 闭集四词）——色值取自共享表，不在此硬编码 */}
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

      {/* ③ 残留（正文承载，21 §8）——与「已关闭」卡同套类名与折叠交互 */}
      {residual.length > 0 && (
        <div className={WORKCASE_RESIDUAL_BLOCK_CLASS}>
          {(residualExpanded ? residual : residual.slice(0, COLLAPSED_RESIDUAL)).map((item, index) => (
            <div
              key={index}
              className={WORKCASE_RESIDUAL_ROW_CLASS}
            >
              {stripCardMarkdown(item)}
            </div>
          ))}
          {residual.length > COLLAPSED_RESIDUAL && (
            <button
              type="button"
              onClick={() => setResidualExpanded((current) => !current)}
              className="ldvh-meta-muted mt-1 block cursor-pointer text-left hover:text-ldvh-text-primary"
            >
              {residualExpanded
                ? t('objectList.workcaseFlowCollapse')
                : t('objectList.workcaseFlowMore', {
                    count: String(residual.length - COLLAPSED_RESIDUAL),
                  })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
