// 载体内聚拒绝的取证辅助。
//
// ## 为什么需要它
//
// 载体内聚要求 frontmatter 字段逐字出现在正文对应段（各类型规范 §8 各自登记）。
// 判据本身正确，但**报错给出的信息量**在不同类型之间差很多：
//
//   * pitfall 自 2026-10-17 起给出两侧全文（`clipped(text, 400)`），一次失败即可
//     据以修正；
//   * adr／friction／spark／research 只给字段值的前 40 字——而实测的失败形态
//     恰恰是「高度相似但差一点」（scope 以 `。` 收尾而正文用 `；` 续写、正文开头
//     多写了 `适用范围：`、术语补了反引号），前缀无从区分；
//   * devlog／subgoal 根本不打印字段值，报错只有 85–91 字符。
//
// 本模块把那套取证能力抽成一处，让十一个调用点（八个有逐字判据的类型 + 各自
// 的段落定位）共用同一实现。**判据一字未动**：仍要求逐字包含，这里只负责把
// 「哪里不一样」说清楚。
//
// ## 单侧 400 字上界的来历
//
// 沿用 pitfall 的先例（930bd32 建立）。上界不是判据的一部分——它是**呈现**的
// 约束：报错塞进整篇正文会挤掉调用方真正需要看的其他信息，而超长时注明真实
// 总长（「共 N 字」）就能让它知道该去读载体而不是读报错。
//
// ## 不在本模块内的东西
//
// 段落定位（`sectionContent`）仍在各 writer 内——它们的 H2 标题、结构校验、
// 修复建议形态各不相同，抽出来会强行统一本不必统一的东西。

/** 单侧呈现上界（字符）。沿用 pitfall 的 400。 */
export const COHERENCE_CLIP = 400;

/**
 * 单侧文本的呈现形态：未超限原样返回，超限截断并注明真实总长。
 *
 * 注明总长是必要的：只给「前 400 字…」而不给总数时，调用方无法判断自己是
 * 差一点点还是差了很远，也不知道该不该去读载体。
 *
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function clipped(text, max = COHERENCE_CLIP) {
  const value = typeof text === "string" ? text : String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}…（共 ${value.length} 字）` : value;
}

/**
 * 载体内聚拒绝的统一消息形态：字段侧与正文侧都给出。
 *
 * 消息结构固定为
 *   `carrier coherence: <段落> section must contain <字段> verbatim
 *    (frontmatter is the single authoritative text, <条款>): <字段>=[…]; section=[…]`
 *
 * 三处刻意如此：
 *   1. **两侧都给**，且都过 {@link clipped}——只给一侧等于没给；
 *   2. **条款号是参数**，由各 writer 传入自己的实际依据，不在这里写死：各类型
 *      的内聚条款登记在不同章节（22 §8／20 §14.1／23 §8／24 §8／26 §8／27 §7／
 *      28 §8／29 §8／21 §8），写死一处必然对某几类是错的；
 *   3. **只印失败字段对应的那一段**，不印整篇正文（本条 scope
 *      第五条）——`section` 由调用方传入它已经切出的那一段。
 *
 * @param {object} input
 * @param {string} input.section 正文段名（不含 `## `）。
 * @param {string} input.field frontmatter 字段名。
 * @param {string} input.declared frontmatter 侧的值（权威文本）。
 * @param {string} input.actual 正文该段的实际内容。
 * @param {string} [input.clause] 该类型内聚条款的准确出处，如 `"22 §8, §14.1"`。
 * @param {"rejection"|"divergence"} [input.mode] 这条消息是**拒绝**还是**只报告**。
 *   缺省 `rejection`——与既有八个调用点逐字一致，行为不变。
 *
 *   `divergence` 供**已取消逐字义务**的类型使用（当前只有 devlog，29 §8 字段间
 *   不变量 1：Human 2026-11-10 取消逐字，差异只报告不阻断）。此时沿用
 *   「must contain … verbatim」会把一条**不阻断的差异**说成一条**未满足的要求**——
 *   读者据此会去改一篇本来合法的正文（复审 N1 的同一类缺陷：消息文本与真实
 *   判据不符）。故该模式下措辞改为「differs from」，且不再断言
 *   「frontmatter is the single authoritative text」之外的强制含义。
 * @returns {string}
 */
export function carrierCoherenceMessage({ section, field, declared, actual, clause, mode = "rejection" }) {
  const where = clause === undefined || clause.length === 0 ? "" : `, ${clause}`;
  const body = ` ${field}=${JSON.stringify(clipped(declared))}`
    + `; section=${JSON.stringify(clipped(actual))}`;
  if (mode === "divergence") {
    return `carrier coherence (reported, NOT blocking): ${section} section differs from ${field}`
      + ` (frontmatter is the index/summary layer and the body expands it${where}):`
      + body;
  }
  return `carrier coherence: ${section} section must contain ${field} verbatim`
    + ` (frontmatter is the single authoritative text${where}):`
    + body;
}
