/**
 * dsh-ldvh — Norm fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/27 §11 (受控操作), the uniqueness
 * three-layer design contract from 27 §11, and the shared read-back/CAS
 * contract from specs/03 §9:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/norms/norm-<uid>.md) with YAML frontmatter +
 *             markdown body. Code assigns object_uid + created_at and
 *             generates the H1 from title; creation validates the
 *             type-specific mechanical checks (closed set, direction_key
 *             format, title cap, four fixed H2 sections non-empty, carrier
 *             coherence) plus the FIRST of the three uniqueness layers.
 *  - read:    returns frontmatter + body + file-level content
 *             fingerprint (SHA-256).
 *  - update:  CAS — two guarded lanes (27 §8.1):
 *               * active→active = 受控更新 / 勘误级 (27 §13.2): direction_key
 *                 must be field-identical to the CAS baseline (机械比对；
 *                 方向实质漂移走退役+新建路径，不伪装为更新). The
 *                 "管辖边界未实质变更" half is AI/Human semantic scope —
 *                 the mechanical layer cannot judge body text meaning and
 *                 does not pretend to (27 §13.2).
 *               * active→retired = terminal transition: retirement_reason
 *                 closed set + retired_at Code-assigned.
 *             Retired objects are read-only (27 §8.1 终态不重开).
 *
 * Uniqueness FIRST layer (27 §11 item 1): before a create or an update that
 * would make an object active, every existing Norm carrier under
 * ldvh-base/norms/ is scanned and its frontmatter parsed; if another ACTIVE
 * Norm already carries the same direction_key the write is REFUSED with
 * ERR_DIRECTION_ALREADY_EXISTS. The second (Git Gate) and third (consumption
 * fail-closed) layers live elsewhere — see 27 §11; until all three exist the
 * spec forbids claiming the uniqueness constraint is mechanically guaranteed
 * (00 §7.1), so this module never asserts that.
 *
 * Red lines honoured (27 §17): no relations field, no norm_source field, no
 * direction_key hierarchy, no cache/index projection.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { ID_PATTERN } from "./spec-registry.js";

// ---------------------------------------------------------------------------
// Constants (specs/27 §7, §8, §11, §13.1)
// ---------------------------------------------------------------------------

const NORM_TYPE_KEY = "norm";

/** Directory under the fact-source root that carries Norm objects (27 §7). */
export const NORM_DIRECTORY = "norms";

/** Fixed body H2 sections (27 §8) — all four required and non-empty. */
const BODY_H2_REQUIRED = ["方向定位与适用范围", "核心规则体系", "约束与反模式", "验证与遵从性检查"];

const STATUSES = new Set(["active", "retired"]);

/** Retirement-reason closed set (27 §8, §8.1). */
const RETIREMENT_REASONS = new Set(["superseded", "outdated", "out-of-scope"]);

/** Title cap (27 §8: ≤ 40 字; same UTF-16 code-unit counting as 20 §9.1). */
const MAX_TITLE_LENGTH = 40;

/**
 * Mechanical error code for the first uniqueness layer (27 §11 item 1).
 * The spec names this code literally, so it is part of the contract.
 */
export const ERR_DIRECTION_ALREADY_EXISTS = "ERR_DIRECTION_ALREADY_EXISTS";

/** `direction_key` uses the 01.Att.02 §2 identifier format (27 §13.1). */
const DIRECTION_KEY_PATTERN = ID_PATTERN;

/** UUID format check (03 §6.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Closed set of frontmatter keys (27 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "direction_key", "retirement_reason", "retired_at", "change_log",
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
// Validation (the mechanical slice of specs/27 §8, §8.1, §13.1, §14)
// ---------------------------------------------------------------------------

export function validateNormFrontmatter(frontmatter) {
  const issues = [];

  // Closed-set check (27 §8): unknown fields reject the object
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 27 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  if (frontmatter.fact_type_key !== NORM_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${NORM_TYPE_KEY}"`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (27 §8), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  // direction_key (27 §8, §13.1): required, kebab-case identifier format
  if (typeof frontmatter.direction_key !== "string" || frontmatter.direction_key.length === 0) {
    issues.push("direction_key: required non-empty string (27 §8)");
  } else if (!DIRECTION_KEY_PATTERN.test(frontmatter.direction_key)) {
    issues.push(`direction_key: must match ${DIRECTION_KEY_PATTERN} (01.Att.02 §2 identifier format, full-string match; 27 §8/§13.1), got ${JSON.stringify(frontmatter.direction_key)}`);
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")} (27 §8.1)`);
  }

  // Status ⇔ terminal-field invariants (27 §8 field table, §13.1):
  //   active  ⇒ retirement_reason/retired_at forbidden
  //   retired ⇒ both required, retirement_reason in the closed set
  if (frontmatter.status === "active") {
    if (frontmatter.retirement_reason !== undefined) {
      issues.push("retirement_reason: must not be present when status=active (27 §8/§13.1)");
    }
    if (frontmatter.retired_at !== undefined) {
      issues.push("retired_at: must not be present when status=active (27 §8/§13.1)");
    }
  } else if (frontmatter.status === "retired") {
    if (typeof frontmatter.retirement_reason !== "string" || frontmatter.retirement_reason.length === 0) {
      issues.push("retirement_reason: required when status=retired (27 §8/§13.1)");
    } else if (!RETIREMENT_REASONS.has(frontmatter.retirement_reason)) {
      issues.push(`retirement_reason: must be one of ${[...RETIREMENT_REASONS].join("/")} (27 §8.1), got ${JSON.stringify(frontmatter.retirement_reason)}`);
    }
    if (typeof frontmatter.retired_at !== "string" || frontmatter.retired_at.length === 0) {
      issues.push("retired_at: required when status=retired (Code-assigned, 27 §8)");
    }
  }

  // 27 §9: Norm never carries relations. A relation-shaped field is rejected
  // by the closed set above; this is the explicit statement of the red line.
  if (frontmatter.relations !== undefined) {
    issues.push("relations: Norm does not use the relations field (27 §9)");
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Body structure (27 §8): the four fixed H2 sections must all exist and be
 * non-empty. This is a weak mechanical gate on STRUCTURE only — it does not
 * and cannot prove the rules are systematic (27 §17 red line 5).
 */
export function validateNormBodyStructure(body, title) {
  const issues = [];
  const h1Matches = body.match(/^# .+$/gm) ?? [];
  if (h1Matches.length !== 1) {
    issues.push(`body: must carry exactly one H1 (generated from title), found ${h1Matches.length}`);
  } else if (h1Matches[0] !== `# ${title}`) {
    issues.push("body: H1 must mirror the title exactly");
  }
  for (const section of BODY_H2_REQUIRED) {
    const content = sectionContent(body, section);
    if (content === null) {
      issues.push(`body: missing required H2 section "## ${section}" (27 §8 four-section skeleton)`);
    } else if (content.trim().length === 0) {
      issues.push(`body: H2 section "${section}" must be non-empty (27 §8)`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Extract the text under one H2 section (up to the next H2), or null. */
function sectionContent(body, heading) {
  const lines = body.split("\n");
  const target = `## ${heading}`;
  const start = lines.findIndex((line) => line.trimEnd() === target);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * Carrier coherence (27 §8): frontmatter is the machine authority. Nothing in
 * 27 requires a body section to reproduce a frontmatter scalar verbatim (the
 * four sections are rule prose, not projections of fields), so this checks the
 * one thing that IS mechanically decidable here — that the body does not
 * contradict the direction_key by declaring a different one.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const declared = body.match(/direction_key:\s*([a-z0-9-]+)/);
  if (declared !== null && declared[1] !== frontmatter.direction_key) {
    issues.push(`carrier coherence: body mentions direction_key "${declared[1]}" but frontmatter declares "${frontmatter.direction_key}" (frontmatter is the single authoritative text, 27 §8)`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function normFileName(uid) { return `norm-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, NORM_DIRECTORY, normFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/** Deterministic display order (semantic block first, change_log last). */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status", "direction_key",
  "retirement_reason", "retired_at",
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

// ---------------------------------------------------------------------------
// Uniqueness layer 1 (27 §11 item 1) — scan every Norm carrier before writing
// ---------------------------------------------------------------------------

/**
 * Scan ldvh-base/norms/ and return every active Norm's {uid, direction_key}.
 * Unparseable carriers are reported (not silently skipped): a carrier whose
 * frontmatter cannot be read cannot be proven conflict-free, and 27 §11 item 3
 * requires the consuming side to fail closed on collision rather than guess.
 */
export async function listActiveDirectionKeys(factSourceRoot) {
  const dir = join(factSourceRoot, NORM_DIRECTORY);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, active: [], unreadable: [] };
    return { ok: false, reason: String(error?.message || error) };
  }
  const active = [];
  const unreadable = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^norm-.*\.md$/.test(entry.name)) continue;
    const raw = await readFile(join(dir, entry.name), "utf8");
    const parsed = splitFrontmatter(raw);
    if (!parsed.ok) {
      unreadable.push({ file: entry.name, reason: parsed.reason });
      continue;
    }
    if (parsed.frontmatter.status === "active" && typeof parsed.frontmatter.direction_key === "string") {
      active.push({
        file: entry.name,
        object_uid: parsed.frontmatter.object_uid ?? null,
        direction_key: parsed.frontmatter.direction_key
      });
    }
  }
  return { ok: true, active, unreadable };
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

/**
 * First uniqueness layer (27 §11 item 1). Refuses when an ACTIVE Norm other
 * than `selfUid` already carries `directionKey`.
 */
async function checkDirectionKeyExclusive(factSourceRoot, directionKey, selfUid) {
  const listed = await listActiveDirectionKeys(factSourceRoot);
  if (!listed.ok) {
    return failure("norm/scan_failed", `cannot scan ${NORM_DIRECTORY}/ for the uniqueness pre-check: ${listed.reason}`);
  }
  const conflicts = listed.active.filter((entry) => entry.direction_key === directionKey && entry.object_uid !== selfUid);
  if (conflicts.length > 0) {
    return failure(ERR_DIRECTION_ALREADY_EXISTS, `an active Norm already carries direction_key "${directionKey}" (27 §11 uniqueness: Count(direction_key=d ∧ status="active") ≤ 1); take the controlled-update path on the existing Norm, or retire it and create a new one`, { direction_key: directionKey, conflicts });
  }
  return success({ active: listed.active, unreadable: listed.unreadable });
}

// ---------------------------------------------------------------------------
// Create (specs/03 §9.4 + specs/27 §11)
// ---------------------------------------------------------------------------

export async function createNormObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 方向定位与适用范围'; the H1 is generated from title)");
  }

  const uid = randomUUID();
  const now = new Date().toISOString();
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = NORM_TYPE_KEY;
  frontmatter.created_at = now;

  // 27 §8.1: the only legal initial state is active — never retired at birth.
  if (frontmatter.status !== undefined && frontmatter.status !== "active") {
    return failure("norm/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(frontmatter.status)} (27 §8.1 — 合法初态唯一)`);
  }
  frontmatter.status = "active";
  // Terminal fields cannot exist at creation (they accompany retirement only).
  if (frontmatter.retirement_reason !== undefined || frontmatter.retired_at !== undefined) {
    return failure("norm/frontmatter_invalid", "create must not carry retirement_reason/retired_at (27 §8: terminal fields accompany status=retired only)");
  }
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Norm 对象",
  }];

  const fmCheck = validateNormFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("norm/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // Uniqueness layer 1 (27 §11 item 1) — before any write.
  const exclusivity = await checkDirectionKeyExclusive(factSourceRoot, frontmatter.direction_key, uid);
  if (!exclusivity.ok) return exclusivity;

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validateNormBodyStructure(body, frontmatter.title);
  if (!bodyCheck.ok) {
    return failure("norm/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("norm/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }

  const typeDir = join(factSourceRoot, NORM_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: uid, file: filePath, fingerprint: fileFingerprint(content) });
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2 precise read-back)
// ---------------------------------------------------------------------------

export async function readNormObject(args) {
  const { factSourceRoot, objectUid } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!assertValidUid(objectUid)) {
    return failure("norm/invalid_uid", `objectUid must be a canonical UUIDv4, got ${JSON.stringify(objectUid)}`);
  }
  const filePath = objectFilePath(factSourceRoot, objectUid);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return failure("norm/not_found", `no Norm carrier at ${filePath}`);
    return failure("norm/read_failed", String(error?.message || error));
  }
  const parsed = splitFrontmatter(raw);
  if (!parsed.ok) return failure("norm/carrier_invalid", `${filePath}: ${parsed.reason}`);
  const fmCheck = validateNormFrontmatter(parsed.frontmatter);
  const bodyCheck = validateNormBodyStructure(parsed.body, parsed.frontmatter.title);
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
// Update (specs/03 §9.5 CAS + specs/27 §8.1, §11)
// ---------------------------------------------------------------------------

export async function updateNormObject(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!assertValidUid(objectUid)) {
    return failure("norm/invalid_uid", `objectUid must be a canonical UUIDv4, got ${JSON.stringify(objectUid)}`);
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("norm/change_summary_required", "changeSummary is required for update (03 §9.5: exactly one change_log entry per actual modification)");
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return failure("norm/not_found", `no Norm carrier at ${filePath}`);
    return failure("norm/read_failed", String(error?.message || error));
  }

  // CAS baseline (03 §9.5): the caller must present the fingerprint from its
  // own precise read — a mismatch means the object changed underneath.
  const baselineFingerprint = fileFingerprint(raw);
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return failure("norm/fingerprint_required", "expectedFingerprint is required (03 §9.5 CAS)");
  }
  if (expectedFingerprint !== baselineFingerprint) {
    return failure("norm/fingerprint_mismatch", `CAS baseline mismatch: expected ${expectedFingerprint}, current ${baselineFingerprint}`, { current_fingerprint: baselineFingerprint });
  }

  const parsed = splitFrontmatter(raw);
  if (!parsed.ok) return failure("norm/carrier_invalid", `${filePath}: ${parsed.reason}`);
  const before = parsed.frontmatter;

  // Terminal objects are read-only (27 §8.1 终态不重开).
  if (before.status === "retired") {
    return failure("norm/terminal_readonly", `object is status=retired; 27 §8.1 forbids any transition out of retired`);
  }

  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null) {
    return failure("invalid_request", "frontmatterAfter (complete target frontmatter) is required for update");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter (complete target body markdown) is required for update");
  }

  const now = new Date().toISOString();
  const next = { ...frontmatterAfter };
  // Identity fields are Code-owned and immutable across updates.
  next.object_uid = before.object_uid;
  next.fact_type_key = NORM_TYPE_KEY;
  next.created_at = before.created_at;
  // direction_key is immutable: 27 §11/§13.2 make an actual direction drift a
  // retire+create path, never an in-place rewrite.
  next.direction_key = before.direction_key;

  const targetStatus = next.status ?? before.status;
  if (targetStatus !== "active" && targetStatus !== "retired") {
    return failure("norm/frontmatter_invalid", `status: must be one of active/retired (27 §8.1), got ${JSON.stringify(targetStatus)}`);
  }
  next.status = targetStatus;

  let transition = "supplement";
  if (before.status === "active" && targetStatus === "active") {
    transition = "errata";
    // 27 §13.2: the mechanically decidable half is direction_key stability.
    // The body-text "管辖边界不变" half is AI/Human scope and is NOT claimed
    // here (00 §7.1 — no mechanical claim beyond what is actually decidable).
    if (frontmatterAfter.direction_key !== undefined && frontmatterAfter.direction_key !== before.direction_key) {
      return failure("norm/direction_key_immutable", `direction_key cannot change in place (27 §13.2): direction drift is a retire+create path, not an update`, { before: before.direction_key, after: frontmatterAfter.direction_key });
    }
  } else if (before.status === "active" && targetStatus === "retired") {
    transition = "retire";
    next.retired_at = now; // Code-assigned (27 §8)
    // superseded ⇒ another active Norm must exist and be resolvable (27 §8.1).
    // Norm has no relations field (27 §9), so the successor cannot be pinned by
    // uid; we verify the weaker, mechanically decidable fact that at least one
    // OTHER active Norm exists. Whether it is the RIGHT successor is Human/AI
    // semantic scope (27 §14 终态完整性).
    if (next.retirement_reason === "superseded") {
      const listed = await listActiveDirectionKeys(factSourceRoot);
      if (!listed.ok) {
        return failure("norm/scan_failed", `cannot verify superseded successor: ${listed.reason}`);
      }
      const others = listed.active.filter((entry) => entry.object_uid !== objectUid);
      if (others.length === 0) {
        return failure("norm/superseded_unresolvable", `retirement_reason=superseded requires an existing active Norm to resolve as the successor, but no other active Norm exists (27 §8.1/§13.1)`);
      }
    }
  } else {
    return failure("norm/transition_invalid", `illegal transition ${before.status} → ${targetStatus} (27 §8.1: only active→active and active→retired exist)`);
  }

  next.change_log = [...(before.change_log ?? []), {
    at: now,
    ...sig.signature,
    summary: changeSummary,
  }];

  const fmCheck = validateNormFrontmatter(next);
  if (!fmCheck.ok) {
    return failure("norm/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // Uniqueness layer 1 applies to updates that keep the object active — a
  // concurrent create may have taken the same direction_key since creation.
  if (next.status === "active") {
    const exclusivity = await checkDirectionKeyExclusive(factSourceRoot, next.direction_key, objectUid);
    if (!exclusivity.ok) return exclusivity;
  }

  // `bodyMarkdownAfter` is the COMPLETE target body as returned by a precise
  // read — it already carries the H1 (same contract as pitfall/adr writers).
  // Re-prepending the H1 here would produce two H1 headings and fail the
  // structure check.
  const body = bodyMarkdownAfter.trim();
  const bodyCheck = validateNormBodyStructure(body, next.title);
  if (!bodyCheck.ok) {
    return failure("norm/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(next, body);
  if (!coherenceCheck.ok) {
    return failure("norm/coherence_invalid", "carrier coherence failed on update", { issues: coherenceCheck.issues });
  }

  const content = buildFileContent(next, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: objectUid, file: filePath, fingerprint: fileFingerprint(content), transition });
}

// ---------------------------------------------------------------------------
// List (F0/F1 discovery, specs/03 §8 + specs/27 §10)
// ---------------------------------------------------------------------------

/**
 * Enumerate Norm carriers. Default is active-only: 27 §10 says retired Norms
 * stay out of ordinary candidates and surface only on precise reference or
 * historical tracing.
 *
 * Uniqueness layer 3 (27 §11 item 3) lives here: if two active Norms share a
 * direction_key, BOTH are withheld from the ordinary result and reported as a
 * gap (fail-closed, aligned with 01 §9.1) — a colliding pair must never be
 * served as if it were the current effective rule set.
 */
export async function listNormObjects(args) {
  const { factSourceRoot, status = "active", limit = 200 } = args;
  const dir = join(factSourceRoot, NORM_DIRECTORY);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return success({ total: 0, items: [], gaps: [], unreadable: [] });
    return failure("norm/read_failed", String(error?.message || error));
  }

  const items = [];
  const unreadable = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^norm-.*\.md$/.test(entry.name)) continue;
    const raw = await readFile(join(dir, entry.name), "utf8");
    const parsed = splitFrontmatter(raw);
    if (!parsed.ok) {
      unreadable.push({ file: entry.name, reason: parsed.reason });
      continue;
    }
    items.push({ file: entry.name, raw, frontmatter: parsed.frontmatter });
  }

  // Uniqueness layer 3: detect direction collisions among active Norms.
  const byDirection = new Map();
  for (const item of items) {
    const fm = item.frontmatter;
    if (fm.status !== "active" || typeof fm.direction_key !== "string") continue;
    const list = byDirection.get(fm.direction_key) ?? [];
    list.push(item);
    byDirection.set(fm.direction_key, list);
  }
  const collisions = [];
  const collidingFiles = new Set();
  for (const [directionKey, group] of byDirection) {
    if (group.length > 1) {
      collisions.push({ direction_key: directionKey, objects: group.map((g) => ({ object_uid: g.frontmatter.object_uid ?? null, file: g.file })) });
      for (const g of group) collidingFiles.add(g.file);
    }
  }

  const wanted = status === "all" ? items : items.filter((item) => item.frontmatter.status === status);
  // Fail-closed: colliding active Norms are withheld from the ordinary result.
  const servable = wanted.filter((item) => !collidingFiles.has(item.file));

  const projected = servable.map((item) => ({
    object_uid: item.frontmatter.object_uid ?? null,
    file: item.file,
    title: item.frontmatter.title ?? null,
    status: item.frontmatter.status ?? null,
    direction_key: item.frontmatter.direction_key ?? null,
    retirement_reason: item.frontmatter.retirement_reason ?? null,
    fingerprint: fileFingerprint(item.raw),
  }));
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : 200;
  const sliced = projected.slice(0, effectiveLimit);
  const truncated = projected.length > sliced.length;

  return success({
    total: projected.length,
    items: sliced,
    truncated,
    gaps: collisions.map((c) => ({ reason: "direction_collision", direction_key: c.direction_key, objects: c.objects })),
    withheld_count: collidingFiles.size,
    unreadable,
  });
}

export { NORM_TYPE_KEY, BODY_H2_REQUIRED, RETIREMENT_REASONS, MAX_TITLE_LENGTH, VALID_FM_KEYS };
