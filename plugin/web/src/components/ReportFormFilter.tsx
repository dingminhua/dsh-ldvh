import { useMemo } from 'react';
import { useI18n } from '@/i18n/context';
import { getFieldValueLabel } from '@/i18n/locales';

/**
 * 24 §5（2026-11-14）：报告形态筛选条。
 *
 * 背景：24 号由 Research-调研报告 改造为 Report-报告 后，三种来源形态
 * （调研型／总结型／审核型）共用一个 `report` 类型，靠 `report_form` 区分。
 * 类型筛选看不出形态差异，故本组件在报告列表上单独提供形态筛选。
 *
 * **样式参照 `ObjectPriorityFilter` 与 changelog 的 `CommitFilterGroup`**：
 * 同一个 `ldvh-tab-list` 容器 + 同一组 `ldvh-tab-button` 类，**只有文字着色
 * 区分选项**，不加背景与边框——大面积色块会让筛选条抢走列表内容的注意力，
 * 与既有筛选条也不一致。
 *
 * 与 `ObjectStatusFilter` 的分工：那个筛**状态**（活跃／已废弃），本组件筛
 * **形态**（调研／总结／审核）。两者正交、可叠加。
 */
export type ReportForm = 'research' | 'summary' | 'audit';

/**
 * 三形态的文字色。
 *
 * 取报告类别色 teal `#14b8a6`（见 `categoryColors.ts`）的邻近色域：三者同族
 * 可辨，不会被误读成三个不同的事实类型；又因色调有区分，扫读时不至于混成一片。
 * （与 `CommitFilterGroup` 用的 `CATEGORY_COLORS[commitType]` 同一手法：
 * 颜色只做文字色，不做底色。）
 */
const FORM_TEXT_COLOR: Record<ReportForm, string> = {
  research: '#0f766e', // teal-700
  summary: '#0891b2',  // cyan-600
  audit: '#4338ca',    // indigo-700
};

const FORM_ORDER: ReportForm[] = ['research', 'summary', 'audit'];

interface ReportFormFilterProps {
  /** 当前选中的形态；null 表示「全部」（不过滤）。 */
  activeForm: ReportForm | null;
  onChange: (form: ReportForm | null) => void;
  /** 后端 `formOptions`：只含实际出现的形态。 */
  options?: Array<{ status: string; count: number }>;
  /** 「全部」的总数（当前池的对象数）。 */
  total?: number;
  loading?: boolean;
  className?: string;
}

function getButtonClass(active: boolean): string {
  return `ldvh-tab-button ${active ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`;
}

export default function ReportFormFilter({
  activeForm,
  onChange,
  options = [],
  total = 0,
  loading = false,
  className = '',
}: ReportFormFilterProps) {
  const { t, locale } = useI18n();

  // 只保留闭集内的形态并固定次序——形态是分类不是排序项，
  // 按计数排会让读者每次都在不同位置找同一形态。
  const forms = useMemo(() => {
    const countOf = new Map(options.map((option) => [option.status, option.count]));
    return FORM_ORDER.filter((form) => countOf.has(form)).map((form) => ({
      form,
      count: countOf.get(form) ?? 0,
    }));
  }, [options]);

  // 一个形态都没有时不渲染：此时筛选无可筛，占位只会误导。
  if (forms.length === 0) return null;

  return (
    <div className={`ldvh-tab-list ${className}`} aria-label={t('objectList.formFilter')}>
      {/* 「全部」在首位：与 `CommitFilterGroup` 一致（那里 allLabel 也排第一），
          它是不筛选的兜底项，读者第一眼就该看到「不筛」这个默认态。 */}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={getButtonClass(activeForm === null)}
      >
        {t('objectList.all')}
        <span className="ldvh-tab-count">{loading ? '·' : total}</span>
      </button>
      {forms.map(({ form, count }) => (
        <button
          key={form}
          type="button"
          onClick={() => onChange(form)}
          // 颜色只做文字色，与 `CommitFilterGroup` 的 getOptionColor 同一手法。
          style={{ color: FORM_TEXT_COLOR[form] }}
          className={getButtonClass(activeForm === form)}
        >
          {getFieldValueLabel('report_form', form, locale)}
          <span className="ldvh-tab-count">{loading ? '·' : count}</span>
        </button>
      ))}
    </div>
  );
}
