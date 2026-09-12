/**
 * dsh-ldvh — Friction fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/26 §13 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/frictions/friction-<uid>.md) with YAML frontmatter
 *             + markdown body. Code assigns object_uid + created_at and
 *             generates the H1 from title; creation validates the
 *             type-specific mechanical checks (closed sets, phenomenon
 *             single-sentence, impact closure, fixed H2 sections incl.
 *             conditional 处置, carrier coherence).
 *  - read:    returns frontmatter + body + file-level content
 *             fingerprint (SHA-256).
 *  - update:  CAS — two guarded lanes (26 §9):
 *               * status-preserving = 补充级: status must be field-identical
 *                 to the CAS baseline (攒账计数/现象补充/归因后补；变了就
 *                 拒绝——状态变化走流转).
 *               * state transitions (Human-gated upstream): open→resolved
 *                 requires 1..n informs relations with resolvable targets;
 *                 open→deferred / deferred→open / deferred→resolved follow
 *                 §9.2 (deferred reversible, resolved terminal & read-only).
 *
 * Carrier coherence (26 §8): frontmatter phenomenon is the single
 * authoritative text — the 现象 body section must contain it verbatim.
 *
 * Red lines honoured (26 §18): no urls field, no decorative fields beyond
 * the impact closure (its consumers are anchored in §12), three body
 * sections only (ledger-light).
 */

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { resolveAuthoritativeSignature } from "./signature-channel.js";

// ---------------------------------------------------------------------------
// Constants (specs/26 §7, §8, §9, §11)
// ---------------------------------------------------------------------------

const FRICTION_TYPE_KEY = "friction";

/** Directory under the fact-source root that carries Friction objects. */
export const FRICTION_DIRECTORY = "frictions";

/** Fixed body H2 sections (26 §8); 处置 is conditional on resolved/deferred. */
const BODY_H2_REQUIRED = ["现象", "入账依据"];
const BODY_H2_DISPOSITION = "处置";

const STATUSES = new Set(["open", "resolved", "deferred"]);
const IMPACT_VALUES = new Set(["light", "medium", "heavy"]);

/** Relation keys allowed for Friction (26 §11 — closed set of exactly one). */
const FRICTION_RELATION_KEYS = new Set(["informs"]);

/** informs targets resolve inside the ADR and WorkCase directories (26 §11). */
const INFORMS_TARGET_DIRS = ["adrs", "workcases"];

/** Title cap (26 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** UUID format check (03 §6.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Closed set of frontmatter keys (26 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "phenomenon", "attribution", "impact", "serves", "relations", "change_log",
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
// Validation (the mechanical slice of specs/26 §8, §9, §13, §14.1)
// ---------------------------------------------------------------------------

/**
 * phenomenon 单句陈述 (26 §8, same mechanical shape as 20/22 号):
 * at most one sentence-terminal character (。？！) and, when present,
 * it must end the string. "现象非结论" is AI review scope.
 */
export function isSingleSentence(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  const terminals = text.match(/[。？！]/g) ?? [];
  if (terminals.length > 1) return false;
  if (terminals.length === 1) {
    const trimmed = text.trimEnd();
    if (!trimmed.endsWith(terminals[0])) return false;
  }
  return true;
}

export function validateFrictionFrontmatter(frontmatter) {
  const issues = [];

  // Closed-set check (26 §8): unknown fields reject the object
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 26 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  if (frontmatter.fact_type_key !== FRICTION_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${FRICTION_TYPE_KEY}"`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (26 §8), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  if (typeof frontmatter.phenomenon !== "string" || frontmatter.phenomenon.length === 0) {
    issues.push("phenomenon: required non-empty string");
  } else if (!isSingleSentence(frontmatter.phenomenon)) {
    issues.push("phenomenon: must be a single readable sentence — at most one terminal (。？！) and it must end the string (26 §8)");
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

  if (!IMPACT_VALUES.has(frontmatter.impact)) {
    issues.push(`impact: must be one of ${[...IMPACT_VALUES].join("/")} (26 §8)`);
  }

  // attribution (26 §8): conditional — present means non-empty (后补 via supplement).
  if (frontmatter.attribution !== undefined) {
    if (typeof frontmatter.attribution !== "string" || frontmatter.attribution.length === 0) {
      issues.push("attribution: when present must be a non-empty string (03 §6.1 — omit when not yet attributable)");
    }
  }

  // serves shape; goal.md resolution happens in the create/update flows.
  if (frontmatter.serves !== undefined) {
    if (typeof frontmatter.serves !== "string" || !/^SG-[1-9]\d*$/.test(frontmatter.serves)) {
      issues.push(`serves: must match SG-n (e.g. SG-3), got ${JSON.stringify(frontmatter.serves)}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Validate the relations contract (26 §11 + 03 §7.2).
 *
 * Mechanical scope: key closed set (informs only), status gating (only
 * resolved), cardinality 1..n, minimal entry/target shape, no duplicates,
 * no self-reference. Target resolvability is checked by the create/update
 * flows (they need the fact source root).
 */
export function validateFrictionRelations(frontmatter, selfUid = null) {
  const issues = [];
  const relations = frontmatter.relations;
  if (relations === undefined) return { ok: true, issues };
  if (!Array.isArray(relations)) {
    issues.push("relations: must be an array (03 §7.2)");
    return { ok: false, issues };
  }
  if (relations.length === 0) {
    issues.push("relations: when present must be non-empty (26 §11)");
    return { ok: false, issues };
  }

  // Status gating (26 §11): informs only on resolved frictions
  if (frontmatter.status !== "resolved") {
    issues.push(`relations: informs may only appear on status=resolved, got status=${JSON.stringify(frontmatter.status)} (26 §11)`);
  }

  const seen = new Set();
  for (const rel of relations) {
    if (typeof rel !== "object" || rel === null) {
      issues.push("relations[]: members must be objects");
      continue;
    }
    // 03 §7.2 minimal shape: relation_key + target only
    const relExtra = Object.keys(rel).filter((k) => k !== "relation_key" && k !== "target");
    if (relExtra.length > 0) {
      issues.push(`relations[]: entry carries fields beyond relation_key/target (${relExtra.join(", ")}) — 03 §7.2 minimal shape`);
    }

    const key = rel.relation_key;
    if (typeof key !== "string" || !FRICTION_RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key ${JSON.stringify(key)} not in closed set {informs} (26 §11)`);
      continue;
    }

    const target = rel.target;
    if (typeof target !== "object" || target === null || typeof target.object_uid !== "string" || !UUID_PATTERN.test(target.object_uid)) {
      issues.push(`relations[]: target.object_uid must be a canonical UUID (03 §7.2); got ${JSON.stringify(target?.object_uid)}`);
      continue;
    }
    const targetExtra = Object.keys(target).filter((k) => k !== "object_uid");
    if (targetExtra.length > 0) {
      issues.push(`relations[]: target carries fields beyond object_uid (${targetExtra.join(", ")}) — 03 §7.2 minimal shape`);
    }

    if (selfUid !== null && target.object_uid === selfUid) {
      issues.push("relations[]: informs target must not be the object itself (26 §11)");
    }

    const dedupe = `${key}::${target.object_uid}`;
    if (seen.has(dedupe)) issues.push(`relations[]: duplicate relation ${key} → ${target.object_uid}`);
    seen.add(dedupe);
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// goal.md anchor reading (serves resolution — same contract as spark 20 §13)
// ---------------------------------------------------------------------------

export async function readGoalAnchors(factSourceRoot) {
  const goalPath = join(factSourceRoot, "goal.md");
  let content;
  try {
    content = await readFile(goalPath, "utf8");
  } catch (error) {
    return { ok: false, reason: `cannot read goal.md: ${error.message}` };
  }
  const anchors = new Set();
  const lines = content.split("\n");
  let inSubGoals = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inSubGoals = line.slice(3).trim() === "子目标";
      continue;
    }
    if (inSubGoals) {
      const m = line.match(/^\s*(?:[-*]\s*)?(SG-[1-9]\d*)\b/);
      if (m) anchors.add(m[1]);
    }
  }
  return { ok: true, anchors };
}

// ---------------------------------------------------------------------------
// Body structure + carrier coherence
// ---------------------------------------------------------------------------

function h2Titles(body) {
  const titles = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) titles.push(line.slice(3).trim());
  }
  return titles;
}

function sectionContent(body, h2Title) {
  const sections = body.split(/^## /m).slice(1);
  const sec = sections.find((s) => s.split("\n")[0].trim() === h2Title);
  if (!sec) return null;
  return sec.slice(sec.indexOf("\n") + 1).trim();
}

/**
 * Validate the assembled body structure. The body passed here is the full
 * file body starting with the generated `# ${title}` H1 (26 §8).
 * 处置 section presence ⇔ status resolved/deferred (26 §8 conditional).
 * Returns { ok, issues }.
 */
export function validateFrictionBodyStructure(body, title, status) {
  const issues = [];
  const expectDisposition = status === "resolved" || status === "deferred";
  const expectedH2 = [...BODY_H2_REQUIRED];
  if (expectDisposition) expectedH2.push(BODY_H2_DISPOSITION);

  const lines = body.split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 26 §8)`);
  }

  const h2 = h2Titles(body);
  if (h2.length !== expectedH2.length) {
    issues.push(`body: expected ${expectedH2.length} H2 sections (${expectedH2.join(" / ")}), found ${h2.length} (${h2.join(" / ")})`);
  } else {
    for (let i = 0; i < expectedH2.length; i++) {
      if (h2[i] !== expectedH2[i]) {
        issues.push(`body: H2 #${i + 1} expected "${expectedH2[i]}", found "${h2[i]}"`);
      }
    }
  }

  // Non-empty check for every H2 section
  const sections = body.split(/^## /m).slice(1);
  for (const sec of sections) {
    const secTitle = sec.split("\n")[0].trim();
    const content = sec.slice(sec.indexOf("\n") + 1).trim();
    if (content.length === 0) issues.push(`body: section "${secTitle}" is empty`);
  }

  // 处置 H2 presence ⇔ resolved/deferred (26 §8 conditional)
  const hasDispositionH2 = h2.includes(BODY_H2_DISPOSITION);
  if (hasDispositionH2 !== expectDisposition) {
    issues.push(`body: "## 处置" section presence (${hasDispositionH2}) must match status resolved/deferred (${expectDisposition}) — 26 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (26 §8): frontmatter phenomenon is the single
 * authoritative text — the 现象 body section must contain it verbatim.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const text = typeof frontmatter.phenomenon === "string" ? frontmatter.phenomenon.trim() : "";
  if (text.length === 0) return { ok: true, issues }; // presence checked in validateFrictionFrontmatter
  const content = sectionContent(body, "现象");
  if (content === null) return { ok: true, issues }; // section presence checked in body structure
  if (!content.includes(text)) {
    issues.push(`carrier coherence: 现象 section must contain phenomenon verbatim (frontmatter is the single authoritative text): "${text.slice(0, 40)}…"`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function frictionFileName(uid) { return `friction-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, FRICTION_DIRECTORY, frictionFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * 展示层输出序（同 spark/adr/pitfall writer 约定）：语义块在前
 * （标题/状态/现象/归因/影响/信号归属/处置），引用与身份居后，
 * change_log 沉底。只重排键序，不新增、不删除、不改值。
 */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status",
  "phenomenon", "attribution", "impact", "serves",
  "relations",
  "object_uid", "fact_type_key", "created_at",
  "change_log",
];

function orderFrontmatterFields(frontmatter) {
  const ordered = {};
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (key in frontmatter) ordered[key] = frontmatter[key];
  }
  // 闭集校验已保证无表外字段；防御性保留任何遗漏键（原序跟在表后）。
  for (const key of Object.keys(frontmatter)) {
    if (!(key in ordered)) ordered[key] = frontmatter[key];
  }
  return ordered;
}

async function atomicWriteFile(filePath, content) {
  // Random tmp suffix (F8): a deterministic `${filePath}.tmp` would let two
  // concurrent writers on the same path clobber each other's staging file.
  const tmp = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, content, "utf8");
  // Write verification: read back and compare before rename —
  // catches partial writes (disk-full at flush time, etc.)
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
// Create (specs/03 §9.4 + specs/26 §13)
// ---------------------------------------------------------------------------

export async function createFrictionObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 现象'; the H1 is generated from title)");
  }

  // Code-assigned identity (03 §6.2)
  const uid = randomUUID();
  const now = new Date().toISOString();
  // Strip caller-only params (change_summary is a call argument, not object metadata)
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = FRICTION_TYPE_KEY;
  frontmatter.created_at = now;
  // 26 §9: 初态 open — create must never enter resolved/deferred
  if (frontmatter.status !== undefined && frontmatter.status !== "open") {
    return failure("friction/initial_state_violation", `create must initialise as status=open; got ${JSON.stringify(frontmatter.status)} (26 §9 — 销账/缓议是流转，不是初态)`);
  }
  frontmatter.status = "open";
  // 26 §11: informs relations cannot exist at creation (open)
  if (frontmatter.relations !== undefined) {
    return failure("friction/frontmatter_invalid", "create must not carry relations (26 §11: informs only attaches to a resolved transition)");
  }
  frontmatter.change_log = [{
    at: now,
    ...resolveAuthoritativeSignature(sessionSignature),
    summary: frontmatterDraft.change_summary ?? "受控创建 Friction 对象",
  }];

  // Validate
  const fmCheck = validateFrictionFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("friction/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateFrictionRelations(frontmatter, uid);
  if (!relCheck.ok) {
    return failure("friction/relations_invalid", "relations failed mechanical checks", { issues: relCheck.issues });
  }

  // serves resolution (26 §13): declared → must match a goal.md SG-n
  if (frontmatter.serves !== undefined) {
    const goal = await readGoalAnchors(factSourceRoot);
    if (!goal.ok) {
      return failure("friction/serves_unresolvable", `serves declared (${frontmatter.serves}) but goal.md is not readable: ${goal.reason}`);
    }
    if (!goal.anchors.has(frontmatter.serves)) {
      return failure("friction/serves_unresolvable", `serves ${frontmatter.serves} does not match any SG-n in goal.md 子目标 (available: ${[...goal.anchors].join(", ") || "none"})`);
    }
  }

  // Body structure + carrier coherence (26 §8, §14.1)
  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validateFrictionBodyStructure(body, frontmatter.title, frontmatter.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("friction/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }

  // Write (single flat file, atomic)
  const typeDir = join(factSourceRoot, FRICTION_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  const fingerprint = fileFingerprint(content);
  return success({ object_uid: uid, file: filePath, fingerprint });
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2 precise read-back)
// ---------------------------------------------------------------------------

export async function readFrictionObject(args) {
  const { factSourceRoot, objectUid } = args;
  if (!assertValidUid(objectUid)) {
    return failure("friction/invalid_uid", "objectUid must be a valid UUID");
  }
  const filePath = objectFilePath(factSourceRoot, objectUid);

  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    return failure("friction/object_not_found", `cannot read object file: ${error.message}`);
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("friction/object_invalid", "file has no YAML frontmatter block");
  }

  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("friction/object_invalid", `frontmatter parse error: ${error.message}`);
  }

  const body = content.slice(fmMatch[0].length).trim();
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const structure = validateFrictionBodyStructure(body, title, frontmatter.status);

  return success({
    object_uid: objectUid,
    file: filePath,
    frontmatter,
    body,
    body_valid: structure.ok,
    body_issues: structure.issues,
    fingerprint: fileFingerprint(content),
  });
}

// ---------------------------------------------------------------------------
// Update via CAS (specs/03 §9.5 + specs/26 §9, §13)
// ---------------------------------------------------------------------------

export async function updateFrictionObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("friction/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(objectUid)) {
    return failure("friction/invalid_uid", "objectUid must be a valid UUID");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 现象')");
  }

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("friction/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  // 26 §9.2: resolved is terminal (终态不重开；销错的账按 05 事实更正修正)
  const prevStatus = current.value.frontmatter.status;
  if (prevStatus === "resolved") {
    return failure("friction/status_terminal", "status=resolved is terminal and the object is read-only (26 §9.2); a recurring obstacle goes through a NEW ledger entry referencing this uid");
  }

  // Build updated frontmatter; strip the call-only param
  const { change_summary: _stripped, ...afterFields } = frontmatterAfter;
  const fm = { ...afterFields };
  fm.object_uid = objectUid;
  fm.fact_type_key = FRICTION_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("friction/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (open/resolved/deferred, 26 §9)`);
  }

  // 26 §9.3 补充边界：status 保持不变的更新是补充级（攒账计数/现象补充/
  // 归因后补）——status 与 CAS 基线逐字段一致（变了走流转，本入口即流转）。
  const isTransition = nextStatus !== prevStatus;
  if (!isTransition && prevStatus === "open") {
    if (fm.relations !== undefined) {
      return failure("friction/relations_invalid", "supplement-level update must not carry relations (26 §11: informs only attaches to a resolved transition)");
    }
  }

  // 26 §9.2 transition guards:
  if (isTransition) {
    if (prevStatus === "deferred" && nextStatus === "open") {
      // 重新激活：不带关系（26 §9.2）
      if (fm.relations !== undefined) {
        return failure("friction/relations_invalid", "deferred→open (reactivation) must not carry relations (26 §9.2)");
      }
    }
    if (nextStatus === "resolved") {
      // open→resolved / deferred→resolved：informs 1..n 在销账流转写入
      if (!Array.isArray(fm.relations) || fm.relations.length === 0) {
        return failure("friction/relations_invalid", "resolving requires 1..n informs relations pointing at the remedy objects (26 §9.2/§11)");
      }
    }
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...resolveAuthoritativeSignature(sessionSignature),
    summary: changeSummary,
  }];

  // Validate
  const fmCheck = validateFrictionFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("friction/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateFrictionRelations(fm, objectUid);
  if (!relCheck.ok) {
    return failure("friction/relations_invalid", "updated relations failed mechanical checks", { issues: relCheck.issues });
  }

  // serves resolution on the updated object (26 §13)
  if (fm.serves !== undefined) {
    const goal = await readGoalAnchors(factSourceRoot);
    if (!goal.ok) {
      return failure("friction/serves_unresolvable", `serves declared (${fm.serves}) but goal.md is not readable: ${goal.reason}`);
    }
    if (!goal.anchors.has(fm.serves)) {
      return failure("friction/serves_unresolvable", `serves ${fm.serves} does not match any SG-n in goal.md 子目标 (available: ${[...goal.anchors].join(", ") || "none"})`);
    }
  }

  // informs targets must resolve to existing ADR/WorkCase objects (26 §11;
  // ADR 任状态可解析；WorkCase 关闭状态是审核义务，机械只查存在可解析)
  for (const rel of fm.relations ?? []) {
    const targetUid = rel?.target?.object_uid;
    if (typeof targetUid !== "string" || targetUid === objectUid) continue;
    let resolvedTarget = false;
    for (const dir of INFORMS_TARGET_DIRS) {
      for (const ext of [".md", ".yaml"]) {
        try {
          await access(join(factSourceRoot, dir, `${dir === "adrs" ? "adr" : "workcase"}-${targetUid}${ext}`));
          resolvedTarget = true;
          break;
        } catch { /* try next */ }
      }
      if (resolvedTarget) break;
    }
    if (!resolvedTarget) {
      return failure("friction/relation_target_unresolvable", `informs target ${targetUid} does not resolve to an existing ADR/WorkCase object in ${INFORMS_TARGET_DIRS.join("/")}`);
    }
  }

  // Body structure + carrier coherence on the updated object
  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const bodyCheck = validateFrictionBodyStructure(body, fm.title, fm.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(fm, body);
  if (!coherenceCheck.ok) {
    return failure("friction/coherence_invalid", "carrier coherence failed on update", { issues: coherenceCheck.issues });
  }

  // Atomic single-file write
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}

// ---------------------------------------------------------------------------
// List / F0–F1 discovery (specs/03 §8, specs/26 §12)
// ---------------------------------------------------------------------------

/**
 * Enumerate Friction objects (F0/F1: deterministic filter + minimal
 * projection). Default status filter: open + deferred (26 §12: deferred 是
 * 活账——重新激活的候选源；resolved 仅精确引用/历史追溯)；includeResolved
 * includes all. Files that fail to parse are reported in `invalid` — never
 * skipped silently.
 */
export async function listFrictionObjects(args) {
  const { factSourceRoot, includeResolved = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }

  const typeDir = join(factSourceRoot, FRICTION_DIRECTORY);
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return success({ items: [], total: 0, complete: true, invalid: [] });
    }
    return failure("friction/directory_unavailable", `cannot read frictions directory: ${error.message}`);
  }

  const invalid = [];
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const nameMatch = entry.name.match(/^friction-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i);
    if (!nameMatch) continue; // non-carrier files (e.g. tmp staging) are not objects
    const uid = nameMatch[1].toLowerCase();
    let content;
    try {
      content = await readFile(join(typeDir, entry.name), "utf8");
    } catch (error) {
      invalid.push({ file: entry.name, reason: `unreadable: ${error.message}` });
      continue;
    }
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) {
      invalid.push({ file: entry.name, reason: "no YAML frontmatter block" });
      continue;
    }
    let frontmatter;
    try {
      frontmatter = parseYaml(fmMatch[1]);
    } catch (error) {
      invalid.push({ file: entry.name, reason: `frontmatter parse error: ${error.message}` });
      continue;
    }
    const status = frontmatter.status;
    if (!STATUSES.has(status)) {
      invalid.push({ file: entry.name, reason: `status ${JSON.stringify(status)} outside the closed set` });
      continue;
    }
    if (!includeResolved && status === "resolved") continue;
    items.push({
      object_uid: uid,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      impact: typeof frontmatter.impact === "string" ? frontmatter.impact : "",
      attribution: typeof frontmatter.attribution === "string" ? frontmatter.attribution : undefined,
      serves: typeof frontmatter.serves === "string" ? frontmatter.serves : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  // Newest first — the natural order for dedup scans and resumption.
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}
