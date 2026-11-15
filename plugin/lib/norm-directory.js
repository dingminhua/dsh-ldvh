// dsh-ldvh — 事实规范目录（引导层承载）
//
// Authority: specs/27 §10（Norm 的常驻可见性与查阅时机）、specs/34 §8.4
// （常驻枚举的承载位置）、specs/10 §5.3（引导面与其体量口径）。
//
// ## 为什么目录搬到引导层（2026-11-15，Human 决定）
//
// 目录原先在**召回注入块**里，与候选区同处一段注入文本、共用召回预算，并由
// 候选区的通用免责声明描述（「命中不等于适用」「常驻列出者同样不证明适用」）。
// 那套措辞对**词法候选**是诚实的纪律，对**按类型枚举**的目录却是误述——目录
// 不是候选，它不需要被"判适用"才成立。于是每回合在场的目录被读成"列着但未必
// 适用"，AI 看不到「凡查阅时机成立即须读全文」这条义务（这正是称呼那例漏写的
// 直接机制之一，见 friction-eca188ce）。
//
// 引导层是**宿主框架层**（system-prompt/assemble），每回合组装、不受召回预算
// 约束、措辞由本插件自己负责，故目录搬到这里：位置更显著、措辞更准确、召回
// 预算回到候选区。
//
// ## 单一来源
//
// 「哪些规范 active、什么次序、定位两句是什么」**全部仍由既有枚举权威产出**
// （`source-recall.js` 的 `l0EnumerationOf` → Norm 段的 entries/excerpts），
// 本模块只换承载位置、**不做第二份枚举**、不改判定来源。
//
// ## 体量与降级
//
// 引导层有硬预算（`guidance-budget.js` 的 `GUIDANCE_CHAR_BUDGET`），超限是
// `ok:false` 必停——不是警告。故目录按**剩余额度**装填：放不下的规范**不静默
// 丢弃**，而是截断并披露条数与全量入口。

import { createHash } from "node:crypto";
import { join } from "node:path";

import { l0EnumerationOf, loadFacts } from "./source-recall.js";

/** 引导层里承载目录的段名（渲染层据此识别，不依赖文本匹配）。 */
export const NORM_DIRECTORY_SECTION_NAME = "事实规范目录";

/**
 * 目录行的**体量上限**（字符）。
 *
 * 目录行是**独立的一行注入**（不进召回块、不占召回预算、不在系统提示段内），
 * 它的体量因此不随引导层预算走，须自带上限：超限则**截断并披露**（不得静默丢
 * 规范），也不得撑爆对话。取值与引导层体量常量同量级（`guidance-budget.js` 的
 * `GUIDANCE_CHAR_BUDGET.governed` 为 4096），但**两者互不占用**。
 */
export const NORM_DIRECTORY_BUDGET_CHARS = 4096;

/**
 * 目录内容的内容指纹（用于「内容版本」判定：同版本不重复注入、内容变了刷新旧行）。
 *
 * @param {string} text 目录文本
 * @returns {string} 32 位十六进制摘要
 */
export function normDirectoryDigest(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex").slice(0, 32);
}

/** 目录段头。 */
const DIRECTORY_HEADER = "【事实规范目录 · active Norm（27 §10）】";

/** 定位不可机械导出时的占位行（fail-closed：不静默省略该份规范）。 */
const UNAVAILABLE_LINE = "  ↳ （定位不可机械导出：正文不合 27 §8 两句契约；用 ldvh_norm_read 读正文。）";

/** 目录尾注：查阅时机成立即须读全文；目录不证明适用；全量入口。 */
const DIRECTORY_FOOTER_ALL = "（凡「何时查阅」时机成立即须读全文；目录不证明适用；全量用 ldvh_norm_list。）";

/**
 * 目录尾注（截断时）：说明有多少份没列出、去哪儿取全量。
 *
 * @param {number} omittedCount 未列出的规范份数
 * @returns {string}
 */
function directoryFooter(omittedCount) {
  if (omittedCount <= 0) return DIRECTORY_FOOTER_ALL;
  return `（另有 ${omittedCount} 条规范未列出：全量用 ldvh_norm_list。凡「何时查阅」时机成立即须读全文；目录不证明适用。）`;
}

/**
 * 由事实语料构造引导层的规范目录文本。
 *
 * @param {object[]} facts 已载入的事实语料（`loadFacts` 的产物）
 * @param {{budgetChars?: number}} [options] 剩余字符额度（含段头与尾注）
 * @returns {{text: string, shown: number, total: number, truncated: boolean, unavailable: number}}
 *   `text` 为空串表示无可列内容（无语料／无 active Norm／额度不足）。
 */
export function buildNormDirectory(facts, { budgetChars = 0 } = {}) {
  const limit = Number.isInteger(budgetChars) && budgetChars > 0 ? budgetChars : 0;
  if (limit <= 0) return { text: "", shown: 0, total: 0, truncated: false, unavailable: 0 };

  const enumeration = l0EnumerationOf(facts);
  const segment = enumeration.find((entry) => entry.type === "norm");
  const entries = Array.isArray(segment?.entries) ? segment.entries : [];
  const excerpts = Array.isArray(segment?.excerpts) ? segment.excerpts : [];
  const total = entries.length;
  if (total === 0) return { text: "", shown: 0, total: 0, truncated: false, unavailable: 0 };

  // 每份规范两行：标题行（带 direction_key）＋定位行。定位不可导出时用占位行
  // 显式标注——**不静默省略**（27 §8 的 fail-closed 纪律在目录层同样成立）。
  const blocks = entries.map((entry, index) => {
    const excerpt = excerpts[index];
    const excerptLine = typeof excerpt === "string" && excerpt !== "" ? excerpt : UNAVAILABLE_LINE;
    return { entry, excerptLine };
  });
  const unavailable = blocks.filter((block) => block.excerptLine === UNAVAILABLE_LINE).length;

  // 装填：标题行与定位行**成对**进退（不得出现「有标题无定位」的半截），
  // 确定性次序沿用枚举权威的标题码点序。
  const headerCost = DIRECTORY_HEADER.length + 1;
  const kept = [];
  let used = headerCost;
  let omitted = total;
  for (const block of blocks) {
    const cost = block.entry.length + 1 + block.excerptLine.length + 1;
    // 尾注按最坏情况（全部未列出）预留，故装填时按该尾注长度扣额。
    const footerReserve = directoryFooter(total - kept.length - 1).length + 1;
    if (used + cost + footerReserve > limit) break;
    kept.push(block);
    used += cost;
    omitted = total - kept.length;
  }

  if (kept.length === 0) return { text: "", shown: 0, total, truncated: omitted > 0, unavailable };

  const footer = directoryFooter(omitted);
  const lines = [DIRECTORY_HEADER];
  for (const block of kept) lines.push(block.entry, block.excerptLine);
  lines.push(footer);
  const text = lines.join("\n");
  return {
    text,
    shown: kept.length,
    total,
    truncated: omitted > 0,
    unavailable,
  };
}

/**
 * 按引导层剩余额度构造目录（供引导层组装时调用）。
 *
 * @param {{root: string, budgetChars: number}} input
 * @returns {Promise<{text: string, shown: number, total: number, truncated: boolean, unavailable: number}>}
 */
export async function buildNormDirectoryForRoot({ root, budgetChars = 0 } = {}) {
  if (typeof root !== "string" || root === "" || budgetChars <= 0) {
    return { text: "", shown: 0, total: 0, truncated: false, unavailable: 0 };
  }
  let facts = [];
  try {
    facts = await loadFacts(join(root, "ldvh-base"));
  } catch {
    // 事实源读不到 ⇒ 无目录可列（不注入半截、不报错、不静默说成「没有规范」——
    // 目录缺席只是目录缺席，事实源是否可读由召回侧另行披露）。
    facts = [];
  }
  return buildNormDirectory(facts, { budgetChars });
}
