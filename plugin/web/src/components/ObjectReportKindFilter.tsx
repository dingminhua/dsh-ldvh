import { useMemo } from 'react';
import type { FactCoverageStatus, ObjectItem } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { getFieldValueLabel } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';

/**
 * Study 报告类型（report_kind）标签筛选器。
 *
 * 与 ObjectStatusFilter / ObjectPriorityFilter 同构：ldvh-tab-list 按钮 + 计数。
 * 选项来自当前事实列表（按 report_kind 聚合计数），不新增后端契约；在启用状态下
 * 直接对列表项做内存过滤。未出现在列表中的闭集成员不渲染（如实投影，不出现 0 计数幽灵项）。
 */
export type StudyReportKind = ObjectItem['report_kind'];

// v4 遗留类型修正：report_kind 为可选字段，StudyReportKind 因此携带 undefined；
// 顺序表元素为非可选闭集成员（迁移适配，零运行时行为变化）。
const REPORT_KIND_ORDER: NonNullable<StudyReportKind>[] = [
  'external_research',
  'internal_audit',
  'technical_assessment',
  'comparison',
];

interface ObjectReportKindFilterProps {
  /** 候选列表（用于聚合计数与过滤）。 */
  sourceItems: ObjectItem[];

  activeReportKind: StudyReportKind | null;
  onChange: (reportKind: StudyReportKind | null) => void;

  /** 原始列表，仅用于计数显示（与筛选状态无关）。 */
  allItemsCount: number;
  loading?: boolean;
  coverageStatus?: FactCoverageStatus;
}

function getButtonClass(active: boolean): string {
  return `ldvh-tab-button ${active ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`;
}

function formatCoverageCount(count: number, coverageStatus: FactCoverageStatus): string {
  if (coverageStatus === 'unavailable' || coverageStatus === 'type_not_integrated') return '—';
  return coverageStatus === 'partial' ? `${count}+` : String(count);
}

export default function ObjectReportKindFilter({
  sourceItems,
  activeReportKind,
  onChange,
  allItemsCount,
  loading = false,
  coverageStatus = 'complete',
}: ObjectReportKindFilterProps) {
  const { t, locale } = useI18n();

  const counts = useMemo(() => {
    const map = new Map<StudyReportKind, number>();
    for (const item of sourceItems) {
      const kind = item.report_kind;
      if (kind) map.set(kind, (map.get(kind) ?? 0) + 1);
    }
    return map;
  }, [sourceItems]);

  const presentKinds = REPORT_KIND_ORDER.filter((kind) => counts.has(kind));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" aria-label={t('objectList.reportKindFilter')}>
      <span className="ldvh-meta shrink-0 text-ldvh-text-secondary">{t('objectList.reportKindFilter')}</span>
      <div className="ldvh-tab-list" role="group" aria-label={t('objectList.reportKindFilter')}>
        {presentKinds.map((kind) => {
          const color = CATEGORY_COLORS[kind] ?? CATEGORY_COLORS.other;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onChange(activeReportKind === kind ? null : kind)}
              className={getButtonClass(activeReportKind === kind)}
            >
              <span
                aria-hidden="true"
                className="inline-flex h-[18px] shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-medium leading-3"
                style={{ backgroundColor: `${color}18`, borderColor: `${color}55`, color }}
              >
                {getFieldValueLabel('report_kind', kind, locale)}
              </span>
              <span className="ldvh-tab-count">
                {loading ? '·' : formatCoverageCount(counts.get(kind) ?? 0, coverageStatus)}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={getButtonClass(activeReportKind === null)}
        >
          {t('objectList.all')}
          <span className="ldvh-tab-count">{loading ? '·' : formatCoverageCount(allItemsCount, coverageStatus)}</span>
        </button>
      </div>
    </div>
  );
}