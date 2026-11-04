// `summary` 字段的 200 字符上限（workcase-5eec3197 的处置，Human 2026-11-04 裁定 B1）。
//
// ## 为什么需要它
//
// `summary` 此前**没有任何长度上限**——八部规范里零处登记。后果不是抽象的：
// 实测（2026-11-04）`spark-a1209317` 的 `summary` 1201 字，正文 1290 字，
// 其中 1201 字就是 summary 的原样复制——正文独立信息只剩 89 字。全库一度有
// 36% 的 Spark 处于「正文 ≈ summary 副本」状态。
//
// 同时另有四个字段**早已**有 200 字符硬上限，纪律完全一致（UTF-16 码元、
// 超限拒绝、不得截断后写入）：
//
//   * `Spark.disposition`（20 §9.1）
//   * `WorkCase.gist`（21 §8）
//   * `Pitfall.disposition`（23 §9.1）
//   * Goal 目标陈述（25 §7）
//
// `summary` 缺这一条不是「有规定没执行」，而是从来没定过。本模块补上它，
// 并沿用那四处的同一判定单位与拒绝纪律——「保持一致」在机械层就是共用同一个
// 常数与同一条消息形态。
//
// ## 为什么只查本次改动的字段（Human 裁定 B1）
//
// 若对存量无条件生效，实测会有 **110 条对象**（Spark 66、WorkCase 44、DevLog 3）
// 立即变成只读——它们现存 summary 全部超限，而任何一次 update 都会校验该字段。
// 那等于用一条新规则冻结整个事实源。
//
// 故沿用 21 §15.1 已确立的先例：「只校验相对基线**新增或改动**的字段，逐字未改
// 的既有字段放行——否则……将使受影响对象永久无法关闭」。B1 的语义正是如此：
// **新写入受约束，存量保持原样**。
//
// 调用方负责判断「本次是否改动」，本模块只提供判定与消息——把「要不要查」的
// 决定留给各 writer，是因为各类型的基线比对方式不同（有的比整个 frontmatter，
// 有的只比传入的字段）。
//
// ## 边界
//
// 上限是**索引层上限**而非表达上限：完整论述属于正文。这与 `gist`／`disposition`
// 的「扫读上限」同理——写不下时作者只能把细节挪到它该在的地方（正文）。
// 但须如实说明：`summary` 的定位比它们更重（20 §8 要求「使未读原聊天者能独立
// 理解」），200 字对复杂议题可能不够。故本上限**只约束新写入**，且拒绝时给出
// 当前字数与超出量，让作者知道该砍多少，而不是只给一个「超限」。

/** 判定单位与 20 §9.1 / 21 §8 / 23 §9.1 / 25 §7 一致：UTF-16 码元，按 `.length`。 */
export const SUMMARY_MAX_CHARS = 200;

/**
 * 计算 `summary` 的长度（去除首尾空白后，按 UTF-16 码元）。
 *
 * 与 Goal 目标陈述的计数方式一致（25 §7：去除首尾空白后计算，段内换行与空白
 * 照常计入）。不一致的计数方式会让「同一个 200」在两个字段上含义不同。
 *
 * @param {unknown} value
 * @returns {number}
 */
export function summaryLength(value) {
  return typeof value === "string" ? value.trim().length : 0;
}

/**
 * 判定一个 `summary` 是否超限。未超限返回 `null`，超限返回可直接进 `issues` 的消息。
 *
 * 消息形态与四处既有上限保持同族措辞（`≤ N 字符`、`不得截断后写入`），
 * 并额外给出当前字数与超出量——那四处只报「超限」，作者得自己数字数；
 * 这里多给两个数不改变纪律，只是让拒绝可据以修正（同 coherence-report 的取向）。
 *
 * @param {unknown} value
 * @param {object} [options]
 * @param {string} [options.field] 字段名，默认 `summary`（evolution[].summary 等场合可覆盖）。
 * @param {string} [options.clause] 该类型的条款依据，如 `"20 §8"`。
 * @returns {string|null}
 */
export function summaryLimitIssue(value, { field = "summary", clause } = {}) {
  const length = summaryLength(value);
  if (length <= SUMMARY_MAX_CHARS) return null;
  const where = clause === undefined || clause.length === 0 ? "" : ` (${clause})`;
  return `${field}: must be ≤ ${SUMMARY_MAX_CHARS} characters (UTF-16 code units, same unit as `
    + `Spark.disposition / WorkCase.gist / Pitfall.disposition / Goal 目标陈述)${where}; `
    + `got ${length} — 超 ${length - SUMMARY_MAX_CHARS} 字符。上限是索引层上限，`
    + `完整论述属于正文；**不得截断后写入**（截断会破坏载体内聚：正文须逐字包含 summary）`;
}
