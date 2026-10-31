/**
 * dsh-ldvh — SubGoal fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/28 (SubGoal-子目标) §13 受控操作,
 * §14.1 类型特有验证, and the shared read-back/CAS contract from specs/02 §10:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/subgoals/subgoal-<uid>.md) with YAML frontmatter +
 *             markdown body. Code assigns object_uid + created_at and
 *             generates the H1 from title; creation validates the type-specific
 *             mechanical checks (closed set, anchor shape + global uniqueness,
 *             criterion_kind closed set, parent_goal resolution, carrier
 *             coherence).
 *  - read:    returns frontmatter + body + file-level content fingerprint
 *             (SHA-256).
 *  - update:  CAS — two guarded lanes (28 §9.2):
 *               * active→active = 补充级更新 (28 §9.3): `anchor` is
 *                 field-identical to the CAS baseline (机械比对；锚点冻结是
 *                 28 §9.2 的不变量，不是可协商的更新内容).
 *               * active→achieved / active→retired = terminal transitions
 *                 (28 §9.2). Both are Human Gate outcomes; this module only
 *                 executes them and requires the caller to present the
 *                 corresponding basis (evidence list / disposition).
 *             achieved/retired objects are read-only (28 §9.2 终态不可重开).
 *
 * Anchor uniqueness (28 §6.2 layer 1): before a create or an update that would
 * take an anchor, every existing SubGoal carrier is scanned and its frontmatter
 * parsed; if ANY object (active/achieved/retired) already carries the same
 * `anchor` the write is REFUSED. Retired anchors are never recycled — that is
 * the whole point of a frozen anchor (28 §9.2).
 *
 * `parent_goal` resolution (28 §14.1): the anchor is dangling unless the
 * target carrier's `goal_key` matches. A dangling anchor is REPORTED, never
 * silently downgraded — the same discipline as 25 §11 Enforcement.
 *
 * Red lines honoured (28 §18): no relations field, no refs, no stored copy of
 * downstream work state or progress, no third sub-goal level.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";
import { sectionContent } from "./markdown-structure.js";
import { readGoalObject } from "./goal-writer.js";

// ---------------------------------------------------------------------------
// Constants (specs/28 §7, §8, §9, §10, §13)
// ---------------------------------------------------------------------------

const SUBGOAL_TYPE_KEY = "subgoal";

/** Directory under the fact-source root that carries SubGoal objects (28 §7). */
export const SUBGOAL_DIRECTORY = "subgoals";

/**
 * A syntactically valid UUID that never represents a real object: it exists only
 * so the closed-set validator (which requires a canonical `object_uid`) can run
 * on a precheck candidate without minting an identity (28 §13 不生成对象标识).
 * Never returned to a caller, never written.
 */
const PRECHECK_PLACEHOLDER_UID = "00000000-0000-4000-8000-000000000000";

/** Fixed body H2 sections (28 §8) — both required and non-empty. */
const BODY_H2_REQUIRED = ["达成条件", "对齐说明"];

/** Status closed set (28 §9): active → achieved | retired, both terminal. */
const STATUSES = new Set(["active", "achieved", "retired"]);

/** Criterion-kind closed set (28 §10.2). */
export const CRITERION_KINDS = new Set(["metric", "closure-records", "executable-check"]);

/** Title cap (28 §8: ≤ 40 字; same UTF-16 code-unit counting as 20 §9.1). */
const MAX_TITLE_LENGTH = 40;

/** `anchor` shape (28 §8: SG-n, frozen, never renumbered or recycled). */
const SG_ANCHOR_PATTERN = /^SG-[1-9]\d*$/;

/** `parent_goal` fixed value (28 §8: must match the goal carrier's goal_key). */
const PARENT_GOAL_KEY = "project-goal";

/** UUID format check (02 §7.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Closed set of frontmatter keys (28 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "anchor", "parent_goal",
  "status", "criterion", "criterion_kind", "alignment", "disposition",
  "created_at", "change_log",
]);

/**
 * 可经 frontmatter_removals 删除的字段（specs/02 §10.5 实现对齐）。
 *
 * 口径：白名单 = 该类型 §8 的**条件字段**中**非「终态伴随」**者。
 * `disposition` 是终态伴随即 retired 专属，在 update 路径不可达（终态只读），
 * 故不列——本类型没有可在非终态对象上合法删除的条件字段，白名单为空。
 */
export const SUBGOAL_REMOVABLE_FIELDS = new Set([]);

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
// Validation (the mechanical slice of specs/28 §8, §9, §13, §14.1)
// ---------------------------------------------------------------------------

/**
 * Frontmatter mechanical checks.
 *
 * The mechanical layer decides exactly what 28 §10.4 registers as decidable:
 * closed set, anchor shape, criterion non-empty, criterion_kind closed set,
 * parent_goal value, status/disposition mutual exclusion, title cap.
 *
 * It does NOT decide whether `criterion` is actually decidable, whether
 * `alignment` actually tracks the goal statement, or whether dedup holds —
 * those are 28 §15's semantic rows, judged by AI self-check + Human.
 */
export function validateSubGoalFrontmatter(frontmatter) {
  const issues = [];

  // Closed-set check (28 §8): unknown fields reject the object.
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 28 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || !UUID_PATTERN.test(frontmatter.object_uid)) {
    issues.push("object_uid: must be a canonical UUIDv4 (02 §7.1)");
  }
  if (frontmatter.fact_type_key !== SUBGOAL_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${SUBGOAL_TYPE_KEY}" (28 §7)`);
  }

  if (typeof frontmatter.title !== "string" || frontmatter.title.trim().length === 0) {
    issues.push("title: required and non-empty (28 §8)");
  } else if (frontmatter.title.trim().length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (28 §8, same counting as 20 §9.1)`);
  }

  // anchor: shape + freeze is checked separately (needs the baseline object).
  if (typeof frontmatter.anchor !== "string" || !SG_ANCHOR_PATTERN.test(frontmatter.anchor)) {
    issues.push(`anchor: must match SG-<positive integer> (28 §8), got ${JSON.stringify(frontmatter.anchor)}`);
  }

  if (frontmatter.parent_goal !== PARENT_GOAL_KEY) {
    issues.push(`parent_goal: must be "${PARENT_GOAL_KEY}" (28 §8: the project-level singleton goal key)`);
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of active/achieved/retired (28 §9), got ${JSON.stringify(frontmatter.status)}`);
  }

  if (typeof frontmatter.criterion !== "string" || frontmatter.criterion.trim().length === 0) {
    issues.push("criterion: required and non-empty (28 §8 — 达成条件说不出来的子目标不得落盘)");
  }

  if (!CRITERION_KINDS.has(frontmatter.criterion_kind)) {
    issues.push(`criterion_kind: must be one of ${[...CRITERION_KINDS].join("/")} (28 §10.2), got ${JSON.stringify(frontmatter.criterion_kind)}`);
  }

  if (typeof frontmatter.alignment !== "string" || frontmatter.alignment.trim().length === 0) {
    issues.push("alignment: required and non-empty (28 §8 — 说明该子目标为何服务于目标陈述)");
  }

  // 28 §8 字段间不变量 3: disposition appears ⇔ status = retired.
  if (frontmatter.status === "retired") {
    if (typeof frontmatter.disposition !== "string" || frontmatter.disposition.trim().length === 0) {
      issues.push("disposition: required when status=retired (28 §8: 原位作废的去向与理由)");
    }
  } else if (frontmatter.disposition !== undefined) {
    issues.push(`disposition: forbidden unless status=retired (28 §8), got status=${frontmatter.status}`);
  }

  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required (Code-assigned at creation)");
  }
  if (!Array.isArray(frontmatter.change_log) || frontmatter.change_log.length === 0) {
    issues.push("change_log: exactly one entry is appended per actual modification; at least one required");
  }

  return { ok: issues.length === 0, issues };
}

/** Body structure: H1 (generated from title) + the two fixed H2 sections. */
export function validateSubGoalBodyStructure(body, title) {
  const issues = [];
  const text = typeof body === "string" ? body : "";

  const h1s = [...text.matchAll(/^# (.+)$/gm)].map((m) => m[1].trim());
  if (h1s.length !== 1) {
    issues.push(`body: exactly one H1 is required, got ${h1s.length}`);
  } else if (title && h1s[0] !== title) {
    issues.push(`body: H1 must equal title (28 §8: the H1 is generated from title), got ${JSON.stringify(h1s[0])}`);
  }

  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  if (headings.length !== BODY_H2_REQUIRED.length || headings.some((h, i) => h !== BODY_H2_REQUIRED[i])) {
    issues.push(`body: H2 sections must be exactly ${BODY_H2_REQUIRED.map((h) => `"${h}"`).join(" then ")} in order, got ${JSON.stringify(headings)} (28 §8)`);
  }

  for (const heading of BODY_H2_REQUIRED) {
    const content = sectionContent(text, heading);
    if (content === null) {
      issues.push(`body: "${heading}" section must be present (28 §8)`);
    } else if (content.trim().length === 0) {
      issues.push(`body: "${heading}" section must be non-empty (28 §8)`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (28 §8 字段间不变量 1): `criterion` and `alignment` must
 * appear verbatim in their body sections. frontmatter is the single
 * authoritative text; the body only expands it.
 *
 * Exact string comparison, no normalization (28 §15 载体内聚 row).
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const pairs = [
    ["criterion", "达成条件"],
    ["alignment", "对齐说明"],
  ];
  for (const [field, section] of pairs) {
    const text = typeof frontmatter[field] === "string" ? frontmatter[field].trim() : "";
    if (text.length === 0) continue;
    const content = sectionContent(body, section);
    if (content === null) continue;
    if (!content.includes(text)) {
      issues.push(`carrier coherence: frontmatter ${field} must appear verbatim in "## ${section}" (28 §8 字段间不变量 1)`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function subgoalFileName(uid) { return `subgoal-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, SUBGOAL_DIRECTORY, subgoalFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/** Deterministic display order (semantic block first, change_log last). */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status", "anchor", "parent_goal",
  "criterion", "criterion_kind", "alignment", "disposition",
  "object_uid", "fact_type_key", "created_at",
  "change_log",
];

function orderFrontmatterFields(frontmatter) {
  const ordered = {};
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (key in frontmatter) ordered[key] = frontmatter[key];
  }
  for (const key of Object.keys(frontmatter)) {
    if (!(key in ordered)) ordered[key] = frontmatter[key];
  }
  return ordered;
}

async function atomicWriteFile(filePath, content) {
  const tmp = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, content, "utf8");
  const written = await readFile(tmp, "utf8");
  if (written !== content) {
    await unlink(tmp).catch(() => {});
    throw new Error("atomic write verification failed: written content does not match");
  }
  await rename(tmp, filePath);
}

/** Validate objectUid format (path-injection guard). */
function assertValidUid(objectUid) {
  return typeof objectUid === "string" && UUID_PATTERN.test(objectUid);
}

/** Assemble the file body: generated H1 + caller-provided markdown. */
function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.trim()}`;
}

/** Split a carrier into { frontmatter, body }; tolerant of a missing body. */
function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { ok: false, reason: "missing YAML frontmatter fence" };
  try {
    const frontmatter = parseYaml(match[1]);
    if (typeof frontmatter !== "object" || frontmatter === null) {
      return { ok: false, reason: "frontmatter is not a mapping" };
    }
    return { ok: true, frontmatter, body: raw.slice(match[0].length) };
  } catch (error) {
    return { ok: false, reason: `YAML parse failed: ${String(error?.message || error)}` };
  }
}

// ---------------------------------------------------------------------------
// Anchor uniqueness (28 §6.2 layer 1, §14.1)
// ---------------------------------------------------------------------------

/**
 * Scan ldvh-base/subgoals/ and return every object's {uid, anchor, status, title}.
 *
 * ALL statuses are scanned, not just active: 28 §9.2 freezes an anchor for the
 * object's whole life and forbids recycling it after `retired`, so a retired
 * anchor still occupies its number.
 *
 * Unparseable carriers are reported (not silently skipped): a carrier whose
 * frontmatter cannot be read cannot be proven conflict-free, so the anchor
 * cannot be granted.
 */
export async function listSubGoalAnchors(factSourceRoot) {
  const dir = join(factSourceRoot, SUBGOAL_DIRECTORY);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, items: [], unreadable: [] };
    return { ok: false, reason: String(error?.message || error) };
  }
  const items = [];
  const unreadable = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^subgoal-.*\.md$/.test(entry.name)) continue;
    const raw = await readFile(join(dir, entry.name), "utf8");
    const parsed = splitFrontmatter(raw);
    if (!parsed.ok) {
      unreadable.push({ file: entry.name, reason: parsed.reason });
      continue;
    }
    if (typeof parsed.frontmatter.anchor === "string") {
      items.push({
        file: entry.name,
        object_uid: parsed.frontmatter.object_uid ?? null,
        anchor: parsed.frontmatter.anchor,
        status: parsed.frontmatter.status ?? null,
        title: typeof parsed.frontmatter.title === "string" ? parsed.frontmatter.title : null,
      });
    }
  }
  return { ok: true, items, unreadable };
}

/**
 * Refuse when another object (ANY status) already carries `anchor` (28 §6.2).
 * `retired` occupies its number permanently, so recycling is refused too.
 */
async function checkAnchorExclusive(factSourceRoot, anchor, selfUid) {
  const listed = await listSubGoalAnchors(factSourceRoot);
  if (!listed.ok) {
    return failure("subgoal/scan_failed", `cannot scan ${SUBGOAL_DIRECTORY}/ for the anchor uniqueness pre-check: ${listed.reason}`);
  }
  if (listed.unreadable.length > 0) {
    // Fail closed: an unreadable carrier might be the one holding this anchor.
    return failure("subgoal/anchor_unverifiable", `cannot prove anchor "${anchor}" is free: ${listed.unreadable.length} carrier(s) under ${SUBGOAL_DIRECTORY}/ cannot be parsed (28 §6.2)`, { unreadable: listed.unreadable });
  }
  const conflicts = listed.items.filter((entry) => entry.anchor === anchor && entry.object_uid !== selfUid);
  if (conflicts.length > 0) {
    return failure("subgoal/anchor_already_exists", `anchor "${anchor}" is already taken (28 §6.2: 锚点唯一，且 retired 之后编号不复用); a new sub-goal needs a new SG-n`, { anchor, conflicts });
  }
  return success({ items: listed.items });
}

/**
 * Resolve `parent_goal` against the goal carrier (28 §14.1).
 *
 * A dangling anchor is a REPORTED condition, not a silent downgrade: if the
 * goal carrier is missing or its goal_key differs, the sub-goal's upstream is
 * unprovable and the write must fail closed (same discipline as 25 §11
 * Enforcement: no goal.md ⇒ Gate 1 cannot accept, architecturally).
 */
export async function resolveParentGoal(factSourceRoot) {
  const goal = await readGoalObject({ factSourceRoot });
  if (!goal.ok) {
    return failure("subgoal/parent_goal_unresolvable", `parent_goal cannot be resolved: the goal carrier is not readable (${goal.error?.message ?? "unknown"}) (28 §14.1 — 悬空锚须报告，不得静默降级)`);
  }
  const goalKey = goal.value?.frontmatter?.goal_key;
  if (goalKey !== PARENT_GOAL_KEY) {
    return failure("subgoal/parent_goal_unresolvable", `parent_goal must match the goal carrier's goal_key "${PARENT_GOAL_KEY}", got ${JSON.stringify(goalKey)} (28 §8)`);
  }
  return success({ goal_key: goalKey, file: goal.value?.file ?? null });
}

// ---------------------------------------------------------------------------
// Create (specs/02 §10 + specs/28 §13)
// ---------------------------------------------------------------------------

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Fingerprint of the CREATE candidate content (28 §13 双入口一致性).
 *
 * Covers exactly what the caller supplies and what ends up in the object: the
 * draft (minus Code-stamped fields) and the body. It deliberately excludes
 * `object_uid`/`created_at`/`change_log` — those are Code-generated and never a
 * caller decision, so including them would make two identical candidates
 * fingerprint differently and the comparison would be worthless.
 *
 * What the comparison proves: the two calls submitted the same candidate. What
 * it does NOT prove: the object was not later modified, nor that the content is
 * appropriate (28 §15 — that stays with Human judgement).
 */
export function computeSubGoalCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown) {
  const { change_summary: _summary, ...draftFields } = frontmatterDraft ?? {};
  const candidate = {
    frontmatter_draft: draftFields,
    body_markdown: typeof bodyMarkdown === "string" ? bodyMarkdown : null,
  };
  return createHash("sha256").update(stableStringify(candidate), "utf8").digest("hex");
}

/**
 * One evaluation of a CREATE candidate: normalised assembly + every mechanical
 * check, returning the exact `frontmatter`/`body` that would be written, or the
 * SAME failures the write path produces.
 *
 * Both entries (28 §13 双入口一致性) call this:
 *   - `precheckSubGoalCreate` passes `signature: null` and generates no uid;
 *   - `createSubGoalObject` passes the authoritative signature and a uid.
 *
 * Only the Code-stamped trio differs, and none of it is caller content — so a
 * candidate cannot get two different verdicts from the two entries. Two separate
 * rule sets would let a candidate pass one and fail the other while both claim
 * compliance, which is precisely what §13 forbids.
 */
async function evaluateCreateCandidate({ factSourceRoot, frontmatterDraft, bodyMarkdown, signature = null, objectUid = null }) {
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 达成条件'; the H1 is generated from title)");
  }
  if (frontmatterDraft === null || typeof frontmatterDraft !== "object" || Array.isArray(frontmatterDraft)) {
    return failure("invalid_request", "frontmatterDraft must be an object");
  }

  const now = new Date().toISOString();
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  // `object_uid` is a REQUIRED field of this closed set (02 §7.1), so the
  // evaluator cannot run without one. On the write path it is the real minted
  // identity. On the precheck path nothing is written and no identity may be
  // handed back (28 §13: 不生成对象标识), so a fixed placeholder is supplied to
  // satisfy the check and is DISCARED — a fresh UUID would also work but would
  // make the precheck mint an identifier, which §13 explicitly forbids.
  //
  // The placeholder cannot create a false pass: it never reaches disk, and it is
  // excluded from the candidate fingerprint (Code-stamped field).
  frontmatter.object_uid = objectUid ?? PRECHECK_PLACEHOLDER_UID;
  frontmatter.fact_type_key = SUBGOAL_TYPE_KEY;
  frontmatter.created_at = now;

  // 28 §9.2: the only legal initial state is active — never achieved/retired at birth.
  if (frontmatter.status !== undefined && frontmatter.status !== "active") {
    return failure("subgoal/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(frontmatter.status)} (28 §9.2 — 合法初态唯一)`);
  }
  frontmatter.status = "active";
  // `disposition` accompanies retirement only (28 §8 字段间不变量 3).
  if (frontmatter.disposition !== undefined) {
    return failure("subgoal/frontmatter_invalid", "create must not carry disposition (28 §8: it accompanies status=retired only)");
  }
  frontmatter.change_log = [{
    at: now,
    ...(signature ?? {}),
    summary: frontmatterDraft.change_summary ?? "受控创建 SubGoal 对象",
  }];

  const fmCheck = validateSubGoalFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("subgoal/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // 28 §14.1: the upstream must be resolvable before the object exists.
  const parent = await resolveParentGoal(factSourceRoot);
  if (!parent.ok) return parent;

  // 28 §6.2 layer 1 — before any write.
  const exclusivity = await checkAnchorExclusive(factSourceRoot, frontmatter.anchor, objectUid);
  if (!exclusivity.ok) return exclusivity;

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validateSubGoalBodyStructure(body, frontmatter.title);
  if (!bodyCheck.ok) {
    return failure("subgoal/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("subgoal/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }

  return success({ frontmatter, body });
}

/**
 * Read-only mechanical precheck of a CREATE candidate (28 §13 提请前机械预检).
 *
 * Runs the SAME evaluator the write path runs, so the verdict cannot disagree
 * with the write. Writes nothing, mints no `object_uid`, adds no `change_log`
 * entry. Returns the candidate fingerprint the caller passes back to
 * `ldvh_subgoal_write` as `expected_candidate_fingerprint` — that is what makes
 * "the Human approved THIS content" mechanically checkable rather than assumed.
 */
export async function precheckSubGoalCreate({ factSourceRoot, frontmatterDraft, bodyMarkdown }) {
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return success({
      mechanical_outcome: "unverifiable",
      candidate_fingerprint: computeSubGoalCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown),
      issues: ["body_markdown is required (starting with '## 达成条件'; the H1 is generated from title)"],
      issue_groups: [],
    });
  }
  const evaluated = await evaluateCreateCandidate({ factSourceRoot, frontmatterDraft, bodyMarkdown, signature: null, objectUid: null });
  const candidateFingerprint = computeSubGoalCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
  if (!evaluated.ok) {
    const code = evaluated.error.code;
    const issues = evaluated.error.details?.issues;
    // `invalid_request` is "the check could not be completed", not "the candidate
    // has a fixable defect" — kept as its own outcome so a blocked environment
    // cannot be misread as a formatting hint (same split as WorkCase 21 §14).
    return success({
      mechanical_outcome: code === "invalid_request" ? "unverifiable" : "failed",
      candidate_fingerprint: candidateFingerprint,
      error_code: code,
      error_message: evaluated.error.message,
      issues: Array.isArray(issues) ? issues : [],
      issue_groups: Array.isArray(issues) ? [{ code, issues }] : [],
    });
  }
  return success({
    mechanical_outcome: "passed",
    candidate_fingerprint: candidateFingerprint,
    issues: [],
    issue_groups: [],
    object_uid: null,
  });
}

/**
 * @param {object} args
 * @param {string|null} [args.expectedCandidateFingerprint] the fingerprint the
 *   precheck returned for THIS content. When supplied, the write refuses if the
 *   content changed in between (28 §13: 提请与写入之间候选内容发生变化时写入一律拒绝).
 */
export async function createSubGoalObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null, expectedCandidateFingerprint = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 达成条件'; the H1 is generated from title)");
  }

  const uid = randomUUID();
  const evaluated = await evaluateCreateCandidate({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    signature: sig.signature,
    objectUid: uid,
  });
  if (!evaluated.ok) return evaluated;

  // 28 §13: the precheck verdict belongs to the content it was run against. When
  // the caller supplies that fingerprint, a change in between is refused rather
  // than silently accepted — otherwise "Human approved it" would attach to a
  // different object than the one that lands.
  if (typeof expectedCandidateFingerprint === "string" && expectedCandidateFingerprint.length > 0) {
    const actual = computeSubGoalCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
    if (actual !== expectedCandidateFingerprint) {
      return failure(
        "subgoal/candidate_changed",
        "the candidate content changed between precheck and write; the precheck verdict does not carry over (28 §13) — re-run the precheck on the current content",
        { expected_candidate_fingerprint: expectedCandidateFingerprint, actual_candidate_fingerprint: actual },
      );
    }
  }

  const { frontmatter, body } = evaluated.value;
  const typeDir = join(factSourceRoot, SUBGOAL_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: uid, file: filePath, fingerprint: fileFingerprint(content) });
}

// ---------------------------------------------------------------------------
// Read (specs/02 §9.2 precise read-back)
// ---------------------------------------------------------------------------

export async function readSubGoalObject(args) {
  const { factSourceRoot, objectUid } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!assertValidUid(objectUid)) {
    return failure("subgoal/invalid_uid", `objectUid must be a canonical UUIDv4, got ${JSON.stringify(objectUid)}`);
  }
  const filePath = objectFilePath(factSourceRoot, objectUid);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return failure("subgoal/not_found", `no SubGoal carrier at ${filePath}`);
    return failure("subgoal/read_failed", String(error?.message || error));
  }
  const parsed = splitFrontmatter(raw);
  if (!parsed.ok) return failure("subgoal/carrier_invalid", `${filePath}: ${parsed.reason}`);
  const fmCheck = validateSubGoalFrontmatter(parsed.frontmatter);
  const bodyCheck = validateSubGoalBodyStructure(parsed.body, parsed.frontmatter.title);
  return success({
    object_uid: objectUid,
    file: filePath,
    fingerprint: fileFingerprint(raw),
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    mechanical_issues: [...fmCheck.issues, ...bodyCheck.issues],
    body_valid: bodyCheck.ok
  });
}

// ---------------------------------------------------------------------------
// Update (specs/02 §10.5 — CAS + 完整目标 after；+ specs/28 §9, §13)
// ---------------------------------------------------------------------------

export async function updateSubGoalObject(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!assertValidUid(objectUid)) {
    return failure("subgoal/invalid_uid", `objectUid must be a canonical UUIDv4, got ${JSON.stringify(objectUid)}`);
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("subgoal/change_summary_required", "changeSummary is required for update (02 §10.5: exactly one change_log entry per actual modification)");
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return failure("subgoal/not_found", `no SubGoal carrier at ${filePath}`);
    return failure("subgoal/read_failed", String(error?.message || error));
  }

  // CAS baseline: the caller must present the fingerprint from its own precise read.
  const baselineFingerprint = fileFingerprint(raw);
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return failure("subgoal/fingerprint_required", "expectedFingerprint is required (02 §10.5 CAS baseline)");
  }
  if (expectedFingerprint !== baselineFingerprint) {
    return failure("subgoal/fingerprint_mismatch", `CAS baseline mismatch: expected ${expectedFingerprint}, current ${baselineFingerprint}`, { current_fingerprint: baselineFingerprint });
  }

  const parsed = splitFrontmatter(raw);
  if (!parsed.ok) return failure("subgoal/carrier_invalid", `${filePath}: ${parsed.reason}`);
  const before = parsed.frontmatter;

  // Terminal objects are read-only (28 §9.2 终态不可重开).
  if (before.status === "achieved" || before.status === "retired") {
    return failure("subgoal/terminal_readonly", `object is status=${before.status}; 28 §9.2 forbids any transition out of a terminal state`);
  }

  if (frontmatterAfter !== null && frontmatterAfter !== undefined && typeof frontmatterAfter !== "object") {
    return failure("invalid_request", "frontmatterAfter must be an object when provided");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter (complete target body markdown) is required for update");
  }

  const now = new Date().toISOString();
  // 「磁盘基线 + 显式声明变更 + 显式删除通道」（02 §10.5）：漏传的字段继承磁盘基线。
  // subgoal 的唯一条件字段 disposition 是终态伴随，在 update 路径不可达，
  // 故 SUBGOAL_REMOVABLE_FIELDS 为空：不接受任何删除声明。
  const built = buildUpdateFrontmatter({
    currentFrontmatter: before,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: SUBGOAL_REMOVABLE_FIELDS,
    typeLabel: "subgoal",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const next = built.value;
  // Identity fields are Code-owned and immutable across updates.
  next.object_uid = before.object_uid;
  next.fact_type_key = SUBGOAL_TYPE_KEY;
  next.created_at = before.created_at;
  // 28 §9.2 锚点冻结：anchor is immutable for the object's whole life. A new
  // anchor is a NEW object, never an in-place rewrite.
  next.anchor = before.anchor;

  const targetStatus = next.status ?? before.status;
  if (!STATUSES.has(targetStatus)) {
    return failure("subgoal/frontmatter_invalid", `status: must be one of active/achieved/retired (28 §9), got ${JSON.stringify(targetStatus)}`);
  }
  next.status = targetStatus;

  let transition = "supplement";
  if (before.status === "active" && targetStatus === "active") {
    transition = "supplement";
    // 28 §9.3: an anchor change attempt is refused explicitly rather than
    // silently ignored, so the caller learns the value was not applied.
    if (frontmatterAfter?.anchor !== undefined && frontmatterAfter.anchor !== before.anchor) {
      return failure("subgoal/anchor_immutable", `anchor cannot change in place (28 §9.2 锚点冻结): a new sub-goal is a NEW SG-n, not a renumbered one`, { before: before.anchor, after: frontmatterAfter.anchor });
    }
  } else if (before.status === "active" && targetStatus === "achieved") {
    transition = "achieve";
    // 28 §9.2: achieved is a Human Gate outcome backed by an evidence list.
    // The mechanical layer cannot judge whether the evidence really satisfies
    // `criterion` (28 §10.3) — it only refuses a transition with NO basis at
    // all, which would be an unsupported claim rather than a judgement call.
    if (typeof changeSummary !== "string" || changeSummary.trim().length === 0) {
      return failure("subgoal/evidence_basis_required", "achieved requires the change summary to state the evidence basis (28 §9.2/§10.3)");
    }
  } else if (before.status === "active" && targetStatus === "retired") {
    transition = "retire";
    if (typeof next.disposition !== "string" || next.disposition.trim().length === 0) {
      return failure("subgoal/disposition_required", "retirement requires a non-empty disposition (28 §8/§9.2: 原位作废的去向与理由)");
    }
  } else {
    return failure("subgoal/transition_invalid", `illegal transition ${before.status} → ${targetStatus} (28 §9.2: only active→active, active→achieved and active→retired exist; terminal states never reopen)`);
  }

  next.change_log = [...(before.change_log ?? []), {
    at: now,
    ...sig.signature,
    summary: changeSummary,
  }];

  const fmCheck = validateSubGoalFrontmatter(next);
  if (!fmCheck.ok) {
    return failure("subgoal/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // Anchor uniqueness still holds on update: nothing else may have taken it,
  // and we must not have granted a second object the same number.
  const exclusivity = await checkAnchorExclusive(factSourceRoot, next.anchor, objectUid);
  if (!exclusivity.ok) return exclusivity;

  // `bodyMarkdownAfter` is the COMPLETE target body as returned by a precise
  // read — it already carries the H1 (same contract as norm/adr writers).
  const body = bodyMarkdownAfter.trim();
  const bodyCheck = validateSubGoalBodyStructure(body, next.title);
  if (!bodyCheck.ok) {
    return failure("subgoal/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(next, body);
  if (!coherenceCheck.ok) {
    return failure("subgoal/coherence_invalid", "carrier coherence failed on update", { issues: coherenceCheck.issues });
  }

  const content = buildFileContent(next, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: objectUid, file: filePath, fingerprint: fileFingerprint(content), transition });
}

// ---------------------------------------------------------------------------
// serves resolution (28 §12.3) — the single authority for downstream writers
// ---------------------------------------------------------------------------

/**
 * Resolve an `SG-n` anchor to a valid SubGoal object (28 §12.3).
 *
 * Contract:
 *   - `active` and `achieved` are valid targets (`achieved` still resolves:
 *     "this work served that goal" is a historical fact).
 *   - `retired` is NOT a valid target for a NEW `serves` declaration; existing
 *     declarations keep their value and go through the local re-batch path.
 *   - An unresolvable anchor fails closed (21 §10.1: Gate 1 cannot accept
 *     without an anchor).
 *
 * Returns { ok:true, object_uid, status, title } or { ok:false, ... }.
 */
export async function resolveSubGoalAnchor(factSourceRoot, anchor) {
  if (typeof anchor !== "string" || !SG_ANCHOR_PATTERN.test(anchor)) {
    return failure("subgoal/anchor_shape_invalid", `serves must be an SG-n anchor, got ${JSON.stringify(anchor)}`);
  }
  const listed = await listSubGoalAnchors(factSourceRoot);
  if (!listed.ok) {
    return failure("subgoal/scan_failed", `cannot scan ${SUBGOAL_DIRECTORY}/ to resolve ${anchor}: ${listed.reason}`);
  }
  if (listed.unreadable.length > 0) {
    return failure("subgoal/anchor_unverifiable", `cannot resolve ${anchor}: ${listed.unreadable.length} carrier(s) under ${SUBGOAL_DIRECTORY}/ cannot be parsed (28 §12.3)`, { unreadable: listed.unreadable });
  }
  const matches = listed.items.filter((entry) => entry.anchor === anchor);
  if (matches.length === 0) {
    return failure("subgoal/serves_unresolvable", `serves ${anchor} does not resolve to any SubGoal object under ${SUBGOAL_DIRECTORY}/ (28 §12.3)`, { available: listed.items.map((e) => e.anchor) });
  }
  if (matches.length > 1) {
    return failure("subgoal/anchor_ambiguous", `anchor ${anchor} resolves to ${matches.length} SubGoal objects — 两处权威 (28 §17 第 5 项)`, { matches });
  }
  const target = matches[0];
  if (target.status === "retired") {
    return failure("subgoal/serves_unresolvable", `serves ${anchor} resolves to a retired SubGoal; a retired anchor is not a valid target for a NEW serves declaration (28 §12.3 第 3 条; 既有声明保留原值走局部重批)`, { status: target.status });
  }
  return success({ object_uid: target.object_uid, status: target.status, title: target.title, file: target.file });
}

/**
 * Enumerate all `SG-n` anchors that are valid `serves` targets
 * (`active` ∪ `achieved`), for callers that render "available anchors".
 */
export async function listResolvableAnchors(factSourceRoot) {
  const listed = await listSubGoalAnchors(factSourceRoot);
  if (!listed.ok) return failure("subgoal/scan_failed", listed.reason);
  const anchors = listed.items
    .filter((entry) => entry.status === "active" || entry.status === "achieved")
    .map((entry) => entry.anchor)
    // Numeric anchor order (SG-1, SG-2, … SG-10) so callers that render
    // "available anchors" see the human reading order, not directory order.
    .sort((a, b) => Number(a.replace(/^SG-/, "")) - Number(b.replace(/^SG-/, "")));
  return success({ anchors, unreadable: listed.unreadable });
}

// ---------------------------------------------------------------------------
// List (F0/F1 discovery, specs/02 §9.1 + specs/28 §12)
// ---------------------------------------------------------------------------

/**
 * Enumerate SubGoal carriers. Default is active-only: 28 §12.4 registers
 * `active` as the default candidate status; achieved/retired surface only on
 * precise reference, historical tracing or evidence roll-up.
 */
export async function listSubGoalObjects(args) {
  const { factSourceRoot, status = "active", limit = 200 } = args;
  const dir = join(factSourceRoot, SUBGOAL_DIRECTORY);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return success({ total: 0, items: [], unreadable: [] });
    return failure("subgoal/read_failed", String(error?.message || error));
  }

  const wanted = status === "all" ? null : new Set(String(status).split(",").map((s) => s.trim()));
  const items = [];
  const unreadable = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^subgoal-.*\.md$/.test(entry.name)) continue;
    const raw = await readFile(join(dir, entry.name), "utf8");
    const parsed = splitFrontmatter(raw);
    if (!parsed.ok) {
      unreadable.push({ file: entry.name, reason: parsed.reason });
      continue;
    }
    const fm = parsed.frontmatter;
    if (wanted !== null && !wanted.has(fm.status)) continue;
    items.push({
      object_uid: fm.object_uid,
      fact_type_key: fm.fact_type_key,
      title: fm.title,
      anchor: fm.anchor,
      parent_goal: fm.parent_goal,
      status: fm.status,
      criterion: fm.criterion,
      criterion_kind: fm.criterion_kind,
      alignment: fm.alignment,
      disposition: fm.disposition,
      file: entry.name,
    });
  }

  // Stable reading order: by numeric anchor, then uid (a human scans SG-1, SG-2…).
  items.sort((a, b) => {
    const na = Number(String(a.anchor ?? "").replace(/^SG-/, ""));
    const nb = Number(String(b.anchor ?? "").replace(/^SG-/, ""));
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a.anchor ?? "").localeCompare(String(b.anchor ?? ""));
  });

  const total = items.length;
  return success({ total, items: items.slice(0, limit), unreadable });
}

export { SUBGOAL_TYPE_KEY, BODY_H2_REQUIRED, STATUSES, MAX_TITLE_LENGTH, VALID_FM_KEYS, SG_ANCHOR_PATTERN, PARENT_GOAL_KEY };
