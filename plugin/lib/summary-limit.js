
export const SUMMARY_MAX_CHARS = 200;

export function summaryLength(value) {
  return typeof value === "string" ? value.trim().length : 0;
}

export function summaryLimitIssue(value, { field = "summary", clause } = {}) {
  const length = summaryLength(value);
  if (length <= SUMMARY_MAX_CHARS) return null;
  const where = clause === undefined || clause.length === 0 ? "" : ` (${clause})`;
  return `${field}: must be ≤ ${SUMMARY_MAX_CHARS} characters (UTF-16 code units, same unit as `
    + `Spark.disposition / Pitfall.disposition / Goal 目标陈述)${where}; `
    + `got ${length} — 超 ${length - SUMMARY_MAX_CHARS} 字符。上限是索引层上限，`
    + `完整论述属于正文；**不得截断后写入**（截断会破坏载体内聚：正文须逐字包含 summary）`;
}
