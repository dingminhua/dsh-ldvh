// `recall_digest` 陈旧检测（02 §7.1；Human 2026-11-10）。
//
// ## 解决什么问题
//
// `recall_digest` 是**召回摘要**：读者是词法匹配器，存在目的是让对象被查到。
// 它随对象内容演进会逐渐失准——内容改了、digest 还是旧的，候选卡上的关键词面
// 就与正文脱节。用户的要求是「每次变更 digest 就要重写一次」。
//
// ## 为什么不做成机械门禁（这是本模块的**核心边界声明**）
//
// 机械层**分不清两类「正文变了」**：
//
//   * **追加证据**——Friction 的补充观察（追加逐字引证 + `count` 递增 + `last_at`）、
//     `change_log` 追加一条流水、`status` 翻转。这些**不改变内容语义**，
//     digest 一个字都不该动。实测全库 290 次更新属此类，占账本正常运转的主体。
//   * **修正结论**——把根因写错了、边界收窄了、判据换了。这些**改变内容语义**，
//     digest 必须重写。
//
// 两者的机械特征完全相同（都是正文文本变了），判定它们需要语义判断，而
// `02 §9` 明令 Code 不得做语义裁决。故机械门禁会把 290 次正常写入判红。
//
// ## 因此本模块只做一件事：**窄口径提示**
//
// 只在一种情形下给出 warning：**经过机械可判的「内容语义字段」发生了变化、
// 而 `recall_digest` 一字未动**。内容语义字段是各类型规范里承载结论的**标量字段**
// （见 `CONTENT_FIELDS_BY_TYPE`），不是正文——正文的变化可能是追加证据，
// 标量字段的变化则一定是对该结论本身的改写。
//
// 满足条件时的**代价是零**：写入照常成功，只是在返回值里多一条 `warnings`。
// 不满足（例如只追加补充观察）时完全静默——不制造噪声。
//
// **如实声明的边界**：本机制不保证 digest 与内容同步，也不试图保证。它只在
// 「结论字段被改写而 digest 没动」这一可判形态上提示，其余情形（含正文改写）
// 看不见。不成立不代表 digest 一定陈旧，成立也不代表 digest 一定错——
// 判断仍由 AI 在写入时承担（这是唯一能做语义判断的一方）。

/**
 * **机械可判的内容语义字段**（各类型规范 §8 登记的「结论承载标量」）。
 *
 * 口径：**该字段的值一变，就等于「这条对象的结论被改写」**，与「追加一段证据」
 * 有本质区别。故只收标量结论字段，不收正文、不收流水类字段
 * （`change_log`/`occurrence`/`status`/`relations` 等），也不收索引类字段
 * （`title` 是定位词，不承载结论）。
 */
export const CONTENT_FIELDS_BY_TYPE = Object.freeze({
  spark: Object.freeze(["summary"]),
  pitfall: Object.freeze(["scope"]),
  friction: Object.freeze(["phenomenon"]),
  research: Object.freeze(["research_question", "research_purpose"]),
  subgoal: Object.freeze(["criterion", "alignment"]),
  devlog: Object.freeze(["summary"]),
  adr: Object.freeze(["decision", "scope"]),
  norm: Object.freeze([]), // 规则散文住正文，无结论标量（27 §7）
  workcase: Object.freeze(["gist", "summary"]),
});

/** 面向读者的提示语（各类型共用，措辞不分支——分支会让读者以为判据不同）。 */
export function digestStaleMessage({ type, changedFields }) {
  const fields = changedFields.join(" / ");
  return `recall_digest may be stale: content field(s) ${fields} changed but `
    + `recall_digest was left unchanged (02 §7.1, Human 2026-11-10). `
    + `The digest is the lexical recall surface — if this change altered the `
    + `conclusion, rewrite recall_digest so the object still matches the terms `
    + `a future query would use. If this was only a wording fix, ignore this warning. `
    + `Write is NOT blocked: the digest is an independent index, not a derived `
    + `summary of the body (02 §7.1「各自独立演进」), so no mechanical gate can `
    + `judge whether your change was semantic. type=${type}`;
}

/**
 * 判定一次更新是否构成「结论被改写而 digest 未跟进」。
 *
 * @param {object} input
 * @param {string} input.type 事实类型短名（`CONTENT_FIELDS_BY_TYPE` 的键）。
 * @param {object|null|undefined} input.baseline 更新前的 frontmatter。
 * @param {object|null|undefined} input.next 更新后的 frontmatter。
 * @returns {{stale: boolean, changedFields: string[]}}
 *
 * **不成立的情形（返回 stale=false，且这是刻意的）**：
 *  * 基线不可得（新建、或读不到旧值）——无从比较，不得凭空断言陈旧；
 *  * 对象本就没有 `recall_digest`——它走回退链（`summary` → 正文 → `title`），
 *    没有可陈旧的东西；
 *  * `recall_digest` 本身变了——写入方已经跟进了；
 *  * 内容字段未变——包括「只追加补充观察」「只翻状态」「只记流水」。
 */
export function detectDigestStaleness({ type, baseline, next }) {
  const fields = CONTENT_FIELDS_BY_TYPE[type];
  if (fields === undefined || fields.length === 0) return { stale: false, changedFields: [] };
  if (baseline === null || baseline === undefined || typeof baseline !== "object") {
    return { stale: false, changedFields: [] };
  }
  if (next === null || next === undefined || typeof next !== "object") {
    return { stale: false, changedFields: [] };
  }
  // 没有 digest 就没有可陈旧的对象（回退链负责），不提示。
  const nextDigest = typeof next.recall_digest === "string" ? next.recall_digest : "";
  const baseDigest = typeof baseline.recall_digest === "string" ? baseline.recall_digest : "";
  if (nextDigest.length === 0) return { stale: false, changedFields: [] };
  if (nextDigest !== baseDigest) return { stale: false, changedFields: [] };

  const changedFields = [];
  for (const field of fields) {
    const before = typeof baseline[field] === "string" ? baseline[field] : "";
    const after = typeof next[field] === "string" ? next[field] : "";
    // 精确字符串比对，不做归一化：空白差异也算改写，因为 digest 的取词面
    // 正来自这些字；归一化会把「真改了」与「只改了空格」并成一类。
    if (before !== after) changedFields.push(field);
  }
  return { stale: changedFields.length > 0, changedFields };
}
