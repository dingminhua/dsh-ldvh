/**
 * dsh-ldvh — Pitfall fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/23 §13 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/pitfalls/pitfall-<uid>.md) with YAML frontmatter +
 *             markdown body. Code assigns object_uid + created_at and
 *             generates the H1 from title; creation validates the
 *             type-specific mechanical checks (closed sets, fixed H2
 *             sections incl. conditional 证据, carrier coherence,
 *             urls⇒证据 presence).
 *  - read:    returns frontmatter + body + file-level content
 *             fingerprint (SHA-256).
 *  - update:  CAS — two guarded lanes (23 §9):
 *               * active→active = 勘误与补充级: scope must be
 *                 field-identical to the CAS baseline (机械比对；变了就
 *                 拒绝——影响范围实质变化走新对象)。The supplement/revision
 *                 boundary of the other sections is AI review scope
 *                 (root-cause compatibility judgement, 23 §9.3).
 *               * active→discarded = terminal transition: disposition
 *                 (non-empty) required.
 *             Terminal objects are read-only (23 §9.2 终态不重开).
 *
 * Carrier coherence (23 §8): frontmatter scope is the single
 * authoritative text — the 影响与适用范围 body section must contain it
 * verbatim and expand around it.
 *
 * Red lines honoured (23 §18): no draft state, no six-field frontmatter
 * (analysis lives in the body), no relations edges, no severity/priority.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature, resolveAuthoritativeSignature } from "./signature-channel.js";

// ---------------------------------------------------------------------------
// Constants (specs/23 §7, §8, §9)
// ---------------------------------------------------------------------------

const PITFALL_TYPE_KEY = "pitfall";

/** Directory under the fact-source root that carries Pitfall objects. */
export const PITFALL_DIRECTORY = "pitfalls";

/** Fixed body H2 sections (23 §8); 证据 is conditional on urls. */
const BODY_H2_REQUIRED = ["症状", "触发条件", "根因", "解决", "规避", "验证", "影响与适用范围"];
const BODY_H2_EVIDENCE = "证据";

const STATUSES = new Set(["active", "discarded"]);

/** Title cap (23 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** UUID format check (03 §6.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Closed set of frontmatter keys (23 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "scope", "trigger_signal", "urls", "disposition", "change_log",
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
// Validation (the mechanical slice of specs/23 §8, §9, §13, §14.1)
// ---------------------------------------------------------------------------

export function validatePitfallFrontmatter(frontmatter) {
  const issues = [];

  // Closed-set check (23 §8): unknown fields reject the object
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 23 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  if (frontmatter.fact_type_key !== PITFALL_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${PITFALL_TYPE_KEY}"`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (23 §8), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  if (typeof frontmatter.scope !== "string" || frontmatter.scope.length === 0) {
    issues.push("scope: required non-empty string");
  }

  // trigger_signal (23 §8): conditional — present means non-empty.
  if (frontmatter.trigger_signal !== undefined) {
    if (typeof frontmatter.trigger_signal !== "string" || frontmatter.trigger_signal.length === 0) {
      issues.push("trigger_signal: when present must be a non-empty string (03 §6.1 — omit when not applicable)");
    }
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

  // urls (23 §8/§10): conditional, non-empty when present, HTTP(S) refs;
  // source-traceability semantics follow 06 §5.
  if (frontmatter.urls !== undefined) {
    if (!Array.isArray(frontmatter.urls) || frontmatter.urls.length === 0) {
      issues.push("urls: when present must be a non-empty array (03 §6.1 — omit when not applicable)");
    } else {
      const refs = new Set();
      for (const u of frontmatter.urls) {
        if (typeof u !== "object" || u === null) {
          issues.push("urls[]: must be objects");
          continue;
        }
        if (typeof u.ref !== "string" || !u.ref.startsWith("http")) {
          issues.push(`urls[].ref: must be an absolute HTTP(S) URL, got ${JSON.stringify(u.ref)}`);
        }
        if (refs.has(u.ref)) issues.push(`urls[].ref: duplicate ref ${u.ref}`);
        refs.add(u.ref);
      }
    }
  }

  // disposition ⇔ terminal status (23 §8: 出现 ⇔ discarded)
  if (frontmatter.status === "active") {
    if (frontmatter.disposition !== undefined) {
      issues.push("disposition: must not be present when status=active (23 §8)");
    }
  } else {
    if (typeof frontmatter.disposition !== "string" || frontmatter.disposition.length === 0) {
      issues.push("disposition: required non-empty when status=discarded (23 §8)");
    }
  }

  return { ok: issues.length === 0, issues };
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
 * file body starting with the generated `# ${title}` H1 (23 §8).
 * 证据 section presence ⇔ urls non-empty (23 §8 conditional). Returns
 * { ok, issues }.
 */
export function validatePitfallBodyStructure(body, title, urlsCount) {
  const issues = [];
  const expectEvidence = urlsCount > 0;
  const expectedH2 = [...BODY_H2_REQUIRED];
  if (expectEvidence) expectedH2.push(BODY_H2_EVIDENCE);

  const lines = body.split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 23 §8)`);
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

  // 证据 H2 presence ⇔ non-empty urls (23 §8 conditional)
  const hasEvidenceH2 = h2.includes(BODY_H2_EVIDENCE);
  if (hasEvidenceH2 !== expectEvidence) {
    issues.push(`body: "## 证据" section presence (${hasEvidenceH2}) must match non-empty urls (${expectEvidence}) — 23 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (23 §8): frontmatter scope is the single authoritative
 * text — the 影响与适用范围 body section must contain it verbatim.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const text = typeof frontmatter.scope === "string" ? frontmatter.scope.trim() : "";
  if (text.length === 0) return { ok: true, issues }; // presence checked in validatePitfallFrontmatter
  const content = sectionContent(body, "影响与适用范围");
  if (content === null) return { ok: true, issues }; // section presence checked in body structure
  if (!content.includes(text)) {
    issues.push(`carrier coherence: 影响与适用范围 section must contain scope verbatim (frontmatter is the single authoritative text): "${text.slice(0, 40)}…"`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function pitfallFileName(uid) { return `pitfall-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, PITFALL_DIRECTORY, pitfallFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * 展示层输出序（同 spark/adr writer 约定）：语义块在前
 * （标题/状态/范围/信号/终态去向），引用与身份居后，change_log 沉底。
 * 只重排键序，不新增、不删除、不改值。
 */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status",
  "scope", "trigger_signal",
  "disposition",
  "urls",
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

/** Count urls entries (0 when absent). */
function urlsCount(frontmatter) {
  return Array.isArray(frontmatter.urls) ? frontmatter.urls.length : 0;
}

// ---------------------------------------------------------------------------
// Create (specs/03 §9.4 + specs/23 §13)
// ---------------------------------------------------------------------------

export async function createPitfallObject(args) {
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
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 症状'; the H1 is generated from title)");
  }

  // Code-assigned identity (03 §6.2)
  const uid = randomUUID();
  const now = new Date().toISOString();
  // Strip caller-only params (change_summary is a call argument, not object metadata)
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = PITFALL_TYPE_KEY;
  frontmatter.created_at = now;
  // 23 §9: 初态 active — create must never enter a terminal state
  if (frontmatter.status !== undefined && frontmatter.status !== "active") {
    return failure("pitfall/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(frontmatter.status)} (23 §9)`);
  }
  frontmatter.status = "active";
  // 23 §8: disposition cannot exist at creation
  if (frontmatter.disposition !== undefined) {
    return failure("pitfall/frontmatter_invalid", "create must not carry disposition (23 §8: disposition ⇔ discarded)");
  }
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Pitfall 对象",
  }];

  // Validate
  const fmCheck = validatePitfallFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("pitfall/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // Body structure + carrier coherence (23 §8, §14.1)
  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validatePitfallBodyStructure(body, frontmatter.title, urlsCount(frontmatter));
  if (!bodyCheck.ok) {
    return failure("pitfall/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("pitfall/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }

  // Write (single flat file, atomic)
  const typeDir = join(factSourceRoot, PITFALL_DIRECTORY);
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

export async function readPitfallObject(args) {
  const { factSourceRoot, objectUid } = args;
  if (!assertValidUid(objectUid)) {
    return failure("pitfall/invalid_uid", "objectUid must be a valid UUID");
  }
  const filePath = objectFilePath(factSourceRoot, objectUid);

  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    return failure("pitfall/object_not_found", `cannot read object file: ${error.message}`);
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("pitfall/object_invalid", "file has no YAML frontmatter block");
  }

  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("pitfall/object_invalid", `frontmatter parse error: ${error.message}`);
  }

  const body = content.slice(fmMatch[0].length).trim();
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const structure = validatePitfallBodyStructure(body, title, urlsCount(frontmatter));

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
// Update via CAS (specs/03 §9.5 + specs/23 §9, §13)
// ---------------------------------------------------------------------------

export async function updatePitfallObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  // Human requirement 2026-09-12 + 03 §6.1 / 09 机械签名: a change_log entry is
  // signed BY CODE and may not be written unsigned. Without a branded carrier the
  // write is REFUSED; the caller reports it for Human handling (09 requires a
  // definite unavailable outcome for blank/historical sessions).
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("pitfall/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(objectUid)) {
    return failure("pitfall/invalid_uid", "objectUid must be a valid UUID");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 症状')");
  }

  const current = await readPitfallObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("pitfall/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  // 23 §9.2: terminal states are read-only (终态不重开；错误终态记录按 05
  // 事实更正修正，不是本入口的领域状态转换)
  const prevStatus = current.value.frontmatter.status;
  if (prevStatus === "discarded") {
    return failure("pitfall/status_terminal", "status=discarded is terminal and the object is read-only (23 §9.2); a substantively changed mechanism goes through a NEW Pitfall object");
  }

  // Build updated frontmatter; strip the call-only param
  const { change_summary: _stripped, ...afterFields } = frontmatterAfter;
  const fm = { ...afterFields };
  fm.object_uid = objectUid;
  fm.fact_type_key = PITFALL_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("pitfall/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (active/discarded, 23 §9)`);
  }

  // 23 §9.3 补充边界：active→active 更新是勘误与补充级——scope 必须与
  // CAS 基线逐字段一致（变了走新对象路径）。
  if (nextStatus === "active") {
    if ((fm.scope ?? "") !== (current.value.frontmatter.scope ?? "")) {
      return failure("pitfall/supplement_boundary", "scope changed on an active→active update — that is a real impact-range change, not an errata/supplement: create a NEW Pitfall object (23 §9.3)");
    }
    if (fm.disposition !== undefined) {
      return failure("pitfall/frontmatter_invalid", "disposition must not be present while status=active (23 §8)");
    }
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  // Validate
  const fmCheck = validatePitfallFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("pitfall/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // Body structure + carrier coherence on the updated object
  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const bodyCheck = validatePitfallBodyStructure(body, fm.title, urlsCount(fm));
  if (!bodyCheck.ok) {
    return failure("pitfall/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(fm, body);
  if (!coherenceCheck.ok) {
    return failure("pitfall/coherence_invalid", "carrier coherence failed on update", { issues: coherenceCheck.issues });
  }

  // Atomic single-file write
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}

// ---------------------------------------------------------------------------
// List / F0–F1 discovery (specs/03 §8, specs/23 §12)
// ---------------------------------------------------------------------------

/**
 * Enumerate Pitfall objects (F0/F1: deterministic filter + minimal
 * projection). Default status filter: active only (23 §12: discarded stays
 * out of ordinary candidates); includeTerminal includes all. Files that
 * fail to parse are reported in `invalid` — never skipped silently.
 */
export async function listPitfallObjects(args) {
  const { factSourceRoot, includeTerminal = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }

  const typeDir = join(factSourceRoot, PITFALL_DIRECTORY);
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return success({ items: [], total: 0, complete: true, invalid: [] });
    }
    return failure("pitfall/directory_unavailable", `cannot read pitfalls directory: ${error.message}`);
  }

  const invalid = [];
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const nameMatch = entry.name.match(/^pitfall-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i);
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
    if (!includeTerminal && status !== "active") continue;
    items.push({
      object_uid: uid,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      scope: typeof frontmatter.scope === "string" ? frontmatter.scope : "",
      trigger_signal: typeof frontmatter.trigger_signal === "string" ? frontmatter.trigger_signal : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  // Newest first — the natural order for dedup scans and resumption.
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}
