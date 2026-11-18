
import { GATE_RULES } from "./commit-validation.js";
import { WRITER_REJECTION_CODES, GUARANTEE_SURFACE_IDS } from "./assurance-registry.js";

const DECLARATION_PATTERN = /^[ \t]*(强制面|保证面)：([a-z-]+):(.+?)\s*$/;
const NONE_PATTERN = /^[ \t]*无机械强制面（核对：(.+?)）\s*$/;

const KIND_SOURCES = Object.freeze({
  gate: () => Object.keys(GATE_RULES),
  writer: () => [...WRITER_REJECTION_CODES],
  "pre-injector": () => [...GUARANTEE_SURFACE_IDS],
});

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
    ruleUnitsDecidable: false,
  };
}

export function assuranceSummaryOf(body) {
  const parsed = parseAssuranceDeclarations(body);
  return {
    declared: parsed.declarations.length,
    invalid: parsed.invalid.map((entry) => ({ line: entry.line, face: `${entry.tier}:${entry.kind}:${entry.name}`, reason: entry.reason })),
    noneMarks: parsed.noneMarks.length,
    hasAtLeastOne: parsed.hasAtLeastOne,
    ruleUnitsDecidable: parsed.ruleUnitsDecidable,
    note: "规则单元不可机械判定（存量结构不统一）；本摘要只披露，不阻断（23 §13.1/§14）。",
  };
}
