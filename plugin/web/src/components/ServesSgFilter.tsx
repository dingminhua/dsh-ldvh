import type { FactCoverageStatus } from '@/utils/api';
import { useI18n } from '@/i18n/context';

/**
 * serves（子目标引用）第二层筛选（20 §6 serves / 21 §8）——spark 与
 * workcase 共用此组件。
 *
 * 选项源跟随当前 goal 的子目标动态生成（`/api/cognition/goal` 的 `sub_goals`，
 * 由 `subgoals/*.md` 反查派生——28 §8.1 禁止在 goal.md 上存副本）；
 * 计数按当前状态过滤后的对象池统计（与 WorkCase lifecycle 计数同口径，
 * 反映当前过滤器而非全量）。形态对齐 ObjectStatusFilter 的 tab 语法。
 *
 * **选项上显示的是标题，不是 `object_uid`**（2026-11-01）：`serves` 的值已改为
 * uid（28 §12.3），把 uid 当作 tab 标签就是让读者按一串十六进制筛对象。
 * 按下标仍是 uid（`onChange(option.id)`）——那是查询参数与匹配依据，不是文案。
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
      <div className="ldvh-tab-list" role="group" aria-label={t('objectList.servesSgFilter')}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            title={option.text}
            className={getButtonClass(activeServesSg === option.id)}
          >
            {/* 标签是子目标标题，不是 uid：tab 是给读者按语义筛对象的，
                uid 只作 key 与查询参数。标题最长 40 字（28 §8），按行宽截断，
                全文在 title 悬停里。标题缺失时回落 uid——那说明载体不合规，
                显示空白会让这个 tab 变成不可理解的空按钮。 */}
            <span className="max-w-[12rem] truncate">{option.text || option.id}</span>
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
