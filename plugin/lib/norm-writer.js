
import { assuranceSummaryOf } from "./norm-assurance.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";
import { sectionContent } from "./markdown-structure.js";
import { repairedLengthMessage } from "./write-diagnostics.js";
import { normPositioningOf } from "./norm-positioning.js";
import { ID_PATTERN } from "./spec-registry.js";
import { parseObjectIdentifier, resolveShortId } from "./object-identifier.js";


const NORM_TYPE_KEY = "norm";

export const NORM_DIRECTORY = "norms";

const BODY_H2_REQUIRED = ["方向定位与适用范围", "核心规则体系", "约束与反模式", "验证与遵从性检查"];

const STATUSES = new Set(["active", "retired"]);

const RETIREMENT_REASONS = new Set(["superseded", "outdated", "out-of-scope"]);

const MAX_TITLE_LENGTH = 40;

export const ERR_DIRECTION_ALREADY_EXISTS = "ERR_DIRECTION_ALREADY_EXISTS";

const DIRECTION_KEY_PATTERN = ID_PATTERN;

const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "direction_key", "retirement_reason", "retired_at", "change_log",
]);

export const NORM_REMOVABLE_FIELDS = new Set([]);


function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}


export function validateNormFrontmatter(frontmatter) {
  const issues = [];

  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 23 §8)`);
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
    issues.push(repairedLengthMessage("title", frontmatter.title, MAX_TITLE_LENGTH, "23 §8"));
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  if (typeof frontmatter.direction_key !== "string" || frontmatter.direction_key.length === 0) {
    issues.push("direction_key: required non-empty string (23 §8)");
  } else if (!DIRECTION_KEY_PATTERN.test(frontmatter.direction_key)) {
    issues.push(`direction_key: must match ${DIRECTION_KEY_PATTERN} (01.Att.02 §2 identifier format, full-string match; 23 §8/§13.1), got ${JSON.stringify(frontmatter.direction_key)}`);
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")} (23 §8.1)`);
  }

  if (frontmatter.status === "active") {
    if (frontmatter.retirement_reason !== undefined) {
      issues.push("retirement_reason: must not be present when status=active (23 §8/§13.1)");
    }
    if (frontmatter.retired_at !== undefined) {
      issues.push("retired_at: must not be present when status=active (23 §8/§13.1)");
    }
  } else if (frontmatter.status === "retired") {
    if (typeof frontmatter.retirement_reason !== "string" || frontmatter.retirement_reason.length === 0) {
      issues.push("retirement_reason: required when status=retired (23 §8/§13.1)");
    } else if (!RETIREMENT_REASONS.has(frontmatter.retirement_reason)) {
      issues.push(`retirement_reason: must be one of ${[...RETIREMENT_REASONS].join("/")} (23 §8.1), got ${JSON.stringify(frontmatter.retirement_reason)}`);
    }
    if (typeof frontmatter.retired_at !== "string" || frontmatter.retired_at.length === 0) {
      issues.push("retired_at: required when status=retired (Code-assigned, 23 §8)");
    }
  }

  if (frontmatter.relations !== undefined) {
    issues.push("relations: Norm does not use the relations field (23 §9)");
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
      issues.push(`body: missing required H2 section "## ${section}" (23 §8 four-section skeleton)`);
    } else if (content.trim().length === 0) {
      issues.push(`body: H2 section "${section}" must be non-empty (23 §8)`);
    }
  }
  return { ok: issues.length === 0, issues };
}


export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const declared = body.match(/direction_key:\s*([a-z0-9-]+)/);
  if (declared !== null && declared[1] !== frontmatter.direction_key) {
    issues.push(`carrier coherence: body mentions direction_key "${declared[1]}" but frontmatter declares "${frontmatter.direction_key}" (frontmatter is the single authoritative text, 23 §7)`);
  }
  return { ok: issues.length === 0, issues };
}


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

function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.trim()}`;
}


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
        direction_key: parsed.frontmatter.direction_key,
        title: typeof parsed.frontmatter.title === "string" ? parsed.frontmatter.title : null,
        status: parsed.frontmatter.status
      });
    }
  }
  return { ok: true, active, unreadable };
}

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

async function checkDirectionKeyExclusive(factSourceRoot, directionKey, selfUid) {
  const listed = await listActiveDirectionKeys(factSourceRoot);
  if (!listed.ok) {
    return failure("norm/scan_failed", `cannot scan ${NORM_DIRECTORY}/ for the uniqueness pre-check: ${listed.reason}`);
  }
  const conflicts = listed.active.filter((entry) => entry.direction_key === directionKey && entry.object_uid !== selfUid);
  if (conflicts.length > 0) {
    return failure(ERR_DIRECTION_ALREADY_EXISTS, `an active Norm already carries direction_key "${directionKey}" (23 §11 uniqueness: Count(direction_key=d ∧ status="active") ≤ 1); take the controlled-update path on the existing Norm, or retire it and create a new one`, { direction_key: directionKey, conflicts });
  }
  return success({ active: listed.active, unreadable: listed.unreadable });
}


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

  if (frontmatter.status !== undefined && frontmatter.status !== "active") {
    return failure("norm/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(frontmatter.status)} (23 §8.1 — 合法初态唯一)`);
  }
  frontmatter.status = "active";
  if (frontmatter.retirement_reason !== undefined || frontmatter.retired_at !== undefined) {
    return failure("norm/frontmatter_invalid", "create must not carry retirement_reason/retired_at (23 §8: terminal fields accompany status=retired only)");
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

  const exclusivity = await checkDirectionKeyExclusive(factSourceRoot, frontmatter.direction_key, uid);
  if (!exclusivity.ok) return exclusivity;

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validateNormBodyStructure(body, frontmatter.title);
  if (!bodyCheck.ok) {
    return failure("norm/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  const typeDir = join(factSourceRoot, NORM_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: uid, file: filePath, fingerprint: fileFingerprint(content), assurance: assuranceSummaryOf(bodyMarkdown) });
}


export async function resolveNormObjectUid(factSourceRoot, input, currentProjectId = null) {
  const parsed = parseObjectIdentifier(input);
  if (!parsed.ok) {
    return { ok: false, error: failure("norm/invalid_uid", `${parsed.error.code}: ${parsed.error.message}`) };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  if (projectId !== undefined && currentProjectId !== null && projectId !== currentProjectId) {
    return { ok: false, error: failure("norm/invalid_uid", `foreign_project: identifier targets project "${projectId}", but this session is governed by "${currentProjectId}" — cross-project reads are not supported by this entry`) };
  }
  if (objectUid !== undefined) {
    if (declaredType !== undefined && declaredType !== "norm") {
      return { ok: false, error: failure("norm/invalid_uid", `type_prefix_mismatch: identifier declares type "${declaredType}", but this entry reads "norm" objects`) };
    }
    return { ok: true, objectUid };
  }
  const resolved = await resolveShortId({ factSourceRoot, shortId, declaredType: declaredType ?? "norm" });
  if (!resolved.ok) {
    const extra = resolved.error.candidates === undefined ? "" : `; candidates: ${resolved.error.candidates.join(", ")}`;
    return { ok: false, error: failure("norm/invalid_uid", `${resolved.error.code}: ${resolved.error.message}${extra}`) };
  }
  if (resolved.value.factTypeKey !== "norm") {
    return { ok: false, error: failure("norm/invalid_uid", `type_prefix_mismatch: short id "${shortId}" resolves to a ${resolved.value.factTypeKey} object, but this entry reads "norm" objects`) };
  }
  return { ok: true, objectUid: resolved.value.objectUid };
}

export async function readNormObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, currentProjectId = null } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  const uidResolution = await resolveNormObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
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


export async function updateNormObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, expectedFingerprint, frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary, sessionSignature = null, currentProjectId = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  const uidResolution = await resolveNormObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("norm/change_summary_required", "changeSummary is required for update (specs/02 :331: exactly one change_log entry per actual modification)");
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return failure("norm/not_found", `no Norm carrier at ${filePath}`);
    return failure("norm/read_failed", String(error?.message || error));
  }

  const baselineFingerprint = fileFingerprint(raw);
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return failure("norm/fingerprint_required", "expectedFingerprint is required (specs/02 :333 CAS baseline)");
  }
  if (expectedFingerprint !== baselineFingerprint) {
    return failure("norm/fingerprint_mismatch", `CAS baseline mismatch: expected ${expectedFingerprint}, current ${baselineFingerprint}`, { current_fingerprint: baselineFingerprint });
  }

  const parsed = splitFrontmatter(raw);
  if (!parsed.ok) return failure("norm/carrier_invalid", `${filePath}: ${parsed.reason}`);
  const before = parsed.frontmatter;

  if (before.status === "retired") {
    return failure("norm/terminal_readonly", `object is status=retired; 23 §8.1 forbids any transition out of retired`);
  }

  if (frontmatterAfter !== null && frontmatterAfter !== undefined && typeof frontmatterAfter !== "object") {
    return failure("invalid_request", "frontmatterAfter must be an object when provided");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter (complete target body markdown) is required for update");
  }

  const now = new Date().toISOString();
  const built = buildUpdateFrontmatter({
    currentFrontmatter: before,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: NORM_REMOVABLE_FIELDS,
    typeLabel: "norm",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const next = built.value;
  next.object_uid = before.object_uid;
  next.fact_type_key = NORM_TYPE_KEY;
  next.created_at = before.created_at;
  next.direction_key = before.direction_key;

  const targetStatus = next.status ?? before.status;
  if (targetStatus !== "active" && targetStatus !== "retired") {
    return failure("norm/frontmatter_invalid", `status: must be one of active/retired (23 §8.1), got ${JSON.stringify(targetStatus)}`);
  }
  next.status = targetStatus;

  let transition = "supplement";
  if (before.status === "active" && targetStatus === "active") {
    transition = "errata";
    if (frontmatterAfter.direction_key !== undefined && frontmatterAfter.direction_key !== before.direction_key) {
      return failure("norm/direction_key_immutable", `direction_key cannot change in place (23 §13.2): direction drift is a retire+create path, not an update`, { before: before.direction_key, after: frontmatterAfter.direction_key });
    }
  } else if (before.status === "active" && targetStatus === "retired") {
    transition = "retire";
    next.retired_at = now;
    if (next.retirement_reason === "superseded") {
      const listed = await listActiveDirectionKeys(factSourceRoot);
      if (!listed.ok) {
        return failure("norm/scan_failed", `cannot verify superseded successor: ${listed.reason}`);
      }
      const others = listed.active.filter((entry) => entry.object_uid !== objectUid);
      if (others.length === 0) {
        return failure("norm/superseded_unresolvable", `retirement_reason=superseded requires an existing active Norm to resolve as the successor, but no other active Norm exists (23 §8.1/§13.1)`);
      }
    }
  } else {
    return failure("norm/transition_invalid", `illegal transition ${before.status} → ${targetStatus} (23 §8.1: only active→active and active→retired exist)`);
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

  if (next.status === "active") {
    const exclusivity = await checkDirectionKeyExclusive(factSourceRoot, next.direction_key, objectUid);
    if (!exclusivity.ok) return exclusivity;
  }

  const body = bodyMarkdownAfter.trim();
  const bodyCheck = validateNormBodyStructure(body, next.title);
  if (!bodyCheck.ok) {
    return failure("norm/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }

  const content = buildFileContent(next, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: objectUid, file: filePath, fingerprint: fileFingerprint(content), transition, assurance: assuranceSummaryOf(body) });
}


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
  const servable = wanted.filter((item) => !collidingFiles.has(item.file));

  const projected = servable.map((item) => {
    const extracted = normPositioningOf(item.raw);
    return {
      object_uid: item.frontmatter.object_uid ?? null,
      fact_type_key: typeof item.frontmatter.fact_type_key === "string" ? item.frontmatter.fact_type_key : "",
      file: item.file,
      title: item.frontmatter.title ?? null,
      status: item.frontmatter.status ?? null,
      direction_key: item.frontmatter.direction_key ?? null,
      positioning: extracted.governs,
      when_to_read: extracted.whenToRead,
      positioning_status: extracted.available
        ? "ok"
        : `unavailable(${extracted.unavailable_reason}): 方向定位两句须各以 **管什么**：／**何时查阅**： 起首、各 ≤60 字、段内恰好两段且不含授权措辞或适用性断言（23 §8）；请用 ldvh_norm_read 读正文`,
      retirement_reason: item.frontmatter.retirement_reason ?? null,
      fingerprint: fileFingerprint(item.raw),
    };
  });
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
