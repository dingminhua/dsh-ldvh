import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import type { WorkCasePlanStep } from '@/utils/api';
import type {
  WorkCaseDraftAdvice,
  WorkCaseCheckStatus,
  WorkCaseDraftCheck,
} from '../../shared/workcaseResultDraft';

/**
 * WorkCase「待批准关闭」的核对与建议（卡片主体）。
 *
 * 数据来源与边界（`21 §8`）：
 * - `status = open` 时 `result` 字段尚不存在，核对结论与建议**只在正文「## 结果」节**；
 *   由投影层解析后以 `result_checks` / `advice` 传来（见 `shared/workcaseResultDraft`）。
 * - 呈现为**两块、无标题栏**：核对（步骤标题 + 状态标记）与建议（去向标记 + 内容）。
 *   两者的条目同为「标记 + 内容」的行内流结构，只有颜色不同。
 * - **不呈现计划列表**：核对条目已带 `plan[].step` 标题，重复列出计划无增益。
 * - 解析不出状态的步骤呈现为「未记录」，不猜；建议判不出去向时呈现「未归类」。
 */

const CHECK_TAG_CLASS: Record<WorkCaseCheckStatus, string> = {
  achieved: 'border-emerald-600/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  partial: 'border-amber-600/50 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'not-achieved': 'border-red-600/45 bg-red-500/10 text-red-700 dark:text-red-300',
};

const NEUTRAL_TAG_CLASS = 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary';

/** 标记的统一形状：与核对、目标是同一套（行内、宽度自适应、居于标题前）。 */
const TAG_BASE =
  'mr-1.5 inline-block shrink-0 rounded border px-1.5 text-[10px] font-semibold leading-4';

export interface WorkCaseResultDraftProps {
  plan?: WorkCasePlanStep[];
  checks?: WorkCaseDraftCheck[];
  advice?: WorkCaseDraftAdvice[];
  className?: string;
}

export default function WorkCaseResultDraft({
  plan,
  checks,
  advice,
  className = '',
}: WorkCaseResultDraftProps) {
  const { t } = useI18n();
  const steps = Array.isArray(plan) ? plan : [];
  const rows = Array.isArray(checks) ? checks : [];
  const advices = Array.isArray(advice) ? advice : [];

  if (rows.length === 0 && advices.length === 0) return null;

  return (
    <div className={`${className} grid min-w-0 gap-1.5`.trim()}>
      {rows.length > 0 && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/45 px-2.5 py-2">
          {rows.map((row) => {
            const step = steps[row.planIndex];
            const title = typeof step?.step === 'string' ? step.step.trim() : '';
            if (!title) return null;
            return (
              <div
                key={row.planIndex}
                data-workcase-check-status={row.status ?? 'unrecorded'}
                className="border-t border-ldvh-border/60 py-1.5 first:border-t-0 first:pt-0.5 ldvh-caption text-ldvh-text-primary"
              >
                <span
                  className={`${TAG_BASE} ${row.status ? CHECK_TAG_CLASS[row.status] : NEUTRAL_TAG_CLASS}`}
                >
                  {row.status
                    ? t(`objectList.workcaseCheck.${row.status}` as LocaleKey)
                    : t('objectList.workcaseCheck.unrecorded')}
                </span>
                <b className="font-semibold">{title}</b>
              </div>
            );
          })}
        </div>
      )}

      {advices.length > 0 && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-indigo-500/[0.045] px-2.5 py-2 dark:bg-indigo-500/[0.1]">
          {advices.map((item, index) => (
            <div
              key={`${item.kind ?? 'other'}-${index}`}
              data-workcase-advice-kind={item.kind ?? 'unclassified'}
              className="border-t border-ldvh-border/60 py-1.5 first:border-t-0 first:pt-0.5 ldvh-caption text-ldvh-text-primary"
            >
              <span
                className={`${TAG_BASE} border-indigo-600/45 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300`}
              >
                {item.kind
                  ? t(`objectList.workcaseAdvice.${item.kind}` as LocaleKey)
                  : t('objectList.workcaseAdvice.unclassified')}
              </span>
              <b className="font-semibold">{item.text}</b>
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
