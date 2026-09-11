/**
 * dsh-ldvh — Spark fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/20 §13 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/sparks/spark-<uid>.md) with YAML frontmatter +
 *             markdown body. Code assigns object_uid + created_at and
 *             generates the H1 from title; creation validates the
 *             type-specific mechanical checks (closed sets, question
 *             single-sentence, scope_boundary presence, fixed H2 sections,
 *             serves_sg ↔ goal.md SG-n, carrier coherence).
 *  - read:    returns frontmatter + body + file-level content
 *             fingerprint (SHA-256).
 *  - update:  CAS — the caller must supply the fingerprint observed at
 *             the last read; the whole file is replaced atomically;
 *             a change_log entry is appended. Terminal states
 *             (implemented/discarded) are read-only (20 §9: 终态不重开).
 *
 * Status model (20 §9): open → implemented | discarded only; create
 * always initialises open. disposition ⇔ terminal status. Relations
 * (merged-into / split-into) only on discarded, targets must resolve to
 * existing *open* sparks (20 §11).
 *
 * Carrier coherence (writer-level convention, 24 §8 invariant-10
 * precedent): frontmatter question / scope_boundary / summary are the
 * single authoritative texts — the 调查问题 / 调查边界 / 当前理解 body
 * sections must contain them verbatim and expand around them.
 *
 * Red lines honoured (20 §18): no second fact authority, no spark
 * index/copy — change_log lives inside the file's frontmatter.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { resolveAuthoritativeSignature } from "./signature-channel.js";

// ---------------------------------------------------------------------------
// Constants (specs/20 §7, §8, §9, §11)
// ---------------------------------------------------------------------------

const SPARK_TYPE_KEY = "spark";

/** Directory under the fact-source root that carries Spark objects. */
export const SPARK_DIRECTORY = "sparks";

/** Fixed body H2 sections (20 §8); 演变 is conditional on evolution. */
const BODY_H2_REQUIRED = ["当前理解", "调查问题", "调查边界"];
const BODY_H2_EVOLUTION = "演变";

const STATUSES = new Set(["open", "implemented", "discarded"]);

/** Relation keys allowed for Spark (20 §11 — closed set of exactly two). */
const SPARK_RELATION_KEYS = new Set(["merged-into", "split-into"]);

/** serves_sg anchor shape (25 §6: SG-n, frozen, never renumbered). */
const SG_ANCHOR_PATTERN = /^SG-[1-9]\d*$/;

/** Closed set of frontmatter keys (20 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "question", "scope_boundary", "intent", "summary",
  "evolution", "serves_sg", "disposition", "relations", "change_log",
]);

/** Evolution cap (20 §8: 上限 20 项). */
const MAX_EVOLUTION_ENTRIES = 20;

/** Title cap (20 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** UUID format check (03 §6.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
// Validation (the mechanical slice of specs/20 §8, §13, §14.1)
// ---------------------------------------------------------------------------

/**
 * question 单句可读 (20 §8/§13): at most one sentence-terminal character
 * (。？！) and, when present, it must end the string. Purely mechanical —
 * semantic readability stays in AI/Human review scope.
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

export function validateSparkFrontmatter(frontmatter) {
  const issues = [];

  // Closed-set check (20 §8): unknown fields reject the object
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 20 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  if (frontmatter.fact_type_key !== SPARK_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${SPARK_TYPE_KEY}"`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (20 §8), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  if (typeof frontmatter.question !== "string" || frontmatter.question.length === 0) {
    issues.push("question: required non-empty string");
  } else if (!isSingleSentence(frontmatter.question)) {
    issues.push("question: must be a single readable sentence — at most one terminal (。？！) and it must end the string (20 §8/§13)");
  }

  for (const field of ["scope_boundary", "intent", "summary"]) {
    if (typeof frontmatter[field] !== "string" || frontmatter[field].length === 0) {
      issues.push(`${field}: required non-empty string`);
    }
  }

  // serves_sg shape; goal.md resolution happens in the create/update flows
  // (needs the fact source root; 20 §13: 若声明，匹配 goal.md 存在的 SG-n).
  if (frontmatter.serves_sg !== undefined) {
    if (typeof frontmatter.serves_sg !== "string" || !SG_ANCHOR_PATTERN.test(frontmatter.serves_sg)) {
      issues.push(`serves_sg: must match SG-n (e.g. SG-4), got ${JSON.stringify(frontmatter.serves_sg)}`);
    }
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

  // evolution (20 §8): array of {at, summary}, cap 20. 03 §6.1: a conditional
  // field must be omitted when not applicable — an empty array is rejected.
  if (frontmatter.evolution !== undefined) {
    if (!Array.isArray(frontmatter.evolution)) {
      issues.push("evolution: must be an array of {at, summary}");
    } else {
      if (frontmatter.evolution.length === 0) {
        issues.push("evolution: must be omitted when there are no pivot entries — an empty array fabricates a conditional field (03 §6.1)");
      }
      if (frontmatter.evolution.length > MAX_EVOLUTION_ENTRIES) {
        issues.push(`evolution: exceeds the ${MAX_EVOLUTION_ENTRIES}-entry cap (20 §8)`);
      }
      for (const e of frontmatter.evolution) {
        if (typeof e !== "object" || e === null) {
          issues.push("evolution[]: members must be objects");
          continue;
        }
        const extra = Object.keys(e).filter((k) => k !== "at" && k !== "summary");
        if (extra.length > 0) issues.push(`evolution[]: unexpected field(s) ${extra.join(", ")} (only at/summary, 20 §8)`);
        if (typeof e.at !== "string" || e.at.length === 0) issues.push("evolution[].at: required non-empty");
        if (typeof e.summary !== "string" || e.summary.length === 0) issues.push("evolution[].summary: required non-empty");
      }
    }
  }

  // disposition ⇔ terminal status (20 §8 invariant, §14.1 终态处置完整性)
  if (frontmatter.status === "open") {
    if (frontmatter.disposition !== undefined) {
      issues.push("disposition: must not be present when status=open (20 §8: 出现 ⇔ 终态)");
    }
  } else {
    if (typeof frontmatter.disposition !== "string" || frontmatter.disposition.length === 0) {
      issues.push("disposition: required non-empty when status is implemented/discarded (20 §8/§14.1)");
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Validate the relations contract (20 §11 + 03 §7.2).
 *
 * Mechanical scope (20 §14.1): key closed set, minimal entry/target shape,
 * status gating (only discarded), merged-into cardinality exactly 1,
 * split-into cardinality 1..n, no key mixing, no duplicates, no
 * self-reference. Target *resolvability and open-ness* are checked by the
 * create/update flows (they need the fact source root).
 */
export function validateSparkRelations(frontmatter, selfUid = null) {
  const issues = [];
  const relations = frontmatter.relations;
  if (relations === undefined) return { ok: true, issues };
  if (!Array.isArray(relations)) {
    issues.push("relations: must be an array (03 §7.2)");
    return { ok: false, issues };
  }
  if (relations.length === 0) {
    issues.push("relations: when present must be non-empty (20 §11)");
    return { ok: false, issues };
  }

  // Status gating (20 §11): merge/split relations only on discarded sparks
  if (frontmatter.status !== "discarded") {
    issues.push(`relations: merged-into/split-into may only appear on status=discarded, got status=${JSON.stringify(frontmatter.status)} (20 §11)`);
  }

  const seen = new Set();
  const keysSeen = new Set();
  let mergedCount = 0;
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
    if (typeof key !== "string" || !SPARK_RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key ${JSON.stringify(key)} not in closed set {merged-into, split-into} (20 §11)`);
      continue;
    }
    keysSeen.add(key);

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
      issues.push(`relations[]: ${key} target must not be the object itself (20 §11)`);
    }

    if (key === "merged-into") mergedCount += 1;

    const dedupe = `${key}::${target.object_uid}`;
    if (seen.has(dedupe)) issues.push(`relations[]: duplicate relation ${key} → ${target.object_uid}`);
    seen.add(dedupe);
  }

  // Cardinality (20 §11): merged-into 1, split-into 1..n; never mixed
  if (keysSeen.has("merged-into") && keysSeen.has("split-into")) {
    issues.push("relations[]: merged-into and split-into must not be mixed on one object (20 §9.3 — a spark is either merged or split)");
  }
  if (keysSeen.has("merged-into") && mergedCount !== 1) {
    issues.push(`relations[]: merged-into has cardinality 1 (20 §11), got ${mergedCount}`);
  }

  return { ok: issues.length === 0, issues };
}

/** Extract the relation target uids (for flow-level resolvability checks). */
function relationTargetUids(frontmatter, selfUid) {
  const uids = [];
  for (const rel of frontmatter.relations ?? []) {
    const uid = rel?.target?.object_uid;
    if (typeof uid === "string" && uid !== selfUid) uids.push(uid);
  }
  return uids;
}

// ---------------------------------------------------------------------------
// goal.md anchor reading (20 §13: serves_sg 必须匹配 goal.md 存在的 SG-n)
// ---------------------------------------------------------------------------

/**
 * Read the SG-n anchors from the governed project's goal.md (## 子目标
 * section). Returns { ok, anchors:Set } or { ok:false, reason } when
 * goal.md is missing/unreadable (20 §17.1: declaring serves_sg with no
 * resolvable goal.md is a stop condition → reject at the flow level).
 */
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

/**
 * Validate the assembled body structure. The body passed here is the full
 * file body starting with the generated `# ${title}` H1 (20 §8 template).
 * Returns { ok, issues }.
 */
export function validateSparkBodyStructure(body, title, evolutionCount) {
  const issues = [];
  const expectedH2 = [...BODY_H2_REQUIRED];
  const expectEvolution = evolutionCount > 0;
  if (expectEvolution) expectedH2.push(BODY_H2_EVOLUTION);

  const lines = body.split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 20 §8)`);
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

  // 演变 H2 presence ⇔ non-empty evolution (20 §8: 条件出现)
  const hasEvolutionH2 = h2.includes(BODY_H2_EVOLUTION);
  if (hasEvolutionH2 !== expectEvolution) {
    issues.push(`body: "## 演变" section presence (${hasEvolutionH2}) must match a non-empty evolution array (${expectEvolution}) — 20 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

function sectionContent(body, h2Title) {
  const sections = body.split(/^## /m).slice(1);
  const sec = sections.find((s) => s.split("\n")[0].trim() === h2Title);
  if (!sec) return null;
  return sec.slice(sec.indexOf("\n") + 1).trim();
}

/**
 * Carrier coherence (writer-level convention, 24 §8 invariant-10 precedent):
 * frontmatter question / scope_boundary / summary are the single
 * authoritative texts — their body sections must contain them verbatim.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const pairs = [
    ["question", "调查问题"],
    ["scope_boundary", "调查边界"],
    ["summary", "当前理解"],
  ];
  for (const [field, section] of pairs) {
    const text = typeof frontmatter[field] === "string" ? frontmatter[field].trim() : "";
    if (text.length === 0) continue; // presence checked in validateSparkFrontmatter
    const content = sectionContent(body, section);
    if (content === null) continue; // section presence checked in body structure
    if (!content.includes(text)) {
      issues.push(`carrier coherence: ${section} section must contain ${field} verbatim (frontmatter is the single authoritative text): "${text.slice(0, 40)}…"`);
    }
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function sparkFileName(uid) { return `spark-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, SPARK_DIRECTORY, sparkFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * 展示层输出序（同 research-writer FRONTMATTER_FIELD_ORDER 约定）：语义块
 * 在前（标题/状态/悬置四要素/演变/归属/终态去向），引用与身份居后，
 * change_log 沉底。规范不强制书写顺序——本函数只是参考写入端的确定性
 * 输出格式：只重排键序，不新增、不删除、不改值。
 */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status",
  "question", "scope_boundary", "intent", "summary",
  "evolution", "serves_sg",
  "disposition", "relations",
  "object_uid", "fact_type_key", "created_at",
  "change_log",
];

function orderFrontmatterFields(frontmatter) {
  const ordered = {};
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (key in frontmatter) ordered[key] = frontmatter[key];
  }
  // 闭集校验已保证无表外字段；防御性保留任何遗漏键（原序跟在表后），
  // 避免未来字段准入与书写序登记不同步时静默丢字段。
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
// Create (specs/03 §9.4 + specs/20 §13)
// ---------------------------------------------------------------------------

export async function createSparkObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 当前理解'; the H1 is generated from title)");
  }

  // Code-assigned identity (03 §6.2)
  const uid = randomUUID();
  const now = new Date().toISOString();
  // Strip caller-only params (change_summary is a call argument, not object metadata)
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = SPARK_TYPE_KEY;
  frontmatter.created_at = now;
  // 20 §9: 初态 open — create must never enter a terminal state
  if (frontmatter.status !== undefined && frontmatter.status !== "open") {
    return failure("spark/initial_state_violation", `create must initialise as status=open; got ${JSON.stringify(frontmatter.status)} (20 §9)`);
  }
  frontmatter.status = "open";
  // 20 §8/§11: merge/split relations and disposition cannot exist at creation
  // (they only attach to a terminal transition, which create never performs)
  if (frontmatter.disposition !== undefined) {
    return failure("spark/frontmatter_invalid", "create must not carry disposition (20 §8: disposition ⇔ terminal status; create is always open)");
  }
  if (frontmatter.relations !== undefined) {
    return failure("spark/frontmatter_invalid", "create must not carry relations (20 §11: merged-into/split-into only attach to a discarded transition)");
  }
  frontmatter.change_log = [{
    at: now,
    ...resolveAuthoritativeSignature(sessionSignature),
    summary: frontmatterDraft.change_summary ?? "受控创建 Spark 对象",
  }];

  // Validate
  const fmCheck = validateSparkFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("spark/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateSparkRelations(frontmatter, uid);
  if (!relCheck.ok) {
    return failure("spark/relations_invalid", "relations failed mechanical checks", { issues: relCheck.issues });
  }

  // serves_sg resolution (20 §13): declared → must match a goal.md SG-n
  if (frontmatter.serves_sg !== undefined) {
    const goal = await readGoalAnchors(factSourceRoot);
    if (!goal.ok) {
      return failure("spark/serves_sg_unresolvable", `serves_sg declared (${frontmatter.serves_sg}) but goal.md is not readable: ${goal.reason} (20 §17.1)`);
    }
    if (!goal.anchors.has(frontmatter.serves_sg)) {
      return failure("spark/serves_sg_unresolvable", `serves_sg ${frontmatter.serves_sg} does not match any SG-n in goal.md 子目标 (available: ${[...goal.anchors].join(", ") || "none"})`);
    }
  }

  // Body structure + carrier coherence
  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const evolutionCount = Array.isArray(frontmatter.evolution) ? frontmatter.evolution.length : 0;
  const bodyCheck = validateSparkBodyStructure(body, frontmatter.title, evolutionCount);
  if (!bodyCheck.ok) {
    return failure("spark/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("spark/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }

  // Write (single flat file, atomic)
  const typeDir = join(factSourceRoot, SPARK_DIRECTORY);
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

export async function readSparkObject(args) {
  const { factSourceRoot, objectUid } = args;
  if (!assertValidUid(objectUid)) {
    return failure("spark/invalid_uid", "objectUid must be a valid UUID");
  }
  const filePath = objectFilePath(factSourceRoot, objectUid);

  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    return failure("spark/object_not_found", `cannot read object file: ${error.message}`);
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("spark/object_invalid", "file has no YAML frontmatter block");
  }

  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("spark/object_invalid", `frontmatter parse error: ${error.message}`);
  }

  const body = content.slice(fmMatch[0].length).trim();
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const evolutionCount = Array.isArray(frontmatter.evolution) ? frontmatter.evolution.length : 0;
  const structure = validateSparkBodyStructure(body, title, evolutionCount);

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
// List / F0–F1 discovery (specs/03 §8, specs/20 §12)
// ---------------------------------------------------------------------------
//
// Merge/split sequencing memo (Human-ratified deferral, gap 2 of the 2026-09
// review): multi-object atomicity is NOT implemented — merge/split runs as
// two single-object updates until the 21 WorkCase wave rebuilds it (C2
// cascade has the same need). Until then the safe order is SOURCE-FIRST:
// write the source (discarded + relations) before appending the merge-source
// note on the target's change_log. A failure then leaves at most "target
// missing one additive bookkeeping note" (recoverable, idempotent re-append),
// never a premature "merged-from X" claim on a target whose source is still
// open (a false statement).

/**
 * Enumerate Spark objects (F0/F1: deterministic filter + minimal projection).
 *
 * - Reads every `spark-<uid>.md` in the sparks directory and projects the
 *   dedup-relevant fields (title + question are the semantic comparison
 *   inputs per 20 §6.2).
 * - Default status filter: open only (20 §12: implemented/discarded stay out
 *   of ordinary unresolved candidates); `includeTerminal: true` includes all.
 * - `limit` caps the returned items (03 §8.1: no silent truncation — a cap
 *   hit returns `complete: false` plus the unfiltered total).
 * - Files that fail to parse are reported in `invalid` — never skipped
 *   silently (03 §8.1 F0 includes the invalid/unavailable object list).
 * - A missing sparks directory is a valid empty state, not an error.
 */
export async function listSparkObjects(args) {
  const { factSourceRoot, includeTerminal = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }

  const typeDir = join(factSourceRoot, SPARK_DIRECTORY);
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return success({ items: [], total: 0, complete: true, invalid: [] });
    }
    return failure("spark/directory_unavailable", `cannot read sparks directory: ${error.message}`);
  }

  const invalid = [];
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const nameMatch = entry.name.match(/^spark-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i);
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
    if (!includeTerminal && status !== "open") continue;
    items.push({
      object_uid: uid,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      question: typeof frontmatter.question === "string" ? frontmatter.question : "",
      serves_sg: typeof frontmatter.serves_sg === "string" ? frontmatter.serves_sg : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  // Newest first — the natural order for dedup scans and resumption.
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}

// ---------------------------------------------------------------------------
// Update via CAS (specs/03 §9.5 + specs/20 §13)
// ---------------------------------------------------------------------------

export async function updateSparkObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("spark/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(objectUid)) {
    return failure("spark/invalid_uid", "objectUid must be a valid UUID");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 当前理解')");
  }

  const current = await readSparkObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("spark/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  // 20 §9.2: terminal states are read-only (终态不重开；更正走 05 事实更正，
  // 不是本入口的领域状态转换)
  const prevStatus = current.value.frontmatter.status;
  if (prevStatus === "implemented" || prevStatus === "discarded") {
    return failure("spark/status_terminal", `status=${prevStatus} is terminal and the object is read-only (20 §9.2); later unresolved info belongs to a NEW open Spark`);
  }

  // Build updated frontmatter; strip the call-only param
  const { change_summary: _stripped, ...afterFields } = frontmatterAfter;
  const fm = { ...afterFields };
  fm.object_uid = objectUid;
  fm.fact_type_key = SPARK_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("spark/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (open/implemented/discarded, 20 §9)`);
  }
  // open → {open, implemented, discarded} are the only legal transitions from
  // the only non-terminal state, so no further transition check is needed.

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...resolveAuthoritativeSignature(sessionSignature),
    summary: changeSummary,
  }];

  // Validate
  const fmCheck = validateSparkFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("spark/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateSparkRelations(fm, objectUid);
  if (!relCheck.ok) {
    return failure("spark/relations_invalid", "updated relations failed mechanical checks", { issues: relCheck.issues });
  }

  // serves_sg resolution on the updated object (20 §13)
  if (fm.serves_sg !== undefined) {
    const goal = await readGoalAnchors(factSourceRoot);
    if (!goal.ok) {
      return failure("spark/serves_sg_unresolvable", `serves_sg declared (${fm.serves_sg}) but goal.md is not readable: ${goal.reason} (20 §17.1)`);
    }
    if (!goal.anchors.has(fm.serves_sg)) {
      return failure("spark/serves_sg_unresolvable", `serves_sg ${fm.serves_sg} does not match any SG-n in goal.md 子目标 (available: ${[...goal.anchors].join(", ") || "none"})`);
    }
  }

  // Relation targets must resolve to existing OPEN sparks (20 §11/§14.1:
  // 目标必须可解析且为 open — 合并/拆分去向校验)
  for (const targetUid of relationTargetUids(fm, objectUid)) {
    const targetRead = await readSparkObject({ factSourceRoot, objectUid: targetUid });
    if (!targetRead.ok) {
      return failure("spark/relation_target_unresolvable", `${targetUid} does not resolve to an existing Spark object: ${targetRead.error.message}`);
    }
    if (targetRead.value.frontmatter.status !== "open") {
      return failure("spark/relation_target_unresolvable", `${targetUid} is status=${targetRead.value.frontmatter.status}, not open — merge/split targets must be open (20 §11)`);
    }
  }

  // Body structure + carrier coherence on the updated object
  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const evolutionCount = Array.isArray(fm.evolution) ? fm.evolution.length : 0;
  const bodyCheck = validateSparkBodyStructure(body, fm.title, evolutionCount);
  if (!bodyCheck.ok) {
    return failure("spark/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(fm, body);
  if (!coherenceCheck.ok) {
    return failure("spark/coherence_invalid", "carrier coherence failed on update", { issues: coherenceCheck.issues });
  }

  // Atomic single-file write
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}
