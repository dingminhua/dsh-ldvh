import { Target } from 'lucide-react';
import { getFieldLabel } from '@/i18n/locales';

/** serves_sg（20 §6：goal.md 子目标的 SG-n 轻量锚点，条件出现）归一为列表。
 * 规范当前为单值 string；渲染兼容 string[]，规范演进为数组时无需改前端。 */
function normalizeServesSgList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }
  return [];
}

/** 子目标锚点标签：紧跟事实对象类型标签的 chip（卡片与详情头共用呈现）。 */
export default function ServesSgBadge({ value, locale }: { value: unknown; locale: string }) {
  const values = normalizeServesSgList(value);
  if (values.length === 0) return null;
  const label = getFieldLabel('serves_sg', locale);
  return (
    <>
      {values.map((sg) => (
        <span
          key={sg}
          className="ldvh-chip-sm gap-1 border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400"
          title={`${label} · ${sg}`}
        >
          <Target size={12} aria-hidden="true" />
          <span>{sg}</span>
        </span>
      ))}
    </>
  );
}
