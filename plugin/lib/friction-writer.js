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
 *               * state transitions (Human-gated upstream): observing→open
 *                 (threshold) / open→observing (放回留观) / observing→resolved
 *                 / →voided follow §9.2; resolved requires 1..n informs
 *                 relations with resolvable targets; resolved & voided are
 *                 terminal & read-only.
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

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { h2Titles, sectionContent } from "./markdown-structure.js";

// ---------------------------------------------------------------------------
// Constants (specs/26 §7, §8, §9, §11)
// ---------------------------------------------------------------------------

const FRICTION_TYPE_KEY = "friction";

/** Directory under the fact-source root that carries Friction objects. */
export const FRICTION_DIRECTORY = "frictions";

/** Fixed body H2 sections (26 §8); 处置 is conditional on resolved/voided. */
const BODY_H2_REQUIRED = ["现象", "入账依据"];
const BODY_H2_DISPOSITION = "处置";

const STATUSES = new Set(["observing", "open", "resolved", "voided"]);
const IMPACT_VALUES = new Set(["light", "medium", "heavy"]);

/** Relation keys allowed for Friction (26 §11 — closed set of exactly one). */
const FRICTION_RELATION_KEYS = new Set(["informs"]);

/** informs targets resolve inside the ADR and WorkCase directories (26 §11). */
const INFORMS_TARGET_DIRS = ["adrs", "workcases"];

/** Title cap (26 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** UUID format check (03 §6.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** 40 位 commit hash（26 §9.2 commit 例外的目标形态；短 hash 与 ref 名不接受）。 */
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

/** Closed set of frontmatter keys (26 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "phenomenon", "attribution", "attribution_ref", "impact", "relations",
  "occurrence", "change_log",
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

  return { ok: issues.length === 0, issues };
}

/**
 * Validate the relations contract (26 §11 + 02 §8.2).
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
    issues.push("relations: must be an array (02 §8.2)");
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
    // 02 §8.2 公共形状: relation_key + target only
    const relExtra = Object.keys(rel).filter((k) => k !== "relation_key" && k !== "target" && k !== "evidence_locator");
    if (relExtra.length > 0) {
      issues.push(`relations[]: entry carries fields beyond relation_key/target/evidence_locator (${relExtra.join(", ")}) — 02 §8.2 公共形状`);
    }

    const key = rel.relation_key;
    if (typeof key !== "string" || !FRICTION_RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key ${JSON.stringify(key)} not in closed set {informs} (26 §11)`);
      continue;
    }

    const target = rel.target;
    if (typeof target !== "object" || target === null) {
      issues.push(`relations[]: target must be an object (02 §8.2)`);
      continue;
    }
    // target 的两种合法形态（02 §8.2）：`{object_uid}` 或 `{commit}`——**互斥**。
    // commit 形态是唯一允许 target 不带 object_uid 的情形：解药本身是一次受控提交、
    // 没有任何对象身份（02 §8.1 commit 形态 / 26 §9.2 commit 例外）。
    const targetKeys = Object.keys(target);
    const hasUid = typeof target.object_uid === "string";
    const hasCommit = typeof target.commit === "string";
    if (hasUid && hasCommit) {
      issues.push("relations[]: target carries both object_uid and commit — the two forms are mutually exclusive (02 §8.1 commit 形态)");
      continue;
    }
    if (!hasUid && !hasCommit) {
      issues.push(`relations[]: target must carry object_uid or commit (02 §8.2); got ${JSON.stringify(target)}`);
      continue;
    }
    if (hasCommit) {
      if (!COMMIT_PATTERN.test(target.commit)) {
        issues.push(`relations[]: target.commit must be a 40-hex commit hash (02 §8.1); got ${JSON.stringify(target.commit)}`);
      }
      const extraWithCommit = targetKeys.filter((k) => k !== "commit");
      if (extraWithCommit.length > 0) {
        issues.push(`relations[]: a commit-form target carries fields beyond commit (${extraWithCommit.join(", ")}) — 02 §8.2`);
      }
      // commit 形态下 evidence_locator 不得并存（后者附加在 object_uid 上）
      if (rel.evidence_locator !== undefined && rel.evidence_locator !== null) {
        issues.push("relations[]: a commit-form target must not carry evidence_locator — the two mechanisms are not mixed (02 §8.1)");
      }
      const commitDedupe = `${key}::commit:${target.commit}`;
      if (seen.has(commitDedupe)) issues.push(`relations[]: duplicate relation ${commitDedupe}`);
      seen.add(commitDedupe);
      continue;
    }
    const targetExtra = targetKeys.filter((k) => k !== "object_uid");
    if (targetExtra.length > 0) {
      issues.push(`relations[]: target carries fields beyond object_uid (${targetExtra.join(", ")}) — 02 §8.2`);
    }
    if (!UUID_PATTERN.test(target.object_uid)) {
      issues.push(`relations[]: target.object_uid must be a canonical UUID (02 §8.2); got ${JSON.stringify(target.object_uid)}`);
      continue;
    }

    // evidence_locator：公共闭集当前只有 commit 一形（02 §8.1），附加在 object_uid 上。
    const locator = rel.evidence_locator;
    if (locator !== undefined && locator !== null) {
      if (typeof locator !== "object" || locator === null) {
        issues.push(`relations[]: evidence_locator must be an object when present (02 §8.1)`);
      } else {
        const locExtra = Object.keys(locator).filter((k) => k !== "commit");
        if (locExtra.length > 0) {
          issues.push(`relations[]: evidence_locator carries unsupported key(s) ${locExtra.join(", ")} (02 §8.1 公共闭集当前只有 commit)`);
        } else if (typeof locator.commit !== "string" || !COMMIT_PATTERN.test(locator.commit)) {
          issues.push(`relations[]: evidence_locator.commit must be a 40-hex commit hash (02 §8.1); got ${JSON.stringify(locator.commit)}`);
        }
      }
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
// Body structure + carrier coherence
// ---------------------------------------------------------------------------



/**
 * Validate the assembled body structure. The body passed here is the full
 * file body starting with the generated `# ${title}` H1 (26 §8).
 * 处置 section presence ⇔ status resolved/voided (26 §8 conditional).
 * Returns { ok, issues }.
 */
export function validateFrictionBodyStructure(body, title, status) {
  const issues = [];
  const expectDisposition = status === "resolved" || status === "voided";
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

  // 处置 H2 presence ⇔ resolved/voided (26 §8 conditional)
  const hasDispositionH2 = h2.includes(BODY_H2_DISPOSITION);
  if (hasDispositionH2 !== expectDisposition) {
    issues.push(`body: "## 处置" section presence (${hasDispositionH2}) must match status resolved/voided (${expectDisposition}) — 26 §8 条件出现`);
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
  "phenomenon", "attribution", "impact",
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
  // Human requirement 2026-09-12 + 03 §6.1 / 09 机械签名: a change_log entry is
  // signed BY CODE and may not be written unsigned. Without a branded carrier the
  // write is REFUSED; the caller reports it for Human handling (09 requires a
  // definite unavailable outcome for blank/historical sessions).
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
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
  // 26 §9: 初态 observing — create must never enter resolved/voided
  if (frontmatter.status !== undefined && frontmatter.status !== "observing") {
    return failure("friction/initial_state_violation", `create must initialise as status=observing; got ${JSON.stringify(frontmatter.status)} (26 §9 — 销账/废弃是流转，不是初态)`);
  }
  frontmatter.status = "observing";
  // 26 §8: occurrence 必填——创建时初值 count=1、first_at=last_at=now、
  // human_return_at=null。除 §14.2 的闭集收缩改判外，occurrence 不可缺。
  if (frontmatter.occurrence === undefined) {
    return failure("friction/frontmatter_invalid", "create must carry occurrence { count, first_at, last_at, human_return_at } (26 §8 必填)");
  }
  // 26 §11: informs relations cannot exist at creation (open)
  if (frontmatter.relations !== undefined) {
    return failure("friction/frontmatter_invalid", "create must not carry relations (26 §11: informs only attaches to a resolved transition)");
  }
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
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
    // commit 例外（26 §9.2）需要核验目标 commit 在本仓真实存在。resolver 由调用方
    // 注入（writer 不自行执行 git）；未注入时该核验 fail-closed，不静默放行。
    gitCommitResolver = null,
  } = args;
  // Human requirement 2026-09-12 + 03 §6.1 / 09 机械签名: a change_log entry is
  // signed BY CODE and may not be written unsigned. Without a branded carrier the
  // write is REFUSED; the caller reports it for Human handling (09 requires a
  // definite unavailable outcome for blank/historical sessions).
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

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
    return failure("friction/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (observing/open/resolved/voided, 26 §9)`);
  }

  // 26 §9.3 补充边界：status 保持不变的更新是补充级（攒账计数/现象补充/
  // 归因后补）——status 与 CAS 基线逐字段一致（变了走流转，本入口即流转）。
  const isTransition = nextStatus !== prevStatus;
  // 26 §13：闭集校验只施加于目标状态，历史源状态不因闭集收缩而被拒绝。
  if (!isTransition && (prevStatus === "observing" || prevStatus === "open")) {
    if (fm.relations !== undefined) {
      return failure("friction/relations_invalid", "supplement-level update must not carry relations (26 §11: informs only attaches to a resolved transition)");
    }
  }

  // 26 §9.2 transition guards:
  if (isTransition) {
    // observing→open / open→observing：两条激活路径都不带关系（26 §9.2）
    if ((prevStatus === "observing" && nextStatus === "open") ||
        (prevStatus === "open" && nextStatus === "observing")) {
      if (fm.relations !== undefined) {
        return failure("friction/relations_invalid", `${prevStatus}→${nextStatus} must not carry relations (26 §9.2)`);
      }
    }
    // open→observing（放回留观）：须写入 human_return_at，使机械通道的
    // 阈值触发跳过该账目（26 §9.2 / 04 §8.4 第 4 项）
    if (prevStatus === "open" && nextStatus === "observing") {
      if (!fm.occurrence || typeof fm.occurrence !== "object" || !fm.occurrence.human_return_at) {
        return failure("friction/frontmatter_invalid", "open→observing (放回留观) must stamp occurrence.human_return_at (26 §9.2 — 机械通道须据此跳过该账目)");
      }
    }
    // observing→open（Human 主动提前排期）：须清除 human_return_at
    if (prevStatus === "observing" && nextStatus === "open" && fm.occurrence?.human_return_at) {
      return failure("friction/frontmatter_invalid", "observing→open must clear occurrence.human_return_at (26 §9.2)");
    }
    if (nextStatus === "resolved") {
      // observing/open→resolved：informs 1..n 在销账流转写入
      if (!Array.isArray(fm.relations) || fm.relations.length === 0) {
        return failure("friction/relations_invalid", "resolving requires 1..n informs relations pointing at the remedy objects (26 §9.2/§11)");
      }
    }
    if (nextStatus === "voided") {
      // →voided：不得带关系（26 §9.1/§13）
      if (fm.relations !== undefined && Array.isArray(fm.relations) && fm.relations.length > 0) {
        return failure("friction/relations_invalid", "voided must not carry relations (26 §9.1)");
      }
    }
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
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

  // informs targets must resolve to existing ADR/WorkCase objects (26 §11;
  // ADR 任状态可解析；WorkCase 关闭状态是审核义务，机械只查存在可解析)。
  // commit 例外（Human 裁定 2026-10-09；26 §9.2/§11）：目标为 commit 时解析走
  // `git cat-file -e <hash>^{commit}`——**要求该 commit 在本仓真实存在**，否则一样 fail-closed。
  for (const rel of fm.relations ?? []) {
    const target = rel?.target;
    if (target === null || typeof target !== "object") continue;
    // commit 须在受控仓库真实可解析——两处来源都要查：`target.commit`（02 §8.1
    // commit 形态，解药本身是一次提交）与 `evidence_locator.commit`（附加在 object_uid
    // 上的证据定位）。无 resolver 时 fail-closed——无法核验即不通过。
    for (const commitHash of [target?.commit, rel?.evidence_locator?.commit]) {
      if (typeof commitHash !== "string") continue;
      if (typeof gitCommitResolver === "function") {
        if (!(await gitCommitResolver(commitHash))) {
          return failure("friction/relation_target_unresolvable", `commit ${commitHash} does not resolve to an existing commit in this repository (02 §8.1 commit 形态)`);
        }
      } else {
        return failure("friction/relation_target_unresolvable", `commit ${commitHash} cannot be verified: this writer has no git commit resolver (fail-closed, 02 §8.1)`);
      }
    }
    const targetUid = target?.object_uid;
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

/**
 * 终态事实更正（`correct`；26 §13，Human 决定 2026-10-09）。
 *
 * 存在理由：§9.2 要求「销错的账按 05 事实更正修正」，而本类型此前只有补充级更新
 * （机械拒绝改 status）与状态流转（终态不重开）——销错的 resolved 账无路可改。
 *
 * 可改范围：**正文（含处置段）与 relations**——恰是销账时写错的两处（02:386 事实
 * 更正与关系变更是不同动作，本入口覆盖两者）。逐字不变：status/title/phenomenon/
 * impact/attribution/created_at/change_log（Code 追加一条）。
 *
 * 与 WorkCase 的 correct 的关键差异：那里 `next` 是落盘对象的克隆、调用方**完全
 * 无法触及任何 frontmatter 字段**（只改正文）；这里 relations 是销账动作写入的产物，
 * 写错时必须能改，故显式接收 `relationsAfter` 并对其重新跑全套关系校验与解析。
 */
export async function correctFrictionObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    relationsAfter = null, bodyMarkdownAfter, changeSummary, humanAuthorization,
    // 2026-10（Human 裁定）：correct 入口可**显式删除**一个已从类型闭集移除的
    // frontmatter 字段（首个用例：serves——26 §8 于 2026-10 删除该字段，9 份
    // 存量中 1 份为 resolved 终态，无法经受控更新删除）。删除是显式声明而非
    // 隐式克隆：调用方不声明则该字段逐字继承，声明则只允许「删除」这一个动作。
    // 不得用于新增或改值——那会把终态更正变成受控更新。
    frontmatterRemovals = [],
    sessionSignature = null, gitCommitResolver = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (03 §10.5: 每次实际修改恰好一条 change_log)");
  }
  // 更正与其它受控更新同权限（26 §13 / 02 §10.5）；无授权记录的更正请求 fail-closed。
  if (typeof humanAuthorization !== "string" || humanAuthorization.trim().length === 0) {
    return failure("invalid_request", "humanAuthorization is required for a terminal fact correction (26 §13 终态事实更正；Human 确认；无授权记录的更正请求 fail-closed)");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body starting with '## 现象')");
  }

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("friction/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }
  const fm = current.value.frontmatter;
  // 26 §13：correct 适用于 resolved 与 voided 两个终态，分两支校验。
  if (fm.status !== "resolved" && fm.status !== "voided") {
    return failure(
      "friction/correction_requires_terminal",
      `terminal fact correction applies to a RESOLVED or VOIDED record only (26 §13: 适用于 resolved 与 voided 两个终态); got status=${JSON.stringify(fm.status)} — observing/open 内容修正走补充级更新或状态流转，本入口不得承载（否则等于把更正伪装成状态转换，02 §10.5）`,
    );
  }
  if (fm.status === "voided") {
    // voided 支：relations 必须为空（informs 校验不适用，26 §13）
    const rel = fm.relations;
    if (rel !== undefined && (!Array.isArray(rel) || rel.length > 0)) {
      return failure("friction/relations_invalid", "voided correct branch: relations must be absent or empty (26 §13)");
    }
  }

  if (!Array.isArray(frontmatterRemovals)) {
    return failure("invalid_request", "frontmatterRemovals must be an array when provided (26 §13)");
  }
  // 终态判定的逐字继承：除 relations 与显式声明的字段删除外，一切取自落盘对象，
  // 调用方无法触及。
  const next = structuredClone(fm);
  const removedFields = [];
  for (const field of frontmatterRemovals) {
    if (field === "serves") {
      // 26 §8 已把 serves 移出闭集；对象上仍残留只可能来自修订前，本入口是唯一
      // 受控清除途径。缺失即 no-op 的一部分（下方 body/relations/removals 三者
      // 全未变才判 no-op），故此处不单独拒绝「字段本就不存在」。
      if (Object.prototype.hasOwnProperty.call(next, field)) {
        delete next[field];
        removedFields.push(field);
      }
      continue;
    }
    return failure(
      "friction/correction_removal_not_permitted",
      `correct may only remove fields retired from the type's closed set; got ${JSON.stringify(field)} (26 §13: 终态事实更正不得新增或改值 frontmatter)`,
    );
  }
  if (relationsAfter !== null) {
    if (!Array.isArray(relationsAfter)) {
      return failure("friction/relations_invalid", "relationsAfter must be an array when provided (26 §13)");
    }
    if (fm.status === "voided") {
      // 26 §13 voided 支：relations 必须为空（informs 校验不适用）
      if (relationsAfter.length > 0) {
        return failure("friction/relations_invalid", `voided correct branch: relations must be empty (26 §13); got ${relationsAfter.length}`);
      }
    } else {
      // resolved 必有 informs（26 §11）；更正后仍须满足。
      const informsCount = relationsAfter.filter((r) => r !== null && typeof r === "object" && r.relation_key === "informs").length;
      if (informsCount === 0) {
        return failure("friction/relations_invalid", `a resolved friction must carry at least one informs relation (26 §11); got ${informsCount}`);
      }
    }
    next.relations = structuredClone(relationsAfter);
  }

  const relCheck = validateFrictionRelations(next, objectUid);
  if (!relCheck.ok) {
    return failure("friction/relations_invalid", "corrected relations failed mechanical checks", { issues: relCheck.issues });
  }

  // 关系目标解析（含 commit locator），与 update 路径同口径。
  for (const rel of next.relations ?? []) {
    // commit 两处来源都查：target.commit（解药形态）与 evidence_locator.commit（附加定位）
    for (const commitHash of [rel?.target?.commit, rel?.evidence_locator?.commit]) {
      if (typeof commitHash !== "string") continue;
      if (typeof gitCommitResolver !== "function") {
        return failure("friction/relation_target_unresolvable", `commit ${commitHash} cannot be verified: this writer has no git commit resolver (fail-closed, 02 §8.1)`);
      }
      if (!(await gitCommitResolver(commitHash))) {
        return failure("friction/relation_target_unresolvable", `commit ${commitHash} does not resolve to an existing commit in this repository (02 §8.1 commit 形态)`);
      }
    }
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

  // 正文结构 + 载体内聚（26 §13；resolved 的处置段必在）。
  const body = assembleBody(next.title, bodyMarkdownAfter);
  const bodyCheck = validateFrictionBodyStructure(body, next.title, next.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "corrected body failed structural checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(next, body);
  if (!coherenceCheck.ok) {
    return failure("friction/coherence_invalid", "carrier coherence failed on correction", { issues: coherenceCheck.issues });
  }

  // no-op 拒绝（审核发现⑤）：正文与 relations 均未变时不得追加一条声称更正过的
  // change_log——那会让账目历史出现「改过但其实没改」的假记录（02 §10.5 不记录 no-op）。
  // 正文比对去尾随空白：落盘时末尾恒有一个换行，直接比对会把每次调用都当成「有改动」。
  const trimEnd = (text) => text.replace(/\s+$/, "");
  const bodyUnchanged = trimEnd(assembleBody(fm.title, bodyMarkdownAfter)) === trimEnd(current.value.body);
  // relations 比对必须**键序无关**（审核复审发现 A）：JSON.stringify 对键序敏感，
  // 而 relations 经 YAML 落盘后键序由序列化器决定。调用方以等价键序重传会被误判为
  // 「有变更」，从而追加一条声称更正过的 change_log——恰是本条要防的假记录形态。
  // 故按 schema 规范化（每条关系固定取 relation_key / target.object_uid /
  // evidence_locator.commit）后逐字段比较。
  //
  // **与 `validateFrictionRelations` 的闭集是两处独立字面量**（第三轮复审遗留建议）：
  // 扩 relations schema（02 §8.2 公共形状）时**两处必须同步更新**。当前假 no-op 风险
  // 被 validate 的前置校验封闭（extra 字段在到达这里之前已被拒），故不可达；但若先放宽
  // validate 而忘了这里，新字段会被本函数**静默丢弃**——两个仅在该字段上不同的 relations
  // 会被判「无变更」，从而漏掉一次真实更正。
  const normalizeRelations = (rels) => {
    const list = Array.isArray(rels) ? rels : [];
    return list.map((rel) => {
      const source = rel !== null && typeof rel === "object" ? rel : {};
      return {
        relation_key: source.relation_key ?? null,
        object_uid: source.target?.object_uid ?? null,
        // 两处 commit 来源都要投影：target.commit（02 §8.1 解药形态）与
        // evidence_locator.commit（附加定位）。只投影其一会让「仅改另一处 commit」
        // 的真实变更被判成无变更。
        target_commit: source.target?.commit ?? null,
        locator_commit: source.evidence_locator?.commit ?? null,
      };
    });
  };
  const relationsUnchanged = JSON.stringify(normalizeRelations(next.relations))
    === JSON.stringify(normalizeRelations(fm.relations));
  if (bodyUnchanged && relationsUnchanged && removedFields.length === 0) {
    return failure("friction/no_op", "correction would change neither the body nor the relations — 02 §10.5 不记录 no-op；refusing to append a change_log entry that claims a correction happened");
  }

  // 变更摘要内嵌授权文本（审核发现②：授权须逐字留痕，不能只「必填」后丢弃）。
  // 措辞对齐 21 号 correct，便于读者识别这是「终态事实更正」而非一次状态推进。
  next.change_log = [...(fm.change_log ?? []), {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: `事实更正（非状态转换）——${changeSummary}。终态判定未变：status/title/phenomenon/impact/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter（唯一例外：2026-10 起可显式删除已退出类型闭集的字段，本次删除：${removedFields.length > 0 ? removedFields.join("、") : "无"}），不得新增或改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：${humanAuthorization.trim()}`,
  }];
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(next, body);
  await atomicWriteFile(filePath, content);
  return success({ fingerprint: fileFingerprint(content) });
}

// ---------------------------------------------------------------------------
// List / F0–F1 discovery (specs/03 §8, specs/26 §12)
// ---------------------------------------------------------------------------

/**
 * Enumerate Friction objects (F0/F1: deterministic filter + minimal
 * projection). Default status filter: open + observing (26 §12: observing 是
 * 活账——攒够待修的候选源；resolved 与 voided 均为终态，仅精确引用/历史追溯
 * 时展开)；includeResolved（历史命名，语义为「含全部终态」）includes all.
 * Files that fail to parse are reported in `invalid` — never skipped silently.
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
    // 26 §12：默认候选含 open 与 observing；resolved 与 voided 为终态，仅在
    // 「精确引用/历史追溯」时展开。参数名 includeResolved 沿用历史命名，其实际
    // 语义是「包含全部终态」（resolved + voided）——两个终态一并由此开关控制。
    if (!includeResolved && (status === "resolved" || status === "voided")) continue;
    items.push({
      object_uid: uid,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      impact: typeof frontmatter.impact === "string" ? frontmatter.impact : "",
      attribution: typeof frontmatter.attribution === "string" ? frontmatter.attribution : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  // Newest first — the natural order for dedup scans and resumption.
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}

// Exported for the schema/writer agreement guard (test/schema-writer-agreement.test.mjs):
// the tool-plane JSON Schema must admit every field this closed set accepts, and a
// field added here without a matching schema entry is unreachable via the tools.
export { VALID_FM_KEYS };
// 导出状态闭集供类型契约测试断言（test/friction-four-state.test.mjs）：闭集是
// 26 §9 的机械口径，测试必须对着它而非复制一份字面量，否则规范与代码同时漂移。
export { STATUSES as STATUSES_EXPORT_FOR_TEST };
