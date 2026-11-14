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
 * 与 `ObjectStatusFilter` 的分工：那个筛的是**状态**（活跃／已废弃），
 * 本组件筛的是**形态**（调研／总结／审核）。两者正交，可叠加：状态取当前池、
 * 形态也取当前池（后端 `formOptions` 与 `statusOptions` 同口径）。
 *
 * 只有 `report` 类型有形态；其它类型 `formOptions` 为空，本组件整条不渲染。
 */
export type ReportForm = 'research' | 'summary' | 'audit';

/**
 * 三形态各自的强调色。
 *
 * 取色依据（不与既有类型色冲突）：报告的类别色是 teal `#14b8a6`
 * （见 `categoryColors.ts`），三形态在其邻近色域内拉开明度与冷暖：
 * 调研型取 teal 本尊（对外取证，主用途）、总结型取其偏青的邻居、
 * 审核型取偏蓝的邻居——三者同族可辨，又不至于被误读成别的类型。
 */
const FORM_COLORS: Record<ReportForm, { hue: string; bg: string; border: string }> = {
  research: { hue: '#0f766e', bg: 'rgba(15,118,110,0.10)', border: 'rgba(15,118,110,0.45)' }, // teal-700
  summary: { hue: '#0891b2', bg: 'rgba(8,145,178,0.10)', border: 'rgba(8,145,178,0.45)' },   // cyan-600
  audit: { hue: '#4338ca', bg: 'rgba(67,56,202,0.10)', border: 'rgba(67,56,202,0.45)' },     // indigo-700
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

function CountPlaceholder() {
  return (
    <span aria-hidden="true" className="inline-flex items-center justify-center gap-0.5 align-middle opacity-40">
      <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
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
  if (forms.length === 0 && !loading) return null;

  const items: Array<{ key: ReportForm | null; label: string; count: number }> = [
    ...forms.map(({ form, count }) => ({
      key: form,
      label: getFieldValueLabel('report_form', form, locale),
      count,
    })),
    // 「全部」放末位：与状态筛选条一致（那里「全部」也在末尾），
    // 且它是不筛选的兜底项，不适合抢在具体形态之前。
    { key: null, label: t('objectList.all'), count: total },
  ];

  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}
      aria-label={t('objectList.formFilter')}
      aria-busy={loading || undefined}
    >
      {items.map(({ key, label, count }) => {
        const active = activeForm === key;
        const palette = key === null ? null : FORM_COLORS[key];
        // 三形态各用自己的色；「全部」用中性色——它是兜底项，不着形态色，
        // 否则读者会把它当成第四种形态。
        const style = active && palette
          ? { backgroundColor: palette.bg, borderColor: palette.border, color: palette.hue }
          : active
            ? { backgroundColor: 'rgba(100,116,139,0.12)', borderColor: 'rgba(100,116,139,0.45)', color: '#475569' }
            : undefined;
        const idleStyle = !active && palette ? { borderColor: 'rgba(148,163,184,0.45)', color: palette.hue } : undefined;
        return (
          <button
            key={key ?? 'all'}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={`ldvh-tab-button ${active ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
            style={active ? style : idleStyle}
          >
            {label}
            {loading ? <CountPlaceholder /> : <span className="ldvh-tab-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
