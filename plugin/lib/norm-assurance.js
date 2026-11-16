// dsh-ldvh — 强制面/保证面声明的解析与可解析性核对
//
// Authority: specs/27 §6.1（2026-11-16 收紧判据；「保证面」类别待 Human 决定 R2
// 落盘——解析层先行支持两种前缀，规范措辞随后对齐）。
//
// ## 声明的固定形态（逐行匹配，行首允许空白）
//
//   强制面：<kind>:<name>
//   保证面：<kind>:<name>
//   无机械强制面（核对：<由谁核对>）
//
// kind 闭集：`gate`／`writer`／`pre-injector`（`test` **不在**闭集——发布包不含
// plugin/test/、用例名非稳定 ID，审查 MAJOR-11）。name 按**第一个冒号**切分
// （审查 MINOR-21）。
//
// ## 可解析性（审查 BLOCKER-2 的回应：声明 ≠ 已落地）
//
// - `gate:<name>` ⇒ name ∈ `commit-validation.js` 导出的 `GATE_RULES` 键集；
// - `writer:<name>` ⇒ name ∈ 各 writer 拒绝码的冻结登记（`assurance-registry.js`）；
// - `pre-injector:<name>` ⇒ name ∈ 保证面登记（当前仅 `greeting-prefix`）。
// 解析不到 ⇒ 该声明记为 **invalid**（假声明）。**处置只披露、不阻断**（与 27
// §13.1/§14 现行措辞一致；「假声明拒绝」属新增可强制执行规则，待 Human 根决定 R1）。
//
// ## 规则单元不可判定（审查 MAJOR-10 的回应）
//
// 5 份存量 Norm 的《核心规则体系》结构不统一（H3／编号 runbook／分类标题），
// 「哪一段是一条可强制执行规则」**没有机械约定**。故本模块**不计算「未声明规则
// 数」**——那会把 0 条误读成「全部满足」。摘要只报：声明条数、invalid 条数、
// 是否至少一条、以及「规则单元不可机械判定」这一如实披露。

import { GATE_RULES } from "./commit-validation.js";
import { WRITER_REJECTION_CODES, GUARANTEE_SURFACE_IDS } from "./assurance-registry.js";

const DECLARATION_PATTERN = /^[ \t]*(强制面|保证面)：([a-z-]+):(.+?)\s*$/;
const NONE_PATTERN = /^[ \t]*无机械强制面（核对：(.+?)）\s*$/;

const KIND_SOURCES = Object.freeze({
  gate: () => Object.keys(GATE_RULES),
  writer: () => [...WRITER_REJECTION_CODES],
  "pre-injector": () => [...GUARANTEE_SURFACE_IDS],
});

/**
 * 解析正文中的全部声明行。
 *
 * @param {string} body 载体正文（不含 frontmatter）
 * @returns {{declarations: object[], noneMarks: object[], invalid: object[], hasAtLeastOne: boolean, ruleUnitsDecidable: false}}
 */
export function parseAssuranceDeclarations(body) {
  const lines = String(body ?? "").split("\n");
  const declarations = [];
  const noneMarks = [];
  const invalid = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const none = line.match(NONE_PATTERN);
    if (none !== null) {
      noneMarks.push({ line: i + 1, checker: none[1] });
      continue;
    }
    const decl = line.match(DECLARATION_PATTERN);
    if (decl === null) continue;
    const [, tier, kind, name] = decl;
    const source = KIND_SOURCES[kind];
    const resolvable = source !== undefined && source().includes(name);
    const entry = { line: i + 1, tier, kind, name, resolvable };
    declarations.push(entry);
    if (source === undefined || !resolvable) {
      invalid.push({ ...entry, reason: source === undefined ? `kind 不在闭集：${kind}` : `name 解析不到：${kind}:${name}` });
    }
  }
  return {
    declarations,
    noneMarks,
    invalid,
    hasAtLeastOne: declarations.length > 0,
    // 如实披露：规则单元无机械约定，本模块不推断「未声明规则数」。
    ruleUnitsDecidable: false,
  };
}

/**
 * 写入结果回带的 assurance 摘要（27 §14「只披露未满足项」）。
 *
 * @param {string} body
 * @returns {object}
 */
export function assuranceSummaryOf(body) {
  const parsed = parseAssuranceDeclarations(body);
  return {
    declared: parsed.declarations.length,
    invalid: parsed.invalid.map((entry) => ({ line: entry.line, face: `${entry.tier}:${entry.kind}:${entry.name}`, reason: entry.reason })),
    noneMarks: parsed.noneMarks.length,
    hasAtLeastOne: parsed.hasAtLeastOne,
    ruleUnitsDecidable: parsed.ruleUnitsDecidable,
    note: "规则单元不可机械判定（存量结构不统一）；本摘要只披露，不阻断（27 §13.1/§14）。",
  };
}
