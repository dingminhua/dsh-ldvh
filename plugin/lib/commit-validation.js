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

/**
 * Validate a commit message against the v5 contract (06 §6.1, transition
 * header format per decision #15): conventional header, exactly one
 * `关键变更:` section with at least one non-empty `- ` item, and exactly one
 * non-empty trailer line for each signature. Returns a list of stable issue
 * codes with messages (empty = valid).
 */
export function validateMessage(message) {
  const issues = [];
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  if (!HEADER_PATTERN.test(lines[0] ?? "")) issues.push("validation/header_invalid: first line must be a conventional commit header");
  const keyIndexes = lines.flatMap((line, index) => (line === "关键变更:" ? [index] : []));
  if (keyIndexes.length !== 1 || !lines.slice(keyIndexes[0] + 1).some((line) => line.startsWith("- ") && line.slice(2).trim().length > 0)) {
    issues.push("validation/key_changes_required: body must contain one 关键变更: section with a non-empty - item");
  }
  for (const name of SIGNATURES) {
    const matches = lines.filter((line) => line.startsWith(`${name}:`) && line.slice(name.length + 1).trim().length > 0);
    if (matches.length !== 1) issues.push(`validation/signature_trailer_missing: footer requires exactly one ${name}:`);
  }
  return issues;
}

/** Deterministic snapshot identity over (staged diff, message) — 06 §6.2. */
export function snapshotIdentity(diff, message) {
  return createHash("sha256").update(diff, "utf8").update("\0").update(message, "utf8").digest("hex");
}

/**
 * Check that each `关键变更:` `- ` item corresponds to the staged diff
 * (06 §6.2 item 3, mechanically decidable part): every non-empty item must
 * be matchable against the diff's changed paths or hunks, the list must not
 * be empty, and there must be no item naming a change absent from the diff.
 * The correspondence is content-level, not word-level: an item "matches"
 * when the diff touches the artifact the item names (path or clearly
 * identifiable subject). Items that cannot be mechanically matched are
 * reported as unverifiable — never silently accepted.
 */
export function checkKeyChangesAgainstDiff(message, diff) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const keyIndex = lines.findIndex((line) => line === "关键变更:");
  if (keyIndex === -1) return { ok: false, issues: ["validation/key_changes_required: no 关键变更: section"] };
  const items = [];
  for (const line of lines.slice(keyIndex + 1)) {
    if (line === "关键变更:") { items.length = 0; break; } // second section: caught by validateMessage
    if (line.startsWith("- ")) {
      const text = line.slice(2).trim();
      if (text.length > 0) items.push(text);
    }
  }
  if (items.length === 0) return { ok: false, issues: ["validation/key_changes_required: 关键变更: has no non-empty item"] };
  const changedPaths = extractDiffPaths(diff);
  const unmatched = [];
  for (const item of items) {
    if (!changedPaths.some((path) => itemMatchesPath(item, path))) unmatched.push(item);
  }
  if (unmatched.length > 0) return { ok: false, issues: unmatched.map((item) => `validation/key_change_unmatched: no staged change corresponds to "${item}"`) };
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
