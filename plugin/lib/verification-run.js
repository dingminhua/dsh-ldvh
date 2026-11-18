
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const VERDICTS = Object.freeze(["pass", "fail", "not-checkable"]);

export const NOT_CHECKABLE_ROWS = Object.freeze({
  "派发准入": "本行当前不产生判定（§14 条件式）：36 §7.6 现不设任何准入约束，派发的准入由触发锚界定",
});

export const DEFERRED_STRICT = "no-evidence-this-run";

function strictReason(reason) {
  return `${DEFERRED_STRICT}::${reason}`;
}

export const DEFERRED_ROWS = Object.freeze({
  "上下文供给的有界性": strictReason("需在运行前记录交付材料的范围取值；痕迹只留结果，未留交付边界"),
  "逐字引证": strictReason("需在每次判断执行时核对引文确在交付材料内；运行结束时材料窗口已推进"),
  "自动动作边界": strictReason("需在每次动作执行前比对 §9／§10 闭集；痕迹无逐动作的比对记录"),
  "阈值晋升": strictReason("需在观察到同源条目时复算 pending 计数与幂等；运行结束时该组可能已被改写"),
  "摩擦观察条目的写入合法": strictReason("同上（§12bis.1 十四字段闭集与写后回读）"),
  "摩擦观察条目到期淘汰的登记": strictReason("需在淘汰发生的那一刻核对登记与查重；读时惰性结算不留现场"),
  "摩擦缓冲的准入合法性": strictReason("需在任何读写之前回读管辖状态与分区自洽；痕迹未记录该前置读取"),
  "交还的接受": strictReason("需等被下一个主控或 Human 接受；接受发生在本轮之后，本轮无从判定"),
  "运行完成": strictReason("本行是本模块自身的核对结论（自证）；它由调用方按 trace 填入，本模块不给自己判 pass"),
});

export const MECHANICAL_ROWS = Object.freeze([
  "入账三条件",
  "查重完整性",
  "同源合并",
  "销账解药成立",
  "废弃理由分类",
  "接受判据",
  "阈值晋升",
  "发起不构成执行完成",
  "主控发起的观察频次如实登记",
  "上下文供给的有界性",
  "逐字引证",
  "自动动作边界",
  "摩擦观察条目的写入合法",
  "摩擦观察条目到期淘汰的登记",
  "摩擦缓冲的准入合法性",
  "缓冲条目不可写／不可回读",
  "fail-closed 处置",
  "路径约定落实",
  "判断责任不归主控时的预检落实",
  "交还的接受",
  "运行完成",
]);

export function deriveRowId(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  s = s.replace(/\*\*/g, "");
  s = s.replace(/（[^（）]*）$/, "").replace(/\([^()]*\)$/, "");
  return s.trim();
}

export function parseVerificationRowIds(specText) {
  if (typeof specText !== "string") return [];
  const lines = specText.split("\n");
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\|\s*验证对象\s*\|/.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];
  const ids = [];
  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\|/.test(line)) break;
    const firstCell = line.split("|")[1] ?? "";
    const id = deriveRowId(firstCell);
    if (id.length > 0) ids.push(id);
  }
  return ids;
}

export function verifyRun({
  rows,
  notCheckable = NOT_CHECKABLE_ROWS,
  deferred = DEFERRED_ROWS,
  expectedMechanicalRows = MECHANICAL_ROWS,
} = {}) {
  if (!Array.isArray(rows)) {
    return {
      ok: false,
      stage: "blocked",
      rows: [],
      fail: [],
      undeclared: [],
      declared: [],
      misreported: [],
      missing: [],
      deferredRows: [],
      unknown: [],
      error: { code: "verification/invalid_rows", message: "rows must be an array of per-row verdicts" },
    };
  }

  const declaredSet = new Set(Object.keys(notCheckable ?? {}));
  const deferredSet = new Set(Object.keys(deferred ?? {}));
  const mechanicalSet = new Set(expectedMechanicalRows);
  const normalized = [];
  const fail = [];
  const undeclared = [];
  const declared = [];
  const misreported = [];
  const unknown = [];

  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const id = typeof row.id === "string" ? row.id : "";
    const verdict = typeof row.verdict === "string" ? row.verdict : "";
    if (id.length === 0) continue;
    if (!VERDICTS.includes(verdict)) {
      fail.push(id);
      normalized.push({ id, verdict: null, evidence: row.evidence ?? null, reason: "verdict is outside the closed set" });
      continue;
    }
    if (verdict === "fail") fail.push(id);
    if (verdict === "not-checkable") {
      if (declaredSet.has(id)) declared.push(id);
      else if (deferredSet.has(id)) declared.push(id);
      else undeclared.push(id);
    }
    if (!declaredSet.has(id) && !deferredSet.has(id) && !mechanicalSet.has(id)) {
      unknown.push(id);
      fail.push(id);
      normalized.push({ id, verdict, evidence: row.evidence ?? null, reason: "this row id is not declared in the module's §18 row set; a new spec row must be synced into the module, not silently reported" });
      continue;
    }
    const isStrictDeferred = deferredSet.has(id) && String(deferred?.[id] ?? "").startsWith(DEFERRED_STRICT);
    if (verdict === "pass" && (declaredSet.has(id) || isStrictDeferred)) {
      misreported.push(id);
      fail.push(id);
    }
    normalized.push({
      id,
      verdict,
      evidence: typeof row.evidence === "string" ? row.evidence : (row.evidence ?? null),
      ...(verdict === "pass" && (declaredSet.has(id) || isStrictDeferred)
        ? { reason: "this row is declared unverifiable for this run (no verdict is producible); reporting it as pass would record an unchecked row as verified" }
        : {}),
    });
  }

  const reportedIds = new Set(normalized.map((r) => r.id));
  const expectedIds = [...new Set([...expectedMechanicalRows, ...declaredSet, ...deferredSet])];
  const missing = expectedIds.filter((id) => !reportedIds.has(id));
  for (const id of missing) {
    fail.push(id);
    normalized.push({
      id,
      verdict: "fail",
      evidence: null,
      reason: "no verdict was reported for this mechanically-checkable row; absence is not evidence of passing",
    });
  }

  const deferredRows = normalized.filter((r) => r.verdict === "not-checkable" && deferredSet.has(r.id)).map((r) => r.id);

  const ok = fail.length === 0 && undeclared.length === 0;
  return {
    ok,
    stage: ok ? "landed" : "blocked",
    rows: normalized,
    fail,
    undeclared,
    declared,
    misreported,
    missing,
    deferredRows,
    unknown,
  };
}

export async function readVerificationRowIds(projectPath) {
  try {
    const p = join(projectPath, "specs", "36-摩擦销账系统规范.md");
    const text = await readFile(p, "utf8");
    const ids = parseVerificationRowIds(text);
    if (ids.length === 0) {
      return { ok: false, error: { code: "verification/section_not_found", message: `§14 table not found in ${p}` } };
    }
    return { ok: true, value: { ids } };
  } catch (error) {
    return { ok: false, error: { code: "verification/spec_unreadable", message: String(error?.message ?? error) } };
  }
}

export function declaredVerificationIds() {
  return [...MECHANICAL_ROWS, ...Object.keys(NOT_CHECKABLE_ROWS)];
}
