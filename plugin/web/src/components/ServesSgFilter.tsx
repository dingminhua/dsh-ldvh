import type { FactCoverageStatus } from '@/utils/api';
import { useI18n } from '@/i18n/context';

/**
 * Spark 的 serves_sg（SG-n 子目标锚点）筛选——第二层筛选（20 §6 serves）。
 *
 * 选项源跟随当前 goal 的子目标动态生成（25 号 goal.md 的 sub_goals——
 * Human 定案 2026-09-13：SG 的数量与变化以 goal 为准，Spark 列表按其筛选）；
 * 计数按当前状态过滤后的 spark 池统计（与 WorkCase priority 计数同口径，
 * 反映当前过滤器而非全量）。形态对齐 ObjectStatusFilter 的 tab 语法。
 */
interface ServesSgFilterOption {
  id: string;
  text: string;
}

interface ServesSgFilterProps {
  activeServesSg: string | null;
  onChange: (servesSg: string | null) => void;
  options?: ServesSgFilterOption[];
  counts?: Map<string, number>;
  total: number;
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

export default function ServesSgFilter({
  activeServesSg,
  onChange,
  options = [],
  counts = new Map(),
  total,
  loading = false,
  coverageStatus = 'complete',
}: ServesSgFilterProps) {
  const { t } = useI18n();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" aria-label={t('objectList.servesSgFilter')}>
      <span className="ldvh-meta shrink-0 text-ldvh-text-secondary">{t('objectList.servesSgFilter')}</span>
      <div className="ldvh-tab-list" role="group" aria-label={t('objectList.servesSgFilter')}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            title={option.text}
            className={getButtonClass(activeServesSg === option.id)}
          >
            <span className="font-mono">{option.id}</span>
            <span className="ldvh-tab-count">
              {loading ? '·' : formatCoverageCount(counts.get(option.id) ?? 0, coverageStatus)}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={getButtonClass(activeServesSg === null)}
        >
          {t('objectList.all')}
          <span className="ldvh-tab-count">{loading ? '·' : formatCoverageCount(total, coverageStatus)}</span>
        </button>
      </div>
    </div>
  );
}
