import SummaryText from '@/components/SummaryText';
import { WORKCASE_ITEM_LIST_CLASS, WORKCASE_ITEM_ROW_CLASS } from '@/utils/workcaseCheckState';

/**
 * WorkCase 判据清单（列表卡与详情共用同一组件）。
 *
 * 列表卡直接使用 —— 紧凑的项目符号清单；
 * 详情页用 `WORKCASE_CRITERIA_SURFACE_CLASS` 把它包成带稳定身份的轻量面板
 * （10 §5.3 语义详情），即消费方在 WorkCaseReadingLayout 的 PlanNode /
 * ResidualNode，而非在本组件内自行切换信息密度。
 *
 * 判据核对状态（satisfied 三态）的映射与呈现词条不在此文件——见
 * `@/utils/workcaseCheckState`（详情/列表卡/收件箱共用的单一实现）。
 */
export const WORKCASE_CRITERIA_SURFACE_CLASS =
  'min-w-0 rounded-md border border-blue-400/20 border-l-2 border-l-blue-400/80 bg-blue-500/[0.025] px-3 py-2.5 dark:bg-blue-950/20';

export interface WorkCaseCriterionListItem {
  key: string;
  statement: string;
}

/**
 * 条目行样式：**卡面**（列表卡、收件箱）用带分割线的统一行样式；
 * **详情面**用宽松行（无分割线、条目间距更大，属阅读面而非扫读面）。
 *
 * 为什么由消费者选而不是组件内判别：卡面与详情面对同一份数据的信息密度要求不同，
 * 而 `docs/10 §1.10` 要求两面共享**同一套设计语言**（同色、同标记、同结构），
 * 差异只在密度。故此处把「密度」显式化为一个参数，而非复制一个组件。
 */
export type WorkCaseCriteriaRowDensity = 'card' | 'detail';

export function WorkCaseCriteriaList({
  items,
  className = '',
  density = 'detail',
}: {
  items: WorkCaseCriterionListItem[];
  className?: string;
  density?: WorkCaseCriteriaRowDensity;
}) {
  // 卡面：复用统一条目行样式（与核对/去向/残留同一串类名），分割线由该样式提供；
  // 详情面：宽松行，无分割线。
  const rowClass =
    density === 'card'
      ? WORKCASE_ITEM_ROW_CLASS
      : 'min-w-0';
  const listClass =
    density === 'card'
      ? `${className} ${WORKCASE_ITEM_LIST_CLASS}`.trim()
      : `${className} grid min-w-0 gap-1.5`.trim();
  return (
    <ul className={listClass}>
      {items.map((item) => (
        <li key={item.key} className={`${rowClass} flex items-start gap-2.5`.trim()}>
          <span
            aria-hidden="true"
            className={`h-1 w-1 shrink-0 rounded-full bg-blue-400/65 dark:bg-blue-400/75 ${
              density === 'card' ? 'mt-[0.55rem]' : 'mt-[0.5rem]'
            }`}
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
