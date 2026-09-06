import { normalizeGitTimestampInput } from '../../shared/timestamp.ts';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Format an instant as YYYY-MM-DD HH:mm in the browser's local timezone.
 *
 * Historical facts may carry an explicit non-UTC offset.  Date must parse the
 * complete instant before extracting calendar fields; slicing the source text
 * would display UTC and local-offset values inconsistently.
 */
export function formatDateTime(value?: string | null): string {
  if (!value) return '-';

  const raw = String(value).trim();
  if (!raw || raw === '-') return '-';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const date = new Date(normalizeGitTimestampInput(raw).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return raw;

  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('-') + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
