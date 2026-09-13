// Shared commit-candidate validation core.
//
// Authority: specs/06 §6.1 (message contract) and §6.2 (precheck-git-commit
// public operation). specs/09 §6 requires the Git commit-msg gate and the
// Helper precheck to call THE SAME validation entry — this module is that
// single entry. The Git Gate runner (git-gate-runner.js) and the
// precheck-git-commit tool both consume it; no second implementation is
// permitted.
//
// v4 absorption record (docs/p0-implementation-plan.md §2): the body-structure
// and trailer checks are extracted-and-adapted from v4
// code/ldvh/commits/validation.py `_body_structure_issues` /
// `_footer_trailers` (~120 lines of its 1049); v4's platform-affected,
// fact-layer, human-gate-trailer checks are deliberately NOT migrated (v5
// removed them — dev-memo decision #29).

import { createHash } from "node:crypto";

/**
 * Ambient Git override variables must never leak into an LDVH Git invocation
 * (a surrounding shell's GIT_DIR / GIT_INDEX_FILE would silently redirect the
 * diff being validated). Shared by the Gate runner and the precheck handler
 * so both invoke Git with the same environment (specs/09 §6 single
 * implementation discipline).
 */
export function cleanGitEnvironment(extra = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  // Strip ambient Git overrides FIRST, then let the caller's explicit values
  // win: a preflight deliberately passes its own GIT_INDEX_FILE and must not
  // have it stripped, while an inherited shell GIT_DIR must never leak in.
  for (const key of Object.keys(env)) {
    if (["GIT_COMMON_DIR", "GIT_CONFIG_COUNT", "GIT_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_WORK_TREE"].includes(key) || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key];
  }
  return { ...env, ...extra };
}

export const HEADER_PATTERN = /^(feat|fix|docs|refactor|test|chore|build|ci|perf|style)(?:\([a-z0-9-]+\))?: .+/;
export const SIGNATURES = ["LDVH-Provider", "LDVH-Model"];
export const SOURCE_FINGERPRINT = createHash("sha256").update("dsh-ldvh-git-gate-v1", "utf8").digest("hex");

// ---------------------------------------------------------------------------
// K1 rule registry — the single authority for every mechanical finding the
// validator can emit (anchor doc §8.1 K1: stable rule IDs so findings are
// referenceable {rule, severity, line}). Emitting an unregistered rule throws
// (fail-loud registry discipline); adding a rule means adding it here first.
// ---------------------------------------------------------------------------

export const GATE_RULES = Object.freeze({
  "validation/header_invalid": Object.freeze({ severity: "blocking", description: "first line must be a conventional commit header" }),
  "validation/key_changes_required": Object.freeze({ severity: "blocking", description: "body must contain exactly one 关键变更: section with non-empty items" }),
  "validation/signature_trailer_missing": Object.freeze({ severity: "blocking", description: "footer requires exactly one LDVH-Provider: and one LDVH-Model: line" }),
  "validation/key_change_unmatched": Object.freeze({ severity: "blocking", description: "a 关键变更 item names no staged change (06 §6.1: no items absent from the diff)" }),
  "validation/staged_path_uncovered": Object.freeze({ severity: "blocking", description: "a staged diff path is covered by no 关键变更 item (06 §6.1: no diff change may be omitted; K1 bidirectional, Human 2026-09-10)" }),
  "validation/signature_provider_mismatch": Object.freeze({ severity: "blocking", description: "trailer LDVH-Provider does not match the authoritative session record" }),
  "validation/signature_model_mismatch": Object.freeze({ severity: "blocking", description: "trailer LDVH-Model does not match the authoritative session record" }),
  "git/index_empty": Object.freeze({ severity: "blocking", description: "candidate Index is empty" }),
  "facts/norm_direction_collision": Object.freeze({ severity: "blocking", description: "two or more ACTIVE Norm objects in ldvh-base/norms/ share one direction_key (27 §11 uniqueness second layer: the Git Gate traverses the index and refuses the commit)" }),
  "facts/norm_carrier_unparseable": Object.freeze({ severity: "blocking", description: "a staged ldvh-base/norms/norm-*.md carrier cannot be parsed for the direction_key uniqueness assertion — an unreadable carrier cannot be proven conflict-free, so the gate fails closed rather than passing it" })
});

/** Mechanical-artifact exemption for the bidirectional coverage check
 *  (06 §6.2 item 3 reverse half): basenames listed here are generated
 *  artifacts that a 关键变更 item is not expected to name. First batch:
 *  package-lock.json (Human 2026-09-10). Extending this list is an
 *  implementation-registry change; the exemption CATEGORY is spec-level. */
export const EXEMPT_BASENAMES = Object.freeze(["package-lock.json", "pnpm-lock.yaml"]);

export function isExemptPath(path) {
  const base = path.split("/").pop() ?? path;
  return EXEMPT_BASENAMES.includes(base);
}

/** Build one structured finding; `rule` must be registered. */
export function newFinding(rule, message, line = null) {
  const entry = GATE_RULES[rule];
  if (entry === undefined) throw new Error(`unregistered gate rule: ${rule}`);
  return { rule, severity: entry.severity, message, line };
}

/**
 * Validate a commit message against the v5 contract (06 §6.1, transition
 * header format per decision #15): conventional header, exactly one
 * `关键变更:` section with at least one non-empty `- ` item, and exactly one
 * non-empty trailer line for each signature. Returns structured findings
 * {rule, severity, message, line} (empty = valid).
 */
export function validateMessage(message) {
  const issues = [];
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  if (!HEADER_PATTERN.test(lines[0] ?? "")) issues.push(newFinding("validation/header_invalid", "first line must be a conventional commit header", 1));
  const keyIndexes = lines.flatMap((line, index) => (line === "关键变更:" ? [index] : []));
  if (keyIndexes.length !== 1 || !lines.slice(keyIndexes[0] + 1).some((line) => line.startsWith("- ") && line.slice(2).trim().length > 0)) {
    issues.push(newFinding("validation/key_changes_required", "body must contain one 关键变更: section with a non-empty - item", keyIndexes.length === 1 ? keyIndexes[0] + 1 : null));
  }
  for (const name of SIGNATURES) {
    const matches = lines.filter((line) => line.startsWith(`${name}:`) && line.slice(name.length + 1).trim().length > 0);
    if (matches.length !== 1) issues.push(newFinding("validation/signature_trailer_missing", `footer requires exactly one ${name}:`, null));
  }
  return issues;
}

/** Deterministic snapshot identity over (staged diff, message) — 06 §6.2. */
export function snapshotIdentity(diff, message) {
  return createHash("sha256").update(diff, "utf8").update("\0").update(message, "utf8").digest("hex");
}

/**
 * Check the `关键变更:` items against the staged diff, BOTH directions
 * (06 §6.1: "每个 - 列表项必须与本次提交的 diff 逐条对应——不得列出 diff
 * 中不存在的变更项，也不得遗漏 diff 中实际存在的变更项").
 *
 * Forward: every non-empty item must match a changed path (the v5-built
 * half — items naming absent changes are rejected).
 * Reverse (K1 bidirectional, Human 2026-09-10): every non-exempt changed
 * path must be covered by at least one item. This is the tripwire that turns
 * silent staged-content pollution (e.g. a parallel session's `git add`
 * landing in a shared Index) into a loud rejection. The correspondence is
 * the same deliberately loose mechanical slice as the forward direction
 * (itemMatchesPath below); known limitation: a same-directory pollution
 * where some item happens to contain a shared directory word (e.g.
 * "plugin") is not caught — the mechanically decidable slice accepts
 * diffstat-style area naming.
 */
export function checkKeyChangesAgainstDiff(message, diff) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const keyIndex = lines.findIndex((line) => line === "关键变更:");
  if (keyIndex === -1) return { ok: false, issues: [newFinding("validation/key_changes_required", "no 关键变更: section", null)] };
  const items = [];
  for (const [offset, line] of lines.slice(keyIndex + 1).entries()) {
    if (line === "关键变更:") { items.length = 0; break; } // second section: caught by validateMessage
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
  if (unmatched.length > 0) return { ok: false, issues: unmatched.map((item) => newFinding("validation/key_change_unmatched", `no staged change corresponds to "${item.text}"`, item.line)) };
  // Reverse half: every non-exempt staged path must be covered by some item.
  const uncovered = changedPaths.filter((path) => !isExemptPath(path) && !items.some((item) => itemMatchesPath(item.text, path)));
  if (uncovered.length > 0) return { ok: false, issues: uncovered.map((path) => newFinding("validation/staged_path_uncovered", `staged path "${path}" is not covered by any 关键变更 item`, null)) };
  return { ok: true, changedPaths };
}

function extractDiffPaths(diff) {
  const paths = new Set();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match === null) continue;
    paths.add(match[1]);
    paths.add(match[2]);
  }
  return [...paths];
}

/**
 * Mechanical item-to-path correspondence: the item mentions the changed path
 * (or its basename without extension when the item uses a natural-language
 * name). This is the deliberately narrow decidable slice — semantic review
 * of the DESCRIPTION quality stays with human/independent review, not here.
 */
function itemMatchesPath(item, path) {
  if (item.includes(path)) return true;
  const base = path.split("/").pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, "");
  if (stem.length > 2 && (item.includes(stem) || item.includes(base))) return true;
  // Diffstat-style summaries name the touched area; accept directory words.
  const segments = path.split("/").filter((segment) => segment.length > 2 && !/\d/.test(segment));
  return segments.some((segment) => item.includes(segment));
}

// ---------------------------------------------------------------------------
// Fact-object uniqueness assertion (specs/27 §11 second layer — Git Gate)
// ---------------------------------------------------------------------------

/** Directory (under the repo root) that carries Norm fact-object carriers. */
export const NORM_FACT_DIRECTORY = "ldvh-base/norms";

/**
 * Uniqueness formula from 27 §11:  Count(direction_key = d ∧ status = "active") ≤ 1
 *
 * The writer refuses such a write up front (layer 1) and the consuming side
 * fails closed (layer 3), but neither covers a carrier written by hand or by a
 * shell redirect. This is layer 2: at commit time, read every Norm carrier that
 * the candidate tree would contain and refuse the commit when two ACTIVE ones
 * share a direction_key.
 *
 * `carriers` is supplied by the caller as { path, content } pairs so this
 * function stays pure and testable; the runner gathers them from the Index and
 * the working tree (a staged carrier plus an unstaged sibling both land in the
 * committed tree).
 *
 * Scope honesty: this asserts the uniqueness constraint over the carriers it is
 * given. It does NOT validate rule quality, and per 27 §17 red line 5 it makes
 * no claim about whether a Norm is genuinely "systematic".
 */
export function checkNormDirectionUniqueness(carriers) {
  const issues = [];
  const active = [];
  for (const carrier of carriers) {
    const parsed = parseNormCarrierFrontmatter(carrier.content);
    if (!parsed.ok) {
      issues.push(newFinding("facts/norm_carrier_unparseable", `${carrier.path}: ${parsed.reason} — cannot prove this carrier conflict-free (27 §11 second layer fails closed)`, null));
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
        `${group.length} active Norm objects share direction_key "${directionKey}" (27 §11: Count(direction_key=d ∧ status=active) ≤ 1) — ${group.map((g) => g.path).join(", ")}; retire all but one before committing`,
        null
      ));
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Parse just enough YAML frontmatter to read status + direction_key. Kept local
 * (rather than importing the Norm writer) so the Git Gate runner stays free of
 * the writer's heavier dependency surface — the hook runs on every commit.
 */
function parseNormCarrierFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, reason: "missing YAML frontmatter fence" };
  const frontmatter = {};
  // Normalise CRLF -> LF BEFORE splitting. The fence regex above deliberately
  // accepts CRLF, so splitting on "\n" alone leaves a trailing "\r" on every
  // line. That "\r" is swallowed by the regex's `\s*` and then makes `(.*)$`
  // unmatchable, so such lines are dropped entirely — including `status`. The
  // carrier is then silently skipped and a duplicate direction_key commits
  // unchallenged: a FAIL-OPEN in the very layer 27 §11 declares fail-closed.
  // Normalising first mirrors validateMessage/checkKeyChangesAgainstDiff, which
  // already apply this same "\r\n" -> "\n" step in this file.
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

/** True when a repo-relative path is a Norm carrier this gate must inspect. */
export function isNormCarrierPath(path) {
  return path.startsWith(`${NORM_FACT_DIRECTORY}/`) && /\/norm-[^/]+\.md$/.test(path);
}
