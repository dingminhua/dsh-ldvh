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
  /** 后端 `formOptions`：只含实际出现的形态。未出现的形态按 0 显示。 */
  options?: Array<{ status: string; count: number }>;
  /** 「全部」的计数（当前池的对象总数，含未分档/未归类者）。 */
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

  // **三个形态一律显示，没有的显示 0**（Human 2026-11-14）：
  // 先前只列实际出现的形态，于是「总结」「审核」两条在库里暂时为空时整体消失，
  // 读者看不出这三类形态是这个类型的一部分，也看不出当前没有该类报告。
  // 全列出来才回答得了「有没有总结型/审核型」这个问题——隐藏它等于让读者
  // 以为这类形态不存在。（次序固定为闭集次序：分类项不按计数排序。）
  const forms = useMemo(() => {
    const countOf = new Map(options.map((option) => [option.status, option.count]));
    return FORM_ORDER.map((form) => ({ form, count: countOf.get(form) ?? 0 }));
  }, [options]);

  return (
    <div className={`ldvh-tab-list ${className}`} aria-label={t('objectList.formFilter')}>
      {/* Human 2026-11-14：形态组也要有「全部」——本组是独立一行，
          与状态筛选那一行分开，不会再出现两个「全部」并排的观感。
          位置在**末位**（Human 2026-11-14 定案）：具体形态在前、兜底的「全部」
          在后。与状态筛选条一致（那里「全部」也在末位）——具体项先给读者看到，
          「不筛选」作为兜底不需要抢首位。 */}
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
      <button
        type="button"
        onClick={() => onChange(null)}
        className={getButtonClass(activeForm === null)}
      >
        {t('objectList.all')}
        <span className="ldvh-tab-count">{loading ? '·' : total}</span>
      </button>
    </div>
  );
}
