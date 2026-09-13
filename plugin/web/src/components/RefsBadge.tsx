import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { getFieldLabel } from '@/i18n/locales';

/**
 * refs（03 §7.2 关联引用型 / 20 §8）：关联的事实对象引用。
 *
 * 规范形态为 `{ object_uid }[]`（03 §7.2 最小形状：不复制目标标题）。
 * 列表投影可附带派生出的 title/type 供阅读，但那是派生结果、不写回对象，
 * 也不构成第二权威（03 §7.2 第 4 条）——此处只是把已有信息渲染出来。
 *
 * 呈现理由（Human 侧）：Spark 正文是给 AI 的，Human 在列表上能看到的只有
 * 卡片。refs 以 chip 形式出现，Human 扫一眼就知道本议题关联了哪些对象，
 * 而不必展开全文。
 */

export interface RefsEntry {
  object_uid: string;
  /** 派生字段（可选）：目标标题，仅用于呈现。 */
  title?: string;
  /** 派生字段（可选）：目标类型短名，用于呈现与配色。 */
  type?: string;
}

export function normalizeRefsList(value: unknown): RefsEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RefsEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    // Tolerate both the canonical `{ object_uid }` shape and a bare uid string.
    const uid =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof (item as RefsEntry).object_uid === 'string'
          ? (item as RefsEntry).object_uid
          : null;
    if (!uid || !uid.trim() || seen.has(uid)) continue;
    seen.add(uid);
    const entry = item as RefsEntry;
    out.push({
      object_uid: uid,
      title: typeof entry?.title === 'string' && entry.title.trim() ? entry.title : undefined,
      type: typeof entry?.type === 'string' && entry.type.trim() ? entry.type : undefined,
    });
  }
  return out;
}

/** 关联对象标签：与子目标锚点 chip 同族（卡片与详情头共用呈现）。
 *
 * 只显示前 `limit` 个，其余折叠为 `+N`——卡片高度必须可预期，否则列表
 * 扫读价值被长关联表破坏。 */
export default function RefsBadge({
  value,
  locale,
  limit = 3,
}: {
  value: unknown;
  locale: string;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = normalizeRefsList(value);
  if (entries.length === 0) return null;

  const label = getFieldLabel('refs', locale);
  const shown = expanded ? entries : entries.slice(0, limit);
  const overflow = entries.length - shown.length;

  return (
    <>
      {shown.map((entry) => {
        const text = entry.title ?? entry.object_uid;
        return (
          <span
            key={entry.object_uid}
            className="ldvh-chip-sm gap-1 max-w-[16rem] border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
            title={`${label} · ${entry.object_uid}${entry.title ? ` · ${entry.title}` : ''}`}
          >
            <Link2 size={12} aria-hidden="true" />
            <span className="truncate">{text}</span>
          </span>
        );
      })}
      {overflow > 0 && (
        <button
          type="button"
          className="ldvh-chip-sm border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
          title={entries.slice(limit).map((e) => e.title ?? e.object_uid).join('\n')}
          onClick={() => setExpanded(true)}
        >
          {`+${overflow}`}
        </button>
      )}
    </>
  );
}
