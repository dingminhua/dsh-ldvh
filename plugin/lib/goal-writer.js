/**
 * dsh-ldvh — Goal fact-object writer (singleton type).
 *
 * Implements the mechanical slice of specs/25 §11 (受控操作) and the shared
 * read-back/CAS contract from specs/03 §9:
 *
 *  - create:  SINGLETON carrier at `ldvh-base/goal.md` — path IS identity.
 *             25 §5 declares the single-instance exemptions: no `object_uid`,
 *             no `fact_type_key`, no type subdirectory, no filename encoding.
 *             Create MUST refuse when goal.md already exists (25 §11 单例
 *             fail-closed).
 *  - read:    returns frontmatter + body + file-level fingerprint (SHA-256).
 *  - update:  CAS on the whole file (25 §11: 以完整文件为单位). Two guarded
 *             concerns:
 *               * sub-goal anchor stability (25 §11 + §12): existing SG-n
 *                 numbers may not be rewritten, reordered or deleted — only
 *                 marked obsolete in place (原位作废).
 *               * status: active → achieved is the terminal transition and is
 *                 a Human Gate (25 §7); achieved freezes the file.
 *
 * Body structure (25 §6): exactly two fixed H2 sections —
 *   ## 目标陈述   (why + what; a paragraph; frozen region)
 *   ## 子目标     (SG-n items, one per line: `SG-n <可判定的达成条件>`)
 * The 方法与规划 regions were REMOVED by Human decision 2026-09-10.
 *
 * Red lines honoured (25 §15): no directory/uid/filename encoding for the
 * singleton; no downstream state stored on Goal (cascade is a mark, reverse
 * projection comes from `serves`); no cache/index/projection copy; no
 * invented status enum for "goal missing" (Gate 1 fail-closed is the whole
 * enforcement); no separate Gate shape for the init conversation.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";

// ---------------------------------------------------------------------------
// Constants (specs/25 §5, §6, §7)
// ---------------------------------------------------------------------------

/** The only legal `goal_key` value (25 §6). */
const GOAL_KEY = "project-goal";

/** Singleton carrier path, relative to the fact-source root (25 §5). */
export const GOAL_RELATIVE_PATH = "goal.md";

/** Status closure — exactly two values, no third (25 §7). */
const STATUSES = new Set(["active", "achieved"]);

/** Title cap (25 §6: ≤ 40 字). */
const MAX_TITLE_LENGTH = 40;

/** Fixed body H2 sections, in order (25 §6). */
const BODY_H2 = ["目标陈述", "子目标"];

/** sub-goal anchor pattern (25 §6: SG-n, frozen, never renumbered). */
const SG_ANCHOR_PATTERN = /^SG-[1-9]\d*$/;

/**
 * Closed set of frontmatter keys (25 §6 + §5 exemptions).
 * Deliberately absent: object_uid, fact_type_key, urls, relations —
 * 25 §5/§9 declare each of them not adopted for this type.
 */
const VALID_FM_KEYS = new Set([
  "goal_key", "title", "status", "created_at", "change_log",
]);

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Paths and shared primitives
// ---------------------------------------------------------------------------

/** Absolute path of the singleton carrier. */
export function goalFilePath(factSourceRoot) {
  return join(factSourceRoot, GOAL_RELATIVE_PATH);
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * Display order (same convention as the other writers): semantic block first,
 * identity last, change_log at the bottom. Reorders keys only.
 */
const FRONTMATTER_FIELD_ORDER = [
  "goal_key", "title", "status", "created_at", "change_log",
];

function orderFrontmatterFields(frontmatter) {
  const ordered = {};
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (frontmatter[key] !== undefined) ordered[key] = frontmatter[key];
  }
  for (const key of Object.keys(frontmatter)) {
    if (!(key in ordered)) ordered[key] = frontmatter[key];
  }
  return ordered;
}

async function atomicWriteFile(filePath, content) {
  // Random tmp suffix: a deterministic `${filePath}.tmp` would let two
  // concurrent writers on the same path clobber each other's staging file.
  const tmp = `${filePath}.${process.hrtime.bigint().toString(36)}.tmp`;
  await writeFile(tmp, content, "utf8");
  const written = await readFile(tmp, "utf8");
  if (written !== content) {
    await unlink(tmp).catch(() => {});
    throw new Error("atomic write verification failed: written content does not match");
  }
  await rename(tmp, filePath);
}

function assembleBody(title, bodyMarkdown) {
  return `# 项目目标\n\n${bodyMarkdown.trim()}`;
}

// ---------------------------------------------------------------------------
// Body parsing / validation (specs/25 §6)
// ---------------------------------------------------------------------------

/** Extract the H2 sections of a body, in order, with their text. */
export function splitBodySections(body) {
  const lines = body.split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^## (.+)$/);
    if (m !== null) {
      if (current !== null) sections.push(current);
      current = { heading: m[1].trim(), lines: [] };
      continue;
    }
    if (current !== null) current.lines.push(line);
  }
  if (current !== null) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() }));
}

/**
 * Parse sub-goal entries from the 子目标 section.
 * 25 §6: one entry per line, `SG-n <可判定的达成条件>`; an anchor marked
 * obsolete in place stays present (25 §7 原位作废) — the marker is textual.
 */
export function parseSubGoals(sectionText) {
  const entries = [];
  for (const raw of sectionText.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const m = line.match(/^(SG-\d+)\s+(.*)$/);
    if (m === null) {
      entries.push({ anchor: null, text: line, malformed: true });
      continue;
    }
    entries.push({ anchor: m[1], text: m[2].trim(), malformed: false });
  }
  return entries;
}

export function validateGoalFrontmatter(frontmatter) {
  const issues = [];

  // Closed set (25 §6 + §5 exemptions)
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 25 §6)`);
    }
  }

  // 25 §5/§9: these are NOT adopted for the singleton — their presence means
  // the caller is treating Goal as a multi-instance type.
  for (const forbidden of ["object_uid", "fact_type_key", "urls", "relations"]) {
    if (frontmatter[forbidden] !== undefined) {
      issues.push(`frontmatter: "${forbidden}" must not be present (25 §5/§9 declares it not adopted for the singleton type)`);
    }
  }

  if (frontmatter.goal_key !== GOAL_KEY) {
    issues.push(`goal_key: must be "${GOAL_KEY}" (25 §6 — the only legal value)`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (25 §6), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned, 25 §6)");
  }
  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")} (25 §7 — no third state)`);
  }
  if (!Array.isArray(frontmatter.change_log) || frontmatter.change_log.length === 0) {
    issues.push("change_log: required non-empty array (25 §6: 首修后必有; create writes the first entry)");
  } else {
    for (const [i, entry] of frontmatter.change_log.entries()) {
      if (typeof entry !== "object" || entry === null) { issues.push(`change_log[${i}]: must be an object`); continue; }
      if (typeof entry.at !== "string" || entry.at.length === 0) issues.push(`change_log[${i}].at: required (Code-assigned)`);
      if (typeof entry.summary !== "string" || entry.summary.length === 0) issues.push(`change_log[${i}].summary: required non-empty`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Body structure (25 §6): exactly the two fixed H2 sections, in order, both
 * non-empty except 子目标 which may legitimately be empty at creation
 * (25 §7: sub-goal 空缺是合法中间态).
 */
export function validateGoalBodyStructure(body, { allowEmptySubGoals = true } = {}) {
  const issues = [];
  if (!/^# 项目目标\s*$/m.test(body)) {
    issues.push("body: must contain the H1 \"# 项目目标\" (25 §6)");
  }
  const sections = splitBodySections(body);
  const headings = sections.map((s) => s.heading);
  if (headings.length !== BODY_H2.length || headings.some((h, i) => h !== BODY_H2[i])) {
    issues.push(`body: H2 sections must be exactly ${BODY_H2.map((h) => `"${h}"`).join(" then ")} in order, got ${JSON.stringify(headings)} (25 §6; 方法与规划 已移除)`);
  }
  const target = sections.find((s) => s.heading === "目标陈述");
  if (target === undefined || target.text.length === 0) {
    issues.push("body: 目标陈述 section must be present and non-empty (25 §11 创建检查)");
  }
  const subs = sections.find((s) => s.heading === "子目标");
  if (subs === undefined) {
    issues.push("body: 子目标 section must be present (25 §6)");
  } else if (!allowEmptySubGoals && subs.text.length === 0) {
    issues.push("body: 子目标 section must be non-empty");
  }
  return { ok: issues.length === 0, issues };
}

/**
 * sub-goal anchor stability (25 §11 + §12): every anchor present in the
 * baseline must still be present, with the SAME number. Adding anchors is
 * allowed; rewriting, renumbering or deleting one is an update rejection.
 */
export function validateAnchorStability(previousAnchors, nextAnchors) {
  const issues = [];
  const next = new Set(nextAnchors);
  for (const anchor of previousAnchors) {
    if (!next.has(anchor)) {
      issues.push(`sub-goal anchor ${anchor} disappeared — existing SG-n may not be deleted (only marked obsolete in place, 25 §7/§12)`);
    }
  }
  // Order must be preserved for anchors that exist in both (25 §12: 不重排).
  const prevCommon = previousAnchors.filter((a) => next.has(a));
  const nextCommon = nextAnchors.filter((a) => previousAnchors.includes(a));
  if (prevCommon.join(",") !== nextCommon.join(",")) {
    issues.push(`sub-goal anchors reordered (25 §12: 既有 SG-n 不重排): before ${JSON.stringify(prevCommon)}, after ${JSON.stringify(nextCommon)}`);
  }
  const seen = new Set();
  for (const anchor of nextAnchors) {
    if (seen.has(anchor)) issues.push(`sub-goal anchor ${anchor} appears twice (anchors are unique)`);
    seen.add(anchor);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2 + specs/25 §12)
// ---------------------------------------------------------------------------

export async function readGoalObject({ factSourceRoot }) {
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  const filePath = goalFilePath(factSourceRoot);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      // 25 §10: a missing goal.md is a legitimate state — Gate 1 is
      // architecturally fail-closed and reads are not blocked.
      return failure("goal/not_initialised", "goal.md does not exist (25 §10: 项目未初始化 — Gate 1 cannot be accepted, reads are not blocked)");
    }
    throw error;
  }
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (m === null) return failure("goal/frontmatter_invalid", "file must start with a YAML frontmatter block followed by the body");
  let frontmatter;
  try {
    frontmatter = parseYaml(m[1]);
  } catch (error) {
    return failure("goal/frontmatter_invalid", `frontmatter is not parsable YAML: ${String(error?.message ?? error)}`);
  }
  if (typeof frontmatter !== "object" || frontmatter === null) {
    return failure("goal/frontmatter_invalid", "frontmatter must be a mapping");
  }
  const body = m[2];
  const fmCheck = validateGoalFrontmatter(frontmatter);
  const bodyCheck = validateGoalBodyStructure(body);
  const subGoals = parseSubGoals(splitBodySections(body).find((s) => s.heading === "子目标")?.text ?? "");
  return success({
    file: filePath,
    fingerprint: fileFingerprint(content),
    frontmatter,
    body,
    sub_goals: subGoals,
    body_valid: bodyCheck.ok,
    body_issues: bodyCheck.issues,
    frontmatter_issues: fmCheck.issues,
  });
}

// ---------------------------------------------------------------------------
// Create (specs/03 §9.4 + specs/25 §11)
// ---------------------------------------------------------------------------

export async function createGoalObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
  // Human requirement 2026-09-12 + 03 §6.1 / 09 机械签名: the change_log entry
  // is signed BY CODE and may not be written unsigned.
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (starting with '## 目标陈述')");
  }

  // 25 §11 创建检查: goal.md must NOT exist — the singleton is fail-closed.
  // (25 §14.1 restates this as a Stop Condition; the entry REFUSES rather
  // than pausing, which is the shape the spec asks for.)
  const filePath = goalFilePath(factSourceRoot);
  try {
    await readFile(filePath, "utf8");
    return failure("goal/already_exists", `goal.md already exists at ${filePath}; the Goal type is a singleton and create is refused (25 §11 单例 fail-closed). Revise the existing goal through the update entry instead.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const now = new Date().toISOString();
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft ?? {};
  const frontmatter = { ...draftFields };
  frontmatter.goal_key = GOAL_KEY;
  frontmatter.created_at = now;
  // 25 §7: 初态必为 active
  if (frontmatter.status !== undefined && frontmatter.status !== "active") {
    return failure("goal/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(frontmatter.status)} (25 §7)`);
  }
  frontmatter.status = "active";
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft?.change_summary ?? "受控创建 Goal 对象（项目初始化对话）",
  }];

  const fmCheck = validateGoalFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("goal/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validateGoalBodyStructure(body);
  if (!bodyCheck.ok) {
    return failure("goal/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  await mkdir(factSourceRoot, { recursive: true });
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  // Read back precisely (03 §9.4 item 5).
  const readBack = await readGoalObject({ factSourceRoot });
  if (!readBack.ok) {
    return failure("goal/read_back_failed", `written but not readable: ${readBack.error.message}`);
  }
  return success({ file: filePath, fingerprint: fileFingerprint(content), read_back_fingerprint: readBack.value.fingerprint });
}

// ---------------------------------------------------------------------------
// Update (specs/03 §9.5 + specs/25 §11)
// ---------------------------------------------------------------------------

export async function updateGoalObject(args) {
  const {
    factSourceRoot, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary,
    sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    // 25 §6: every entry must independently answer "what changed + why".
    return failure("goal/change_summary_required", "changeSummary is required for update (25 §6: 每条必含修订理由)");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 目标陈述')");
  }

  const current = await readGoalObject({ factSourceRoot });
  if (!current.ok) return current;
  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("goal/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }
  // 25 §7: achieved is terminal and freezes the file.
  if (current.value.frontmatter.status === "achieved") {
    return failure("goal/status_terminal", "status=achieved is terminal and the file is frozen as a historical record (25 §7); a fundamentally overturned goal is a controlled REVISION before achievement, not a reopen");
  }

  const { change_summary: _stripped, ...afterFields } = frontmatterAfter ?? {};
  const fm = { ...afterFields };
  // 25 §5: identity is the path; the singleton adopts no uid/type key.
  fm.goal_key = GOAL_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("goal/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (active/achieved, 25 §7)`);
  }

  // sub-goal anchor stability (25 §11/§12) — compare BEFORE writing.
  const prevAnchors = current.value.sub_goals.filter((s) => s.anchor !== null).map((s) => s.anchor);
  const nextBody = assembleBody(fm.title, bodyMarkdownAfter);
  const nextSubText = splitBodySections(nextBody).find((s) => s.heading === "子目标")?.text ?? "";
  const nextAnchors = parseSubGoals(nextSubText).filter((s) => s.anchor !== null).map((s) => s.anchor);
  const stability = validateAnchorStability(prevAnchors, nextAnchors);
  if (!stability.ok) {
    return failure("goal/anchor_instability", "sub-goal anchor stability violated (25 §11/§12)", { issues: stability.issues });
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  const fmCheck = validateGoalFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("goal/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const bodyCheck = validateGoalBodyStructure(nextBody);
  if (!bodyCheck.ok) {
    return failure("goal/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  const filePath = goalFilePath(factSourceRoot);
  const content = buildFileContent(fm, nextBody);
  await atomicWriteFile(filePath, content);

  const readBack = await readGoalObject({ factSourceRoot });
  if (!readBack.ok || readBack.value.fingerprint !== fileFingerprint(content)) {
    return failure("goal/read_back_failed", "updated but read-back did not match; STOP further writes (03 §9.7)");
  }
  return success({
    file: filePath,
    fingerprint: fileFingerprint(content),
    // 25 §11: the goal revision cascade is a MARK, not an action taken here;
    // reporting the affected anchors lets the caller run the cascade scan
    // without Goal storing any downstream state.
    revised_anchors: nextAnchors.filter((a) => prevAnchors.includes(a)),
  });
}

/** Anchor list of a goal, for the cascade scan (25 §11). */
export async function readGoalAnchors({ factSourceRoot }) {
  const goal = await readGoalObject({ factSourceRoot });
  if (!goal.ok) return goal;
  return success({
    anchors: goal.value.sub_goals.filter((s) => s.anchor !== null && SG_ANCHOR_PATTERN.test(s.anchor)).map((s) => s.anchor),
    status: goal.value.frontmatter.status,
    file: goal.value.file,
  });
}
