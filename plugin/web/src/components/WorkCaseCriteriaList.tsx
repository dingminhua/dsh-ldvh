import SummaryText from '@/components/SummaryText';

/**
 * WorkCase 判据清单（列表卡与详情共用同一组件）。
 *
 * 列表卡直接使用 —— 紧凑的项目符号清单；
 * 详情页用 `WORKCASE_CRITERIA_SURFACE_CLASS` 把它包成带稳定身份的轻量面板
 * （10 §5.3 语义详情），即消费方在 WorkCaseReadingLayout 的 PlanNode /
 * ResidualNode，而非在本组件内自行切换信息密度。
 */
export const WORKCASE_CRITERIA_SURFACE_CLASS =
  'min-w-0 rounded-md border border-blue-400/20 border-l-2 border-l-blue-400/80 bg-blue-500/[0.025] px-3 py-2.5 dark:bg-blue-950/20';

export interface WorkCaseCriterionListItem {
  key: string;
  statement: string;
}

export function WorkCaseCriteriaList({
  items,
  className = '',
}: {
  items: WorkCaseCriterionListItem[];
  className?: string;
}) {
  return (
    <ul className={`${className} grid min-w-0 gap-1.5`.trim()}>
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-[0.5rem] h-1 w-1 shrink-0 rounded-full bg-blue-400/65 dark:bg-blue-400/75"
          />
          <div className="ldvh-caption min-w-0 flex-1 break-words [&_p]:my-0">
            {item.statement.trim() && (
              <SummaryText
                value={item.statement}
                collapseThreshold={Number.MAX_SAFE_INTEGER}
                className="ldvh-card-decision-body text-blue-900/70 dark:text-blue-100/75"
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
