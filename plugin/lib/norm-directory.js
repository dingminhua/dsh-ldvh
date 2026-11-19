
import { createHash } from "node:crypto";
import { join } from "node:path";

import { l0EnumerationOf, loadFacts } from "./source-recall.js";

export const NORM_DIRECTORY_SECTION_NAME = "事实规范目录";

export const NORM_DIRECTORY_BUDGET_CHARS = 4096;

export function normDirectoryDigest(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex").slice(0, 32);
}

const DIRECTORY_HEADER = "【事实规范目录 · active Norm（23 §10）】";

const UNAVAILABLE_LINE = "  ↳ （定位不可机械导出：正文不合 23 §8 两句契约；用 ldvh_norm_read 读正文。）";

const DIRECTORY_FOOTER_ALL = "（凡「何时查阅」时机成立即须读全文；目录不证明适用；全量用 ldvh_norm_list。）";

function directoryFooter(omittedCount) {
  if (omittedCount <= 0) return DIRECTORY_FOOTER_ALL;
  return `（另有 ${omittedCount} 条规范未列出：全量用 ldvh_norm_list。凡「何时查阅」时机成立即须读全文；目录不证明适用。）`;
}

export function buildNormDirectory(facts, { budgetChars = 0 } = {}) {
  const limit = Number.isInteger(budgetChars) && budgetChars > 0 ? budgetChars : 0;
  if (limit <= 0) return { text: "", shown: 0, total: 0, truncated: false, unavailable: 0 };

  const enumeration = l0EnumerationOf(facts);
  const segment = enumeration.find((entry) => entry.type === "norm");
  const entries = Array.isArray(segment?.entries) ? segment.entries : [];
  const excerpts = Array.isArray(segment?.excerpts) ? segment.excerpts : [];
  const total = entries.length;
  if (total === 0) return { text: "", shown: 0, total: 0, truncated: false, unavailable: 0 };

  const blocks = entries.map((entry, index) => {
    const excerpt = excerpts[index];
    const excerptLine = typeof excerpt === "string" && excerpt !== "" ? excerpt : UNAVAILABLE_LINE;
    return { entry, excerptLine };
  });
  const unavailable = blocks.filter((block) => block.excerptLine === UNAVAILABLE_LINE).length;

  const headerCost = DIRECTORY_HEADER.length + 1;
  const kept = [];
  let used = headerCost;
  let omitted = total;
  for (const block of blocks) {
    const cost = block.entry.length + 1 + block.excerptLine.length + 1;
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

export async function buildNormDirectoryForRoot({ root, budgetChars = 0 } = {}) {
  if (typeof root !== "string" || root === "" || budgetChars <= 0) {
    return { text: "", shown: 0, total: 0, truncated: false, unavailable: 0 };
  }
  let facts = [];
  try {
    facts = await loadFacts(join(root, "ldvh-base"));
  } catch {
    facts = [];
  }
  return buildNormDirectory(facts, { budgetChars });
}
