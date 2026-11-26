
import { createHash } from "node:crypto";

export function cleanGitEnvironment(extra = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of Object.keys(env)) {
    if (["GIT_COMMON_DIR", "GIT_CONFIG_COUNT", "GIT_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_WORK_TREE"].includes(key) || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key];
  }
  const quotepath = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.quotepath", GIT_CONFIG_VALUE_0: "false" };
  return { ...env, ...quotepath, ...extra };
}

export const HEADER_PATTERN = /^(feat|fix|docs|refactor|test|chore|build|ci|perf|style)(?:\([a-z0-9-]+\))?: .+/;
export const HEADER_DESCRIPTION_PATTERN = /^(?:feat|fix|docs|refactor|test|chore|build|ci|perf|style)(?:\([a-z0-9-]+\))?: (.+)$/;
export const CJK_CHARACTER_PATTERN = /[\u4e00-\u9fff]/;
export const HEADER_LANGUAGE_EXEMPTIONS = Object.freeze([
	"fix(injection): stop re-injecting the governance block on adjacent turns",
	"fix(client): ctx.get→ctx.inject for betterSidebar tab registration",
]);
export const SIGNATURES = ["LDVH-Provider", "LDVH-Model"];

export const ROUTE_SOURCE_RULE = "the authoritative route is the LAST routing event (model/selection or request/context) in the session log — a mid-session model switch makes the later event win, so values read from the top of the log are stale";

export const SOURCE_FINGERPRINT = createHash("sha256").update("dsh-ldvh-git-gate-v1", "utf8").digest("hex");

export const GATE_RULES = Object.freeze({
  "validation/header_invalid": Object.freeze({ severity: "blocking", description: "first line must be a conventional commit header" }),
  "validation/header_not_chinese": Object.freeze({ severity: "blocking", description: "header description must use Chinese: 09 §5.1 states the message contract in Chinese and requires the 关键变更: literal verbatim, so the description half carries the same language requirement (implementation gap 2026-10-19; two pre-existing Latin headers are registered as exemptions in HEADER_LANGUAGE_EXEMPTIONS)" }),
  "validation/key_changes_required": Object.freeze({ severity: "blocking", description: "body must contain exactly one 关键变更: section with non-empty items" }),
  "validation/signature_trailer_missing": Object.freeze({ severity: "blocking", description: "footer requires exactly one LDVH-Provider: and one LDVH-Model: line" }),
  "validation/key_change_unmatched": Object.freeze({ severity: "blocking", description: "a 关键变更 item names no staged change (09 §5.1: no items absent from the diff)" }),
  "validation/staged_path_uncovered": Object.freeze({ severity: "blocking", description: "a staged diff path is covered by no 关键变更 item (09 §5.1: no diff change may be omitted; K1 bidirectional, Human 2026-09-10)" }),
  "validation/signature_provider_mismatch": Object.freeze({ severity: "blocking", description: "trailer LDVH-Provider does not match the authoritative session record" }),
  "validation/signature_model_mismatch": Object.freeze({ severity: "blocking", description: "trailer LDVH-Model does not match the authoritative session record" }),
  "validation/signature_source_unverifiable": Object.freeze({ severity: "blocking", description: "the authoritative route could not be resolved inside the commit-msg Hook, so the trailers' traceability cannot be verified — 09 §5.5 非 passed 即阻断; rule established by the 09 §8.1 item 2 decision (Human 2026-11-05)" }),
  "git/index_empty": Object.freeze({ severity: "blocking", description: "candidate Index is empty" }),
  "facts/norm_direction_collision": Object.freeze({ severity: "blocking", description: "two or more ACTIVE Norm objects in ldvh-base/norms/ share one direction_key (23 §11 uniqueness second layer: the Git Gate traverses the index and refuses the commit)" }),
  "facts/norm_carrier_unparseable": Object.freeze({ severity: "blocking", description: "a staged ldvh-base/norms/norm-*.md carrier cannot be parsed for the direction_key uniqueness assertion — an unreadable carrier cannot be proven conflict-free, so the gate fails closed rather than passing it" }),
  "validation/docs_reference_dangling": Object.freeze({ severity: "blocking", description: "a newly added or modified non-docs carrier references a docs/ path that does not exist in the candidate tree (09 §5.3 item 5, Human 2026-10-12: docs/ holds temporary documents only and must not be relied on as an authority)" }),
  "git/friction_commit_unresolvable": Object.freeze({ severity: "blocking", description: "a staged friction carrier's informs target names a commit that does not resolve in this repository (26 §11: 目标必须存在且可解析; commit 例外形态同口径) — re-asserted at the commit seam because the writer is bypassable by a direct file write" }),
  "git/friction_commit_malformed": Object.freeze({ severity: "blocking", description: "a staged friction carrier's informs target is not a 40-hex commit hash (02 §8.1 commit 形态)" }),
  "git/friction_commit_unverifiable": Object.freeze({ severity: "blocking", description: "friction commit targets could not be verified because no commit resolver was supplied — fails closed rather than passing an unverified carrier (26 §11)" }),
  "validation/lint_failed": Object.freeze({ severity: "blocking", description: "the pre-commit Hook's lint step refused: either eslint reported findings, or eslint could not run at all (missing binary, broken configuration). 06 §5 requires 提交前必须通过静态分析 and 09 §5.3 puts the check at the commit seam; both cases refuse rather than pass, and the message distinguishes them because the repair differs" }),
  "facts/carrier_uid_filename_mismatch": Object.freeze({ severity: "blocking", description: "a staged ldvh-base carrier's filename encodes one identity while its own `object_uid:` declaration states another (02 §7.1: the declaration is the identity authority; 02 §5 item 6 forbids silently consuming one of two disagreeing claims). 09 §8.1 item 2 领域增量，Human 批准 2026-11-04" }),
  "facts/carrier_uid_duplicate": Object.freeze({ severity: "blocking", description: "two or more staged ldvh-base carriers declare the same `object_uid` (02 §5 item 6: 载体重复/身份冲突时不得静默选择一份继续消费或写入). 09 §8.1 item 2 领域增量，Human 批准 2026-11-04" }),
  "facts/carrier_uid_unverifiable": Object.freeze({ severity: "blocking", description: "a staged ldvh-base carrier could not be read or its frontmatter could not be parsed, so its identity declaration cannot be checked — fails closed rather than passing an unverified carrier (02 §5 item 6)" }),
});

export const EXEMPT_BASENAMES = Object.freeze(["package-lock.json", "pnpm-lock.yaml"]);

export function isExemptPath(path) {
  const base = path.split("/").pop() ?? path;
  return EXEMPT_BASENAMES.includes(base);
}

export function isHeaderDescriptionNonChinese(header) {
	const match = HEADER_DESCRIPTION_PATTERN.exec(header ?? "");
	if (match === null) return false;
	if (HEADER_LANGUAGE_EXEMPTIONS.includes(header)) return false;
	return !CJK_CHARACTER_PATTERN.test(match[1]);
}

export function newFinding(rule, message, line = null) {
  const entry = GATE_RULES[rule];
  if (entry === undefined) throw new Error(`unregistered gate rule: ${rule}`);
  return { rule, severity: entry.severity, message, line };
}

export function validateMessage(message) {
  const issues = [];
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  if (!HEADER_PATTERN.test(lines[0] ?? "")) issues.push(newFinding("validation/header_invalid", "first line must be a conventional commit header", 1));
  if (isHeaderDescriptionNonChinese(lines[0])) issues.push(newFinding("validation/header_not_chinese", "header description must contain at least one Chinese (CJK) character", 1));
  const keyIndexes = lines.flatMap((line, index) => (line === "关键变更:" ? [index] : []));
  if (keyIndexes.length !== 1 || !lines.slice(keyIndexes[0] + 1).some((line) => line.startsWith("- ") && line.slice(2).trim().length > 0)) {
    issues.push(newFinding("validation/key_changes_required", "body must contain one 关键变更: section with a non-empty - item", keyIndexes.length === 1 ? keyIndexes[0] + 1 : null));
  }
  for (const name of SIGNATURES) {
    const matches = lines.filter((line) => line.startsWith(`${name}:`) && line.slice(name.length + 1).trim().length > 0);
    if (matches.length !== 1) {
      const hint = name === "LDVH-Provider"
        ? "the expected value is the provider of the authoritative route — read it with ldvh_session_signature rather than guessing"
        : "the expected value is the model of the authoritative route — read it with ldvh_session_signature rather than guessing";
      issues.push(newFinding("validation/signature_trailer_missing", `footer requires exactly one ${name}: (${hint}; rule: ${ROUTE_SOURCE_RULE})`, null));
    }
  }
  return issues;
}

export function snapshotIdentity(diff, message) {
  const normalized = message.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return createHash("sha256").update(diff, "utf8").update("\0").update(normalized, "utf8").digest("hex");
}

function routeProvenance(route) {
  const value = route?.value ?? {};
  const parts = [];
  if (typeof value.eventType === "string" && value.eventType.length > 0) parts.push(`event type ${value.eventType}`);
  if (Number.isInteger(value.seq)) parts.push(`seq ${value.seq}`);
  return parts.length > 0 ? ` (taken from ${parts.join(", ")})` : "";
}

export function checkSignatureAgainstRoute(message, route) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const providerLine = lines.find((line) => line.startsWith("LDVH-Provider:"));
  const modelLine = lines.find((line) => line.startsWith("LDVH-Model:"));
  if (!route.ok) return { ok: false, hardFail: false, issues: [] };
  const issues = [];
  const provenance = routeProvenance(route);
  if (providerLine !== undefined && providerLine.slice("LDVH-Provider:".length).trim() !== route.value.provider) {
    issues.push(newFinding("validation/signature_provider_mismatch", `trailer LDVH-Provider does not match the authoritative session record (${route.value.provider})${provenance}; rule: ${ROUTE_SOURCE_RULE}`));
  }
  if (modelLine !== undefined && modelLine.slice("LDVH-Model:".length).trim() !== route.value.model) {
    issues.push(newFinding("validation/signature_model_mismatch", `trailer LDVH-Model does not match the authoritative session record (${route.value.model})${provenance}; rule: ${ROUTE_SOURCE_RULE}`));
  }
  return { ok: issues.length === 0, hardFail: issues.length > 0, issues };
}

export function isGovernedCommitPath(path) {
  return path.startsWith("ldvh-base/") || path.startsWith("specs/") || path.startsWith("plugin-specs/");
}

export function touchesGovernedContent(paths) {
  return Array.isArray(paths) && paths.some((path) => isGovernedCommitPath(path));
}

export function checkKeyChangesAgainstDiff(message, diff) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const keyIndex = lines.findIndex((line) => line === "关键变更:");
  if (keyIndex === -1) return { ok: false, issues: [newFinding("validation/key_changes_required", "no 关键变更: section", null)] };
  const items = [];
  for (const [offset, line] of lines.slice(keyIndex + 1).entries()) {
    if (line === "关键变更:") { items.length = 0; break; }
    if (line.startsWith("- ")) {
      const text = line.slice(2).trim();
      if (text.length > 0) items.push({ text, line: keyIndex + 1 + offset });
    }
  }
  if (items.length === 0) return { ok: false, issues: [newFinding("validation/key_changes_required", "关键变更: has no non-empty item", keyIndex + 1)] };
  const changedPaths = extractDiffPaths(diff);
  const unmatched = [];
  for (const item of items) {
    if (!changedPaths.some((path) => itemMatchesPath(item.text, path))) unmatched.push(item);
  }
  const uncovered = changedPaths.filter((path) => !isExemptPath(path) && !items.some((item) => itemMatchesPath(item.text, path)));
  if (unmatched.length > 0 || uncovered.length > 0) {
    const issues = [];
    for (const item of unmatched) {
      const nearest = changedPaths.length > 0 ? ` 已改路径：${changedPaths.map((p) => `"${p}"`).join("、")}` : " 本次提交没有任何已改路径";
      issues.push(newFinding("validation/key_change_unmatched", `关键变更 item "${item.text}" 未命中任何已改路径（该方向要求：item 须点名它对应的改动，匹配依据是**文件路径**——完整路径、文件名、去扩展名的词干（≥3 字符）、**编号载体前缀**（如 \`specs/08\`）或**不少于两级的目录前缀**（如 \`plugin/lib\`），任一按路径边界出现在 item 文本中即算命中；单个目录词不算（它会覆盖该目录下的全部改动），\`plugin/library\`、\`plugin/lib-old\` 这类粘连写法也不算）。${nearest}`, item.line));
    }
    for (const path of uncovered) {
      issues.push(newFinding("validation/staged_path_uncovered", `已改路径 "${path}" 没有任何 关键变更 item 覆盖它（该方向要求：每个非豁免的已暂存改动都须在 关键变更 中被点名，否则等于漏报改动）。补一条点名 "${path}" 的 item 即可。只写它所在的单个目录名不算覆盖（会被判为漏报）；可用写法：完整路径、文件名、\`specs/08\` 这类编号载体前缀，或不少于两级的目录前缀（该路径只有一级目录时，写完整路径或文件名）。`, null));
    }
    if (unmatched.length > 0 && uncovered.length > 0) {
      issues.push(newFinding("validation/key_changes_required", `关键变更 与已暂存改动是**双向一一对应**关系（09 §5.1 K1）：每个 item 须命中一个已改路径，每个已改路径须被一个 item 命中。本次同时有 ${unmatched.length} 个 item 无对应改动、${uncovered.length} 个改动无对应 item——请一并修正后再提交，不必逐轮试探。`, null));
    }
    return { ok: false, issues };
  }
  return { ok: true, changedPaths };
}

export function extractDiffPaths(diff) {
  const paths = new Set();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match === null) continue;
    paths.add(match[1]);
    paths.add(match[2]);
  }
  return [...paths];
}

function itemMatchesPath(item, path) {
  if (item.includes(path)) return true;
  const base = path.split("/").pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, "");
  if (item.includes(base)) return true;
  if (stem.length > 2 && item.includes(stem)) return true;
  const dir = path.slice(0, path.length - base.length);
  const numbered = /^(\d{2})-[^/]*$/.exec(base);
  if (numbered !== null && dir.length > 0 && hasBoundedSubstring(item, `${dir}${numbered[1]}`)) return true;
  const parts = path.split("/");
  for (let depth = parts.length - 1; depth >= 2; depth -= 1) {
    if (hasBoundedSubstring(item, parts.slice(0, depth).join("/"))) return true;
  }
  return false;
}

function hasBoundedSubstring(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_.-])`).test(haystack);
}
const _FLAGS = "gu";
const _SOURCE = String.raw`(?:^|[^A-Za-z0-9._/-])(docs\/[\p{L}\p{N}\p{M}._/-]*[A-Za-z0-9_-])`;
export const DOCS_REFERENCE_PATTERN = new RegExp(_SOURCE, _FLAGS);

export function isTemporaryDocsPath(path) {
  return path === "docs" || path.startsWith("docs/");
}

export function isSpecOrFactCarrierPath(path) {
  if (path === "README.md") return true;
  if (path === "plugin/README.md") return true;
  return path.startsWith("plugin-specs/") || path.startsWith("ldvh-base/");
}

export function extractDocsReferences(text) {
  const found = new Set();
  for (const match of text.matchAll(DOCS_REFERENCE_PATTERN)) {
    const ref = match[1].replace(/[.,;:]+$/, "");
    if (ref.length > "docs/".length) found.add(ref);
  }
  return [...found];
}

export function stripChangeLogFromFrontmatter(text) {
  if (typeof text !== "string") return text;
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return text;
  const lines = m[1].split(/\r?\n/);
  const kept = [];
  let skipping = false;
  let touched = false;
  for (const line of lines) {
    if (!skipping) {
      if (/^change_log\s*:/.test(line)) {
        skipping = true;
        touched = true;
        continue;
      }
      kept.push(line);
      continue;
    }

    if (line.trim() === "" || /^[ \t]/.test(line)) continue;
    skipping = false;
    kept.push(line);
  }
  if (!touched) return text;
  return text.replace(m[0], `---\n${kept.join("\n")}\n---`);
}

function isQuotedTruncationArtifact(ref, text, exists) {
  if (typeof ref !== "string" || ref.length <= "docs/".length) return false;
  if (typeof exists !== "function") return false;
  const all = extractDocsReferences(text);
  return all.some(
    (other) =>
      other !== ref &&
      other.length > ref.length &&
      other.startsWith(ref) &&
      exists(other)
  );
}

export function checkDocsReferences(carriers, { exists } = {}) {
  const issues = [];
  const resolveExists = typeof exists === "function" ? exists : () => false;
  for (const carrier of carriers) {
    if (!isSpecOrFactCarrierPath(carrier.path)) continue;
    if (typeof carrier.content !== "string" || carrier.content.length === 0) continue;
    if (carrier.baseline === null) {
      issues.push(newFinding(
        "validation/docs_reference_dangling",
        `${carrier.path}: baseline could not be read for a renamed/copied carrier, so "no NEW docs/ reference" cannot be decided (09 §5.3 item 5 fails closed)`,
        null
      ));
      continue;
    }

    const scannable = stripChangeLogFromFrontmatter(carrier.content);
    const baselineScannable = typeof carrier.baseline === "string"
      ? stripChangeLogFromFrontmatter(carrier.baseline)
      : carrier.baseline;
    const preexisting = new Set(
      typeof baselineScannable === "string" ? extractDocsReferences(baselineScannable) : []
    );
    for (const ref of extractDocsReferences(scannable)) {
      if (preexisting.has(ref)) continue;
      if (resolveExists(ref)) continue;
      if (isQuotedTruncationArtifact(ref, scannable, resolveExists)) continue;
      issues.push(newFinding(
        "validation/docs_reference_dangling",
        `${carrier.path} references "${ref}", which does not exist in the candidate tree (09 §5.3 item 5: docs/ is temporary-only and must not be relied on; remove the reference or re-home the content as a fact object)`,
        null
      ));
    }
  }
  return { ok: issues.length === 0, issues };
}

export const NORM_FACT_DIRECTORY = "ldvh-base/norms";

export function checkNormDirectionUniqueness(carriers) {
  const issues = [];
  const active = [];
  for (const carrier of carriers) {
    const parsed = parseNormCarrierFrontmatter(carrier.content);
    if (!parsed.ok) {
      issues.push(newFinding("facts/norm_carrier_unparseable", `${carrier.path}: ${parsed.reason} — cannot prove this carrier conflict-free (23 §11 second layer fails closed)`, null));
      continue;
    }
    const { status, direction_key: directionKey } = parsed.frontmatter;
    if (status === "active" && typeof directionKey === "string" && directionKey.length > 0) {
      active.push({ path: carrier.path, direction_key: directionKey });
    }
  }

  const byDirection = new Map();
  for (const entry of active) {
    const list = byDirection.get(entry.direction_key) ?? [];
    list.push(entry);
    byDirection.set(entry.direction_key, list);
  }
  for (const [directionKey, group] of byDirection) {
    if (group.length > 1) {
      issues.push(newFinding(
        "facts/norm_direction_collision",
        `${group.length} active Norm objects share direction_key "${directionKey}" (23 §11: Count(direction_key=d ∧ status=active) ≤ 1) — ${group.map((g) => g.path).join(", ")}; retire all but one before committing`,
        null
      ));
    }
  }
  return { ok: issues.length === 0, issues };
}

function parseNormCarrierFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, reason: "missing YAML frontmatter fence" };
  const frontmatter = {};
  for (const line of match[1].replace(/\r\n/g, "\n").split("\n")) {
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (field === null) continue;
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[field[1]] = value;
  }
  return { ok: true, frontmatter };
}

export function isNormCarrierPath(path) {
  return path.startsWith(`${NORM_FACT_DIRECTORY}/`) && /\/norm-[^/]+\.md$/.test(path);
}

const FRICTION_FACT_DIRECTORY = "ldvh-base/frictions";
const COMMIT_HASH_PATTERN = /^[0-9a-f]{40}$/i;

export function isFrictionCarrierPath(path) {
  return path.startsWith(`${FRICTION_FACT_DIRECTORY}/`) && /\/friction-[^/]+\.md$/.test(path);
}

export function extractFrictionCommitTargets(content) {
  const targets = [];
  const lines = String(content ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "---");
  if (start === -1) return targets;
  const end = lines.findIndex((line, index) => index > start && line.trim() === "---");
  if (end === -1) return targets;

  let inRelations = false;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
      inRelations = /^relations\s*:/.test(line);
      continue;
    }
    if (!inRelations) continue;
    const match = /^\s+commit\s*:\s*(.+?)\s*$/.exec(line);
    if (match) targets.push(match[1].replace(/^["']|["']$/g, ""));
  }
  return targets;
}

export async function checkFrictionCommitTargets(carriers, { resolves } = {}) {
  const issues = [];
  if (typeof resolves !== "function") {
    return {
      ok: false,
      issues: [newFinding("git/friction_commit_unverifiable", "cannot verify friction commit targets: no commit resolver was supplied (26 §11, fails closed)", null)],
      checked: 0,
    };
  }
  let checked = 0;
  for (const carrier of carriers ?? []) {
    for (const hash of extractFrictionCommitTargets(carrier.content)) {
      checked += 1;
      if (!COMMIT_HASH_PATTERN.test(hash)) {
        issues.push(newFinding("git/friction_commit_malformed", `${carrier.path}: relations target must be a 40-hex commit hash, got ${JSON.stringify(hash)} (02 §8.1 commit 形态)`, null));
        continue;
      }
      if (!(await resolves(hash))) {
        issues.push(newFinding("git/friction_commit_unresolvable", `${carrier.path}: commit ${hash} does not resolve to an existing commit in this repository (26 §11 — 目标必须存在且可解析)`, null));
      }
    }
  }
  return { ok: issues.length === 0, issues, checked };
}

const CARRIER_ID_SEGMENT =
  "(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})";

const FACT_TYPE_PREFIXES = Object.freeze({
  "ldvh-base/frictions": "friction",
  "ldvh-base/norms": "norm",
  "ldvh-base/pitfalls": "pitfall",
  "ldvh-base/reports": "report",
  "ldvh-base/sparks": "spark",
  "ldvh-base/subgoals": "subgoal",
});

export function factCarrierType(path) {
  for (const [directory, prefix] of Object.entries(FACT_TYPE_PREFIXES)) {
    if (!path.startsWith(`${directory}/`)) continue;
    const base = path.slice(directory.length + 1);
    if (!base.endsWith(".md")) return null;
    return { directory, prefix, base };
  }
  return null;
}

function declaredObjectUidLine(content) {
  const fm = /^---\n([\s\S]*?)\n---\n/m.exec(content);
  const block = fm ? fm[1] : null;
  if (block === null) return { ok: false, reason: "no YAML frontmatter block" };
  const line = /^object_uid:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m.exec(block);
  if (line === null) return { ok: false, reason: "no top-level object_uid declaration" };
  return { ok: true, uid: line[1] };
}

export function checkFactCarrierIdentity(carriers) {
  const issues = [];
  const claims = new Map();
  const pattern = new RegExp(`^(${Object.values(FACT_TYPE_PREFIXES).join("|")})-(${CARRIER_ID_SEGMENT})\\.md$`, "i");

  for (const carrier of carriers) {
    const type = factCarrierType(carrier.path);
    if (type === null) continue;
    if (typeof carrier.content !== "string" || carrier.content.length === 0) {
      issues.push(newFinding("facts/carrier_uid_unverifiable", `${carrier.path}: staged bytes are unreadable — cannot check the identity declaration (02 §5 item 6 fails closed)`, null));
      continue;
    }
    const declared = declaredObjectUidLine(carrier.content);
    if (!declared.ok) {
      issues.push(newFinding("facts/carrier_uid_unverifiable", `${carrier.path}: ${declared.reason} — cannot check the identity declaration (02 §5 item 6 fails closed)`, null));
      continue;
    }
    const nameMatch = pattern.exec(type.base);
    if (nameMatch === null) {
      const key = declared.uid.toLowerCase();
      const group = claims.get(key) ?? [];
      group.push(carrier.path);
      claims.set(key, group);
      continue;
    }
    const nameUid = nameMatch[2];
    if (declared.uid.toLowerCase() !== nameUid.toLowerCase()) {
      issues.push(newFinding(
        "facts/carrier_uid_filename_mismatch",
        `${carrier.path}: filename encodes ${JSON.stringify(nameUid)} but the carrier declares object_uid ${JSON.stringify(declared.uid)} — one of the two is wrong, and 02 §5 item 6 forbids silently consuming one of them`,
        null,
      ));
    }
    const key = declared.uid.toLowerCase();
    const group = claims.get(key) ?? [];
    group.push(carrier.path);
    claims.set(key, group);
  }

  for (const [uid, paths] of claims) {
    if (paths.length < 2) continue;
    issues.push(newFinding(
      "facts/carrier_uid_duplicate",
      `${paths.length} staged carriers declare object_uid ${JSON.stringify(uid)} (02 §5 item 6: 载体重复/身份冲突时不得静默选择一份继续消费或写入) — ${paths.join(", ")}`,
      null,
    ));
  }

  return { ok: issues.length === 0, issues, carriers: claims.size };
}
