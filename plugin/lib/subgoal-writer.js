
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";
import { sectionContent } from "./markdown-structure.js";
import { repairedLengthMessage } from "./write-diagnostics.js";
import { readGoalObject } from "./goal-writer.js";
import { parseObjectIdentifier, resolveShortId } from "./object-identifier.js";
import { carrierCoherenceMessage } from "./coherence-report.js";


const SUBGOAL_TYPE_KEY = "subgoal";

export const SUBGOAL_DIRECTORY = "subgoals";

const PRECHECK_PLACEHOLDER_UID = "00000000-0000-4000-8000-000000000000";

const BODY_H2_REQUIRED = ["达成条件", "对齐说明"];

const STATUSES = new Set(["active", "achieved", "retired"]);

export const CRITERION_KINDS = new Set(["metric", "closure-records", "executable-check"]);

const MAX_TITLE_LENGTH = 40;

const MIN_ORDER = 1;

const PARENT_GOAL_KEY = "project-goal";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "order", "parent_goal",
  "status", "criterion", "criterion_kind", "alignment", "disposition", "created_at", "change_log",
]);

export const SUBGOAL_REMOVABLE_FIELDS = new Set(["anchor"]);


function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}


export function validateSubGoalFrontmatter(frontmatter) {
  const issues = [];

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
    issues.push(repairedLengthMessage("title", frontmatter.title.trim(), MAX_TITLE_LENGTH, "28 §8, same counting as 20 §9.1"));
  }

  if (frontmatter.order !== undefined) {
    if (typeof frontmatter.order !== "number" || !Number.isInteger(frontmatter.order) || frontmatter.order < MIN_ORDER) {
      issues.push(`order: must be a positive integer when present (28 §8 — 显示次序不承担引用职责，可缺失), got ${JSON.stringify(frontmatter.order)}`);
    }
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
  } else {
    for (const [i, entry] of frontmatter.change_log.entries()) {
      if (typeof entry !== "object" || entry === null) continue;
      if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
        issues.push(`change_log[${i}].summary: required non-empty (02 §10.5: 摘要缺失或为空时，写入不成立)`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

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

export function validateCarrierCoherence(frontmatter, body) {
  const warnings = [];
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
      warnings.push(carrierCoherenceMessage({
        section, field, declared: text, actual: content, clause: "28 §8 字段间不变量 1",
      }));
    }
  }
  return { ok: true, issues: [], warnings };
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

function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.trim()}`;
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


export async function listSubGoalIndex(factSourceRoot) {
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
    items.push({
      file: entry.name,
      object_uid: typeof parsed.frontmatter.object_uid === "string" ? parsed.frontmatter.object_uid : null,
      order: typeof parsed.frontmatter.order === "number" ? parsed.frontmatter.order : null,
      status: parsed.frontmatter.status ?? null,
      title: typeof parsed.frontmatter.title === "string" ? parsed.frontmatter.title : null,
    });
  }
  return { ok: true, items, unreadable };
}

async function checkUidExclusive(factSourceRoot, objectUid) {
  const listed = await listSubGoalIndex(factSourceRoot);
  if (!listed.ok) {
    return failure("subgoal/scan_failed", `cannot scan ${SUBGOAL_DIRECTORY}/ for the identity uniqueness pre-check: ${listed.reason}`);
  }
  if (listed.unreadable.length > 0) {
    return failure("subgoal/identity_unverifiable", `cannot prove object_uid "${objectUid}" is unique: ${listed.unreadable.length} carrier(s) under ${SUBGOAL_DIRECTORY}/ cannot be parsed (28 §17 第 5 项)`, { unreadable: listed.unreadable });
  }
  const conflicts = listed.items.filter((entry) => entry.object_uid === objectUid);
  if (conflicts.length > 1) {
    return failure("subgoal/identity_duplicated", `object_uid "${objectUid}" appears on ${conflicts.length} carriers — 两处权威 (28 §17 第 5 项)`, { conflicts });
  }
  return success({ items: listed.items });
}

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


function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function computeSubGoalCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown) {
  const { status: _statusStripped, ...draftFields } = frontmatterDraft ?? {};
  const candidate = {
    frontmatter_draft: draftFields,
    body_markdown: typeof bodyMarkdown === "string" ? bodyMarkdown : null,
  };
  return createHash("sha256").update(stableStringify(candidate), "utf8").digest("hex");
}

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
  frontmatter.object_uid = objectUid ?? PRECHECK_PLACEHOLDER_UID;
  frontmatter.fact_type_key = SUBGOAL_TYPE_KEY;
  frontmatter.created_at = now;

  if (frontmatter.status !== undefined && frontmatter.status !== "active") {
    return failure("subgoal/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(frontmatter.status)} (28 §9.2 — 合法初态唯一)`);
  }
  frontmatter.status = "active";
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

  const parent = await resolveParentGoal(factSourceRoot);
  if (!parent.ok) return parent;

  const exclusivity = await checkUidExclusive(factSourceRoot, objectUid);
  if (!exclusivity.ok) return exclusivity;

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validateSubGoalBodyStructure(body, frontmatter.title);
  if (!bodyCheck.ok) {
    return failure("subgoal/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  return success({ frontmatter, body });
}

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

  if (typeof expectedCandidateFingerprint !== "string" || expectedCandidateFingerprint.length === 0) {
    return failure(
      "subgoal/candidate_fingerprint_required",
      "expectedCandidateFingerprint is required for create (28 §13: 写入请求未携带该指纹的，按「同一性未确认」零写入) — "
        + "run ldvh_subgoal_precheck_create on this candidate first and pass the candidate_fingerprint it returns",
    );
  }
  {
    const actual = computeSubGoalCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
    if (actual !== expectedCandidateFingerprint) {
      return failure(
        "subgoal/candidate_changed",
        "the candidate content changed between precheck and write; the precheck verdict does not carry over (28 §13) — re-run the precheck on the current content",
        { expected_candidate_fingerprint: expectedCandidateFingerprint, actual_candidate_fingerprint: actual },
      );
    }
  }

  const evaluated = await evaluateCreateCandidate({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    signature: sig.signature,
    objectUid: uid,
  });
  if (!evaluated.ok) return evaluated;

  const { frontmatter, body } = evaluated.value;
  const typeDir = join(factSourceRoot, SUBGOAL_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: uid, file: filePath, fingerprint: fileFingerprint(content) });
}


export async function resolveSubGoalObjectUid(factSourceRoot, input, currentProjectId = null) {
  const parsed = parseObjectIdentifier(input);
  if (!parsed.ok) {
    return { ok: false, error: failure("subgoal/invalid_uid", `${parsed.error.code}: ${parsed.error.message}`) };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  if (projectId !== undefined && currentProjectId !== null && projectId !== currentProjectId) {
    return { ok: false, error: failure("subgoal/invalid_uid", `foreign_project: identifier targets project "${projectId}", but this session is governed by "${currentProjectId}" — cross-project reads are not supported by this entry`) };
  }
  if (objectUid !== undefined) {
    if (declaredType !== undefined && declaredType !== "subgoal") {
      return { ok: false, error: failure("subgoal/invalid_uid", `type_prefix_mismatch: identifier declares type "${declaredType}", but this entry reads "subgoal" objects`) };
    }
    return { ok: true, objectUid };
  }
  const resolved = await resolveShortId({ factSourceRoot, shortId, declaredType: declaredType ?? "subgoal" });
  if (!resolved.ok) {
    const extra = resolved.error.candidates === undefined ? "" : `; candidates: ${resolved.error.candidates.join(", ")}`;
    return { ok: false, error: failure("subgoal/invalid_uid", `${resolved.error.code}: ${resolved.error.message}${extra}`) };
  }
  if (resolved.value.factTypeKey !== "subgoal") {
    return { ok: false, error: failure("subgoal/invalid_uid", `type_prefix_mismatch: short id "${shortId}" resolves to a ${resolved.value.factTypeKey} object, but this entry reads "subgoal" objects`) };
  }
  return { ok: true, objectUid: resolved.value.objectUid };
}

export async function readSubGoalObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, currentProjectId = null } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  const uidResolution = await resolveSubGoalObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
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


export async function updateSubGoalObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, expectedFingerprint, frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary, sessionSignature = null, currentProjectId = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  const uidResolution = await resolveSubGoalObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
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
  next.object_uid = before.object_uid;
  next.fact_type_key = SUBGOAL_TYPE_KEY;
  next.created_at = before.created_at;

  const targetStatus = next.status ?? before.status;
  if (!STATUSES.has(targetStatus)) {
    return failure("subgoal/frontmatter_invalid", `status: must be one of active/achieved/retired (28 §9), got ${JSON.stringify(targetStatus)}`);
  }
  next.status = targetStatus;

  let transition = "supplement";
  if (before.status === "active" && targetStatus === "active") {
    transition = "supplement";
  } else if (before.status === "active" && targetStatus === "achieved") {
    transition = "achieve";
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

  const exclusivity = await checkUidExclusive(factSourceRoot, objectUid);
  if (!exclusivity.ok) return exclusivity;

  const body = bodyMarkdownAfter.trim();
  const bodyCheck = validateSubGoalBodyStructure(body, next.title);
  if (!bodyCheck.ok) {
    return failure("subgoal/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }

  const content = buildFileContent(next, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: objectUid, file: filePath, fingerprint: fileFingerprint(content), transition });
}


export async function resolveSubGoal(factSourceRoot, objectUid) {
  if (typeof objectUid !== "string" || !UUID_PATTERN.test(objectUid)) {
    return failure("subgoal/serves_shape_invalid", `serves must be a SubGoal object_uid (canonical UUIDv4, 28 §12.3), got ${JSON.stringify(objectUid)}`);
  }
  const listed = await listSubGoalIndex(factSourceRoot);
  if (!listed.ok) {
    return failure("subgoal/scan_failed", `cannot scan ${SUBGOAL_DIRECTORY}/ to resolve ${objectUid}: ${listed.reason}`);
  }
  if (listed.unreadable.length > 0) {
    return failure("subgoal/identity_unverifiable", `cannot resolve ${objectUid}: ${listed.unreadable.length} carrier(s) under ${SUBGOAL_DIRECTORY}/ cannot be parsed (28 §12.3)`, { unreadable: listed.unreadable });
  }
  const matches = listed.items.filter((entry) => entry.object_uid === objectUid);
  if (matches.length === 0) {
    return failure("subgoal/serves_unresolvable", `serves ${objectUid} does not resolve to any SubGoal object under ${SUBGOAL_DIRECTORY}/ (28 §12.3)`, { available: listed.items.map((e) => e.object_uid) });
  }
  if (matches.length > 1) {
    return failure("subgoal/identity_duplicated", `object_uid ${objectUid} resolves to ${matches.length} SubGoal objects — 两处权威 (28 §17 第 5 项)`, { matches });
  }
  const target = matches[0];
  if (target.status === "retired") {
    return failure("subgoal/serves_unresolvable", `serves ${objectUid} resolves to a retired SubGoal; a retired sub-goal is not a valid target for a NEW serves declaration (28 §12.3 第 3 条; 既有声明保留原值走局部重批)`, { status: target.status });
  }
  return success({ object_uid: target.object_uid, status: target.status, title: target.title, order: target.order, file: target.file });
}

export function compareByDisplayOrder(a, b) {
  const ao = typeof a.order === "number" ? a.order : Number.POSITIVE_INFINITY;
  const bo = typeof b.order === "number" ? b.order : Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  const ac = typeof a.created_at === "string" ? a.created_at : "";
  const bc = typeof b.created_at === "string" ? b.created_at : "";
  if (ac !== bc) return ac < bc ? -1 : 1;
  return String(a.object_uid ?? "").localeCompare(String(b.object_uid ?? ""));
}

export async function listResolvableSubGoals(factSourceRoot) {
  const listed = await listSubGoalIndex(factSourceRoot);
  if (!listed.ok) return failure("subgoal/scan_failed", listed.reason);
  const items = listed.items
    .filter((entry) => entry.status === "active" || entry.status === "achieved")
    .sort(compareByDisplayOrder)
    .map((entry) => ({ object_uid: entry.object_uid, title: entry.title, order: entry.order, status: entry.status }));
  return success({ items, unreadable: listed.unreadable });
}


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
      order: fm.order,
      parent_goal: fm.parent_goal,
      status: fm.status,
      criterion: fm.criterion,
      criterion_kind: fm.criterion_kind,
      alignment: fm.alignment,
      disposition: fm.disposition,
      created_at: fm.created_at,
      file: entry.name,
    });
  }

  items.sort(compareByDisplayOrder);

  const total = items.length;
  return success({ total, items: items.slice(0, limit), unreadable });
}

export { SUBGOAL_TYPE_KEY, BODY_H2_REQUIRED, STATUSES, MAX_TITLE_LENGTH, VALID_FM_KEYS, PARENT_GOAL_KEY };
