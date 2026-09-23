import { useMemo } from 'react';
import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import {
  markWorkCaseFlow,
  ownChangeLogEntries,
  type WorkCaseFlowMark,
} from '../../shared/workcaseLifecycle';

/**
 * WorkCase 变更流水（卡片主体）。
 *
 * 10 §5.5「执行期阶段」的呈现代替品（Human 2026-09-23）：**不显示阶段标签**，
 * 而在流水里用「复核」「修订」二字标出关键行动。状态显示（对象头部）不受影响，
 * 恒为 21 号状态机的真实值。
 *
 * 口径（全部来自 shared/workcaseLifecycle，不在此自行判断）：
 * - 只显示**本对象**条目——他对象条目（口径②）与格式治理条目（口径③）已被
 *   `ownChangeLogEntries` 排除；
 * - 标记由 `markWorkCaseFlow` 逐条给出（机械标记优先，措辞兜底，数组序判修订）。
 */

/** 最多显示的条目数（超出折叠，与详情面一致：卡面是扫读窗口）。 */
const MAX_ITEMS = 8;

export interface WorkCaseExecFlowProps {
  changeLog?: unknown;
  reviews?: unknown;
  /** 本对象 object_id（用于排除提及他对象的条目）。 */
  selfUid: string | null;
  className?: string;
}

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const raw = value.trim();
  // 纯日期串按本地时区解析（与 api/services/time.ts 同口径，避免跨时区偏一天）。
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatHhmm(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 摘要末尾的 Code 托管标记不进入正文（如 `[attempt 1 heartbeat refreshed]`）。 */
function stripTrailingBrackets(text: string): string {
  return text.replace(/\s*\[(?:attempt|review recorded|C2|gate_\d)[^\]]*\]\s*$/i, '').trim();
}

export default function WorkCaseExecFlow({
  changeLog,
  reviews,
  selfUid,
  className = '',
}: WorkCaseExecFlowProps) {
  const { t, locale } = useI18n();

  const { rows, total, hidden } = useMemo(() => {
    const own = ownChangeLogEntries(changeLog, selfUid);
    const marks = markWorkCaseFlow(reviews, changeLog, selfUid);
    // 最新在上
    const reversed = [...own].reverse();
    const shown = reversed.slice(0, MAX_ITEMS);
    return {
      total: own.length,
      hidden: Math.max(0, reversed.length - shown.length),
      rows: shown.map(({ index, entry }) => {
        const summary = typeof entry.summary === 'string' ? entry.summary : '';
        const at = (entry as { at?: unknown }).at;
        const date = parseInstant(at);
        return {
          index,
          mark: (marks[index] ?? null) as WorkCaseFlowMark | null,
          text: stripTrailingBrackets(summary),
          date,
        };
      }),
    };
  }, [changeLog, reviews, selfUid]);

  if (rows.length === 0) return null;

  const weekdays = locale === 'en' ? WEEKDAYS_EN : WEEKDAYS_ZH;

  return (
    <div className={`${className} min-w-0`.trim()}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="ldvh-caption-strong text-ldvh-text-secondary">
          {t('objectList.workcaseFlow')}
        </span>
        <span className="ldvh-caption text-ldvh-text-secondary/80">
          {t('objectList.workcaseFlowCount', { count: String(total) })}
        </span>
      </div>

      <div className="grid min-w-0 gap-1.5">
        {rows.map((row, i) => {
          const prev = i > 0 ? rows[i - 1].date : null;
          const newDay =
            row.date !== null && (prev === null || dayKey(prev) !== dayKey(row.date));
          return (
            <div key={row.index} className="min-w-0">
              {newDay && row.date !== null && (
                <div className="ldvh-caption mb-1 mt-1.5 flex items-baseline gap-2 text-ldvh-text-secondary/85 first:mt-0">
                  <span className="font-semibold tabular-nums">
                    {`${pad2(row.date.getMonth() + 1)}-${pad2(row.date.getDate())} ${weekdays[row.date.getDay()]}`}
                  </span>
                </div>
              )}
              <div className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)] items-baseline gap-x-2.5">
                <span className="ldvh-caption text-right tabular-nums text-ldvh-text-secondary/90">
                  {row.date === null ? '--:--' : formatHhmm(row.date)}
                </span>
                <span className="ldvh-caption min-w-0 break-words text-ldvh-text-primary">
                  {row.mark !== null && (
                    <span
                      data-workcase-flow-mark={row.mark}
                      className={
                        row.mark === 'review'
                          ? 'mr-1.5 inline-block rounded border border-violet-500/45 bg-violet-500/10 px-1 text-[10px] font-semibold leading-4 text-violet-700 dark:text-violet-300'
                          : 'mr-1.5 inline-block rounded border border-amber-600/50 bg-amber-500/15 px-1 text-[10px] font-semibold leading-4 text-amber-700 dark:text-amber-300'
                      }
                    >
                      {t(`objectList.workcaseFlowMark.${row.mark}` as LocaleKey)}
                    </span>
                  )}
                  {row.text}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {hidden > 0 && (
        <div className="ldvh-caption mt-1.5 text-right text-ldvh-text-secondary/80">
          {t('objectList.workcaseFlowMore', { count: String(hidden) })}
        </div>
      )}
    </div>
  );
}
