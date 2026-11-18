
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter, uidRejectionHint } from "./after-integrity.js";
import { scanCarrierDirectory } from "./carrier-scan.js";
import { h2Titles, countAtxHeadings, sectionContent } from "./markdown-structure.js";
import { parseObjectIdentifier, resolveShortId } from "./object-identifier.js";
import { carrierCoherenceMessage } from "./coherence-report.js";


const PITFALL_TYPE_KEY = "pitfall";

export const PITFALL_DIRECTORY = "pitfalls";

const BODY_H2_REQUIRED = ["症状", "触发条件", "根因", "解决", "规避", "验证", "影响与适用范围"];
const BODY_H2_EVIDENCE = "证据";

const STATUSES = new Set(["active", "discarded"]);

const MAX_TITLE_LENGTH = 30;

const MAX_DISPOSITION_LENGTH = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "scope", "trigger_signal", "urls", "disposition", "change_log", ]);

export const PITFALL_REMOVABLE_FIELDS = new Set(["urls", "trigger_signal"]);


function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}


export function validatePitfallFrontmatter(frontmatter) {
  const issues = [];

  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 25 §8)`);
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
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (25 §8), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  if (typeof frontmatter.scope !== "string" || frontmatter.scope.length === 0) {
    issues.push("scope: required non-empty string");
  }

  if (frontmatter.trigger_signal !== undefined) {
    if (typeof frontmatter.trigger_signal !== "string" || frontmatter.trigger_signal.length === 0) {
      issues.push("trigger_signal: when present must be a non-empty string (03 §6.1 — omit when not applicable)");
    }
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

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

  if (frontmatter.status === "discarded") {
    if (typeof frontmatter.disposition !== "string" || frontmatter.disposition.length === 0) {
      issues.push("disposition: required non-empty when status=discarded (25 §8)");
    } else if (frontmatter.disposition.length > MAX_DISPOSITION_LENGTH) {
      issues.push(`disposition: must be ≤ ${MAX_DISPOSITION_LENGTH} characters (25 §9.1), got ${frontmatter.disposition.length}`);
    }
  } else if (frontmatter.disposition !== undefined) {
    issues.push(`disposition: must not be present when status=${frontmatter.status} (25 §8: disposition ⇔ discarded)`);
  }

  if (Array.isArray(frontmatter.change_log)) {
    for (const [i, entry] of frontmatter.change_log.entries()) {
      if (typeof entry !== "object" || entry === null) continue;
      if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
        issues.push(`change_log[${i}].summary: required non-empty (02 §10.5: 摘要缺失或为空时，写入不成立)`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}



export function validatePitfallBodyStructure(body, title, urlsCount) {
  const issues = [];
  const expectEvidence = urlsCount > 0;
  const expectedH2 = [...BODY_H2_REQUIRED];
  if (expectEvidence) expectedH2.push(BODY_H2_EVIDENCE);

  const lines = body.split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty.trimEnd().replace(/^ {0,3}/, "").replace(/(?<=^#+)[ \t]+/, " ") !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 25 §8)`);
  }
  const h1Count = countAtxHeadings(body, 1);
  if (h1Count !== 1) {
    issues.push(`body: expected exactly 1 H1 heading, found ${h1Count} (25 §8: H1 由 Code 从 title 生成，正文自 H2 起)`);
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

  const sections = body.split(/^## /m).slice(1);
  for (const sec of sections) {
    const secTitle = sec.split("\n")[0].trim();
    const content = sec.slice(sec.indexOf("\n") + 1).trim();
    if (content.length === 0) issues.push(`body: section "${secTitle}" is empty`);
  }

  const hasEvidenceH2 = h2.includes(BODY_H2_EVIDENCE);
  if (hasEvidenceH2 !== expectEvidence) {
    issues.push(`body: "## 证据" section presence (${hasEvidenceH2}) must match non-empty urls (${expectEvidence}) — 25 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

export function validateCarrierCoherence(frontmatter, body) {
  const warnings = [];
  const text = typeof frontmatter.scope === "string" ? frontmatter.scope.trim() : "";
  if (text.length === 0) return { ok: true, issues: [], warnings };
  const content = sectionContent(body, "影响与适用范围");
  if (content === null) return { ok: true, issues: [], warnings };
  if (!content.includes(text)) {
    warnings.push(carrierCoherenceMessage({
      section: "影响与适用范围", field: "scope", declared: text, actual: content,
      clause: "25 §8, §14.1",
    }));
  }
  return { ok: true, issues: [], warnings };
}


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

function assertValidUid(objectUid) {
  return typeof objectUid === "string" && UUID_PATTERN.test(objectUid);
}

function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.trim()}`;
}

function urlsCount(frontmatter) {
  return Array.isArray(frontmatter.urls) ? frontmatter.urls.length : 0;
}


export async function createPitfallObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 症状'; the H1 is generated from title)");
  }

  const uid = randomUUID();
  const now = new Date().toISOString();
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = PITFALL_TYPE_KEY;
  frontmatter.created_at = now;
  const requestedStatus = frontmatter.status;
  if (requestedStatus === undefined || requestedStatus === null) {
    return failure("pitfall/status_required", "create must state status explicitly: status=active (25 §13 — both the Human entry and the 25 §13 main-controller channel create active; the draft candidate state was cancelled 2026-11-03). Omission is refused: there is no default, because the caller must state which decision this creation carries (25 §8/§13/§16)");
  }
  if (requestedStatus !== "active") {
    return failure("pitfall/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(requestedStatus)} (25 §9/§13: active is the only initial state — the draft candidate state was cancelled 2026-11-03)`);
  }
  frontmatter.status = requestedStatus;
  if (frontmatter.disposition !== undefined) {
    return failure("pitfall/frontmatter_invalid", "create must not carry disposition (25 §8: disposition ⇔ discarded)");
  }
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Pitfall 对象",
  }];

  const fmCheck = validatePitfallFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("pitfall/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validatePitfallBodyStructure(body, frontmatter.title, urlsCount(frontmatter));
  if (!bodyCheck.ok) {
    return failure("pitfall/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  const typeDir = join(factSourceRoot, PITFALL_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  const fingerprint = fileFingerprint(content);
  return success({ object_uid: uid, file: filePath, fingerprint });
}


async function resolvePitfallObjectUid(factSourceRoot, input, currentProjectId = null) {
  const parsed = parseObjectIdentifier(input);
  if (!parsed.ok) {
    return { ok: false, error: failure("pitfall/invalid_uid", `${parsed.error.code}: ${parsed.error.message}`) };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  if (projectId !== undefined && currentProjectId !== null && projectId !== currentProjectId) {
    return { ok: false, error: failure("pitfall/invalid_uid", `foreign_project: identifier targets project "${projectId}", but this session is governed by "${currentProjectId}" — cross-project reads are not supported by this entry`) };
  }
  if (objectUid !== undefined) {
    if (declaredType !== undefined && declaredType !== "pitfall") {
      return { ok: false, error: failure("pitfall/invalid_uid", `type_prefix_mismatch: identifier declares type "${declaredType}", but this entry reads "pitfall" objects`) };
    }
    return { ok: true, objectUid };
  }
  const resolved = await resolveShortId({ factSourceRoot, shortId, declaredType: declaredType ?? "pitfall" });
  if (!resolved.ok) {
    const extra = resolved.error.candidates === undefined ? "" : `; candidates: ${resolved.error.candidates.join(", ")}`;
    return { ok: false, error: failure("pitfall/invalid_uid", `${resolved.error.code}: ${resolved.error.message}${extra}`) };
  }
  if (resolved.value.factTypeKey !== "pitfall") {
    return { ok: false, error: failure("pitfall/invalid_uid", `type_prefix_mismatch: short id "${shortId}" resolves to a ${resolved.value.factTypeKey} object, but this entry reads "pitfall" objects`) };
  }
  return { ok: true, objectUid: resolved.value.objectUid };
}

export async function readPitfallObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, currentProjectId = null } = args;
  const uidResolution = await resolvePitfallObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
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


export async function updatePitfallObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("pitfall/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(objectUid)) {
    const hint = uidRejectionHint(objectUid);
    return failure("pitfall/invalid_uid", `objectUid must be a valid UUID${hint.messageSuffix}`, hint.details);
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 症状')");
  }

  const current = await readPitfallObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("pitfall/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  const prevStatus = current.value.frontmatter.status;
  if (prevStatus === "discarded") {
    const requested = frontmatterAfter?.status;
    if (requested !== undefined && requested !== prevStatus) {
      return failure("pitfall/status_terminal", `status=discarded is terminal; reopen (status=${requested}) is forbidden (25 §9.2) — content correction via §9.3 is allowed, status reversal is not; a substantively changed mechanism goes through a NEW Pitfall object`);
    }
  }

  const built = buildUpdateFrontmatter({
    currentFrontmatter: current.value.frontmatter,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: PITFALL_REMOVABLE_FIELDS,
    typeLabel: "pitfall",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const fm = built.value;
  fm.object_uid = objectUid;
  fm.fact_type_key = PITFALL_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("pitfall/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (active/discarded, 25 §9)`);
  }

  if (prevStatus !== nextStatus) {
    const legal = prevStatus === "active" && nextStatus === "discarded";
    if (!legal) {
      return failure("pitfall/status_transition_invalid", `illegal status transition ${prevStatus} → ${nextStatus} (25 §9.2: the only legal transition is active→discarded)`);
    }
  }

  if (nextStatus === "active") {
    if (fm.disposition !== undefined) {
      return failure("pitfall/frontmatter_invalid", `disposition must not be present while status=${nextStatus} (25 §8: disposition ⇔ discarded)`);
    }
  }

  if (nextStatus === prevStatus) {
    if ((fm.scope ?? "") !== (current.value.frontmatter.scope ?? "")) {
      return failure(
        "pitfall/supplement_boundary",
        `scope changed on a same-status update (${prevStatus}→${nextStatus}) — that is a real impact-range change, not an errata/supplement: create a NEW Pitfall object (25 §9.3)`,
      );
    }
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  const fmCheck = validatePitfallFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("pitfall/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const bodyCheck = validatePitfallBodyStructure(body, fm.title, urlsCount(fm));
  if (!bodyCheck.ok) {
    return failure("pitfall/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}


export async function listPitfallObjects(args) {
  const { factSourceRoot, includeTerminal = false, statusFilter, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (statusFilter !== undefined) {
    const wanted = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
    if (wanted.length === 0 || !wanted.every((s) => STATUSES.has(s))) {
      return failure("invalid_request", `statusFilter must be a non-empty subset of the closed set (active/discarded, 25 §9); got ${JSON.stringify(statusFilter)}`);
    }
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }

  const typeDir = join(factSourceRoot, PITFALL_DIRECTORY);
  let scanned;
  try {
    scanned = await scanCarrierDirectory(typeDir, "pitfall");
  } catch (error) {
    return failure("pitfall/directory_unavailable", `cannot read pitfalls directory: ${error.message}`);
  }
  if (scanned.missing) {
    return success({ items: [], total: 0, complete: true, invalid: [] });
  }

  const invalid = [...scanned.invalid];
  const items = [];
  for (const carrier of scanned.carriers) {
    const uid = carrier.uid;
    const content = carrier.content;
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) {
      invalid.push({ file: carrier.file, reason: "no YAML frontmatter block" });
      continue;
    }
    let frontmatter;
    try {
      frontmatter = parseYaml(fmMatch[1]);
    } catch (error) {
      invalid.push({ file: carrier.file, reason: `frontmatter parse error: ${error.message}` });
      continue;
    }
    const status = frontmatter.status;
    if (!STATUSES.has(status)) {
      invalid.push({ file: carrier.file, reason: `status ${JSON.stringify(status)} outside the closed set` });
      continue;
    }
    if (statusFilter !== undefined) {
      const wanted = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
      if (!wanted.includes(status)) continue;
    } else if (!includeTerminal && status !== "active") {
      continue;
    }
    items.push({
      object_uid: uid,
      fact_type_key: typeof frontmatter.fact_type_key === "string" ? frontmatter.fact_type_key : PITFALL_TYPE_KEY,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      scope: typeof frontmatter.scope === "string" ? frontmatter.scope : "",
      trigger_signal: typeof frontmatter.trigger_signal === "string" ? frontmatter.trigger_signal : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}

export { VALID_FM_KEYS };
