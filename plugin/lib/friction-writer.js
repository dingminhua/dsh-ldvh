
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";
import { scanCarrierDirectory } from "./carrier-scan.js";
import { h2Titles, sectionContent } from "./markdown-structure.js";
import { repairedLengthMessage } from "./write-diagnostics.js";
import { parseObjectIdentifier, resolveShortId } from "./object-identifier.js";
import { carrierCoherenceMessage } from "./coherence-report.js";

const FRICTION_TYPE_KEY = "friction";

export const FRICTION_DIRECTORY = "frictions";

const BODY_H2_REQUIRED = ["现象", "入账依据"];
const BODY_H2_DISPOSITION = "处置";

const STATUSES = new Set(["open", "resolved", "voided", "accepted"]);

export const FRICTION_DEFAULT_CANDIDATE_STATUSES = Object.freeze(["open", "accepted"]);

const CORRECT_ADDABLE_FIELDS = new Set(["occurrence", "disposition"]);

const CORRECT_REMOVABLE_FIELDS = new Set(["serves", "occurrence", "impact"]);

const CORRECT_REMOVABLE_ANCHOR_FIELDS = new Set(["attribution_ref"]);

const FRICTION_RELATION_KEYS = new Set(["informs", "paired-with"]);

const INFORMS_TARGET_DIRS = [
  ["spark", "sparks"],
  ["pitfall", "pitfalls"],
  ["report", "reports"],
  ["friction", "frictions"],
  ["norm", "norms"],
  ["subgoal", "subgoals"],
];

const PAIRED_WITH_TARGET_DIR = "pitfalls";

const MAX_TITLE_LENGTH = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "phenomenon", "attribution", "attribution_ref", "relations", "occurrence", "disposition", "change_log",
]);

function validateOccurrenceShape(occurrence) {
  if (typeof occurrence !== "object" || occurrence === null || Array.isArray(occurrence)) {
    return failure("friction/occurrence_invalid", "occurrence must be an object (26 §8)");
  }
  const allowed = new Set(["count", "first_at", "last_at"]);
  for (const key of Object.keys(occurrence)) {
    if (!allowed.has(key)) {
      return failure(
        "friction/occurrence_invalid",
        `occurrence field "${key}" is outside the §8 closed set { count, first_at, last_at } — `
        + (key === "human_return_at"
          ? "human_return_at was REMOVED in 2026-10 (the open→observing 放回留观 transition is gone; the mechanical channel no longer flips any existing entry's status)"
          : "unknown fields must not enter the canonical object (26 §8 末)"),
      );
    }
  }
  if (!Number.isInteger(occurrence.count) || occurrence.count < 1) {
    return failure("friction/occurrence_invalid", "occurrence.count must be an integer >= 1 (26 §8)");
  }
  for (const field of ["first_at", "last_at"]) {
    if (typeof occurrence[field] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(occurrence[field])) {
      return failure("friction/occurrence_invalid", `occurrence.${field} must be an RFC3339 timestamp (26 §8)`);
    }
  }
  return { ok: true };
}

export const FRICTION_REMOVABLE_FIELDS = new Set(["attribution", "attribution_ref", "impact"]);

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

export function normalizeAttributionRef(value) {
  if (typeof value === "string" && value.length > 0) {
    return { object_uid: value };
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.object_uid === "string" &&
    value.object_uid.length > 0
  ) {
    return { object_uid: value.object_uid };
  }
  return undefined;
}

const ATTRIBUTION_REF_DIRS = [
  ["spark", "sparks"],
  ["pitfall", "pitfalls"],
  ["report", "reports"],
  ["friction", "frictions"],
  ["norm", "norms"],
];

async function verifyAttributionRefResolves(factSourceRoot, frontmatter) {
  const uid = normalizeAttributionRef(frontmatter.attribution_ref)?.object_uid;
  if (typeof uid !== "string" || uid.length === 0) return { ok: true };
  const target = uid.toLowerCase();
  for (const [, dir] of ATTRIBUTION_REF_DIRS) {
    const abs = join(factSourceRoot, dir);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(md|yaml|yml)$/.test(entry.name)) continue;
      const raw = await readFile(join(abs, entry.name), "utf8").catch(() => null);
      if (raw === null) continue;
      const uidMatch = raw.match(/^object_uid:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m);
      if (uidMatch && UUID_PATTERN.test(uidMatch[1]) && uidMatch[1].toLowerCase() === target) return { ok: true };
    }
  }
  return {
    ok: false,
    code: "friction/attribution_ref_unresolvable",
    message: `attribution_ref.object_uid "${uid}" does not resolve to any same-project fact object (26 §8/§11 锚点型：出现时 Code 机械核验可解析，不可解析即拒绝入账)`,
  };
}

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
    issues.push(repairedLengthMessage("title", frontmatter.title, MAX_TITLE_LENGTH, "26 §8"));
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

  if (frontmatter.occurrence !== undefined) {
    const shape = validateOccurrenceShape(frontmatter.occurrence);
    if (!shape.ok) issues.push(shape.error.message);
  }

  if (frontmatter.attribution !== undefined) {
    if (typeof frontmatter.attribution !== "string" || frontmatter.attribution.length === 0) {
      issues.push("attribution: when present must be a non-empty string (03 §6.1 — omit when not yet attributable)");
    }
  }

  if (frontmatter.attribution_ref !== undefined) {
    const ref = frontmatter.attribution_ref;
    if (typeof ref === "string") {
      if (ref.length === 0 || !UUID_PATTERN.test(ref)) {
        issues.push("attribution_ref: bare string must be a valid object_uid uuid (26 §8/§11 锚点型)");
      }
    } else if (ref !== null && typeof ref === "object" && !Array.isArray(ref)) {
      if (typeof ref.object_uid !== "string" || ref.object_uid.length === 0 || !UUID_PATTERN.test(ref.object_uid)) {
        issues.push("attribution_ref: must be { object_uid } with a valid uuid (26 §8/§11 — 对象形态, 2026-10 订正)");
      }
    } else {
      issues.push("attribution_ref: must be { object_uid } object form (26 §8/§11)");
    }
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

  const hasInforms = relations.some((rel) => rel !== null && typeof rel === "object" && rel.relation_key === "informs");
  if (hasInforms && frontmatter.status !== "resolved") {
    issues.push(`relations: informs may only appear on status=resolved, got status=${JSON.stringify(frontmatter.status)} (26 §11)`);
  }

  const seen = new Set();
  for (const rel of relations) {
    if (typeof rel !== "object" || rel === null) {
      issues.push("relations[]: members must be objects");
      continue;
    }
    const relExtra = Object.keys(rel).filter((k) => k !== "relation_key" && k !== "target" && k !== "evidence_locator");
    if (relExtra.length > 0) {
      issues.push(`relations[]: entry carries fields beyond relation_key/target/evidence_locator (${relExtra.join(", ")}) — 02 §8.2 公共形状`);
    }

    const key = rel.relation_key;
    if (typeof key !== "string" || !FRICTION_RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key ${JSON.stringify(key)} not in closed set {informs, paired-with} (26 §11)`);
      continue;
    }

    const target = rel.target;
    if (typeof target !== "object" || target === null) {
      issues.push(`relations[]: target must be an object (02 §8.2)`);
      continue;
    }
    const targetKeys = Object.keys(target);
    const hasUid = typeof target.object_uid === "string";
    const hasCommit = typeof target.commit === "string";
    if (hasUid && hasCommit) {
      issues.push("relations[]: target carries both object_uid and commit — the two forms are mutually exclusive (02 §8.1 commit 形态)");
      continue;
    }
    if (hasCommit && key === "paired-with") {
      issues.push("relations[]: paired-with target must be an object_uid — the commit exception belongs to informs only (26 §11)");
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

    const locator = rel.evidence_locator;
    if (locator !== undefined && locator !== null) {
      if (key !== "informs") {
        issues.push(`relations[]: evidence_locator is adopted for informs only (26 §11); got relation_key ${JSON.stringify(key)}`);
      }
      if (typeof locator !== "object" || locator === null) {
        issues.push(`relations[]: evidence_locator must be an object when present (02 §8.1)`);
      } else {
        const locExtra = Object.keys(locator).filter((k) => k !== "commit");
        if (locExtra.length > 0) {
          issues.push(`relations[]: evidence_locator carries unsupported key(s) ${locExtra.join(", ")} (26 §11 闭集当前只有 commit)`);
        } else if (typeof locator.commit !== "string" || !COMMIT_PATTERN.test(locator.commit)) {
          issues.push(`relations[]: evidence_locator.commit must be a 40-hex commit hash (02 §8.1); got ${JSON.stringify(locator.commit)}`);
        }
      }
    }

    if (selfUid !== null && target.object_uid === selfUid) {
      issues.push(`relations[]: ${key} target must not be the object itself (26 §11)`);
    }

    const dedupe = `${key}::${target.object_uid}`;
    if (seen.has(dedupe)) issues.push(`relations[]: duplicate relation ${key} → ${target.object_uid}`);
    seen.add(dedupe);
  }

  return { ok: issues.length === 0, issues };
}

async function verifyRelationTargetsResolve(factSourceRoot, frontmatter, { gitCommitResolver, selfUid = null } = {}) {
  for (const rel of frontmatter.relations ?? []) {
    const target = rel?.target;
    if (target === null || typeof target !== "object") continue;
    for (const commitHash of [target?.commit, rel?.evidence_locator?.commit]) {
      if (typeof commitHash !== "string") continue;
      if (typeof gitCommitResolver === "function") {
        if (!(await gitCommitResolver(commitHash))) {
          return { ok: false, code: "friction/relation_target_unresolvable", message: `commit ${commitHash} does not resolve to an existing commit in this repository (02 §8.1 commit 形态)` };
        }
      } else {
        return { ok: false, code: "friction/relation_target_unresolvable", message: `commit ${commitHash} cannot be verified: this writer has no git commit resolver (fail-closed, 02 §8.1)` };
      }
    }

    const targetUid = target?.object_uid;
    if (typeof targetUid !== "string" || targetUid === selfUid) continue;

    if (rel.relation_key === "paired-with") {
      let resolvedPaired = false;
      for (const ext of [".md", ".yaml"]) {
        try {
          await access(join(factSourceRoot, PAIRED_WITH_TARGET_DIR, `pitfall-${targetUid}${ext}`));
          resolvedPaired = true;
          break;
        } catch {   }
      }
      if (!resolvedPaired) {
        return { ok: false, code: "friction/relation_target_unresolvable", message: `paired-with target ${targetUid} does not resolve to an existing Pitfall object in ${PAIRED_WITH_TARGET_DIR}` };
      }
      const pairedPath = join(factSourceRoot, PAIRED_WITH_TARGET_DIR, `pitfall-${targetUid}.md`);
      const pairedRaw = await readFile(pairedPath, "utf8").catch(() => null);
      if (pairedRaw === null) {
        return { ok: false, code: "friction/relation_target_unresolvable", message: `paired-with target ${targetUid} resolves by filename in ${PAIRED_WITH_TARGET_DIR}/ but its carrier cannot be read, so its type cannot be verified (26 §11 — fail-closed)` };
      }
      const keyMatch = pairedRaw.match(/^fact_type_key:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m);
      if (keyMatch === null) {
        return { ok: false, code: "friction/relation_target_unresolvable", message: `paired-with target ${targetUid} carries no readable fact_type_key line — type unverifiable (26 §11 — fail-closed)` };
      }
      if (keyMatch[1] !== "pitfall") {
        return { ok: false, code: "friction/relation_target_unresolvable", message: `paired-with target ${targetUid} resolves in ${PAIRED_WITH_TARGET_DIR}/ but declares fact_type_key ${JSON.stringify(keyMatch[1])}, not "pitfall" (26 §11)` };
      }
      continue;
    }

    let resolvedTarget = false;
    for (const [type, dir] of INFORMS_TARGET_DIRS) {
      for (const ext of [".md", ".yaml"]) {
        try {
          await access(join(factSourceRoot, dir, `${type}-${targetUid}${ext}`));
          resolvedTarget = true;
          break;
        } catch {   }
      }
      if (resolvedTarget) break;
    }
    if (!resolvedTarget) {
      return { ok: false, code: "friction/relation_target_unresolvable", message: `informs target ${targetUid} does not resolve to an existing fact object in ${INFORMS_TARGET_DIRS.map(([, dir]) => dir).join("/")}` };
    }
  }
  return { ok: true };
}

function requireBodyWithoutH1(bodyMarkdown, fieldName) {
  if (/^\s*#\s+\S/.test(bodyMarkdown)) {
    return {
      ok: false,
      message: `${fieldName} must NOT carry the generated H1 — the body starts at "## 现象" and the H1 is generated from title (26 §8). `
        + "The value looks like it came straight from a precise read, whose body DOES include the H1. "
        + "Fix it by deleting the FIRST line that starts with '# ' (keep everything from '## 现象' onward) "
        + "and submit that text as " + fieldName + " — otherwise every write appends one more H1 to the carrier.",
    };
  }
  return { ok: true };
}

export function validateFrictionBodyStructure(body, title, status) {
  const issues = [];
  const expectDisposition = status === "resolved" || status === "voided" || status === "accepted";
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

  const sections = body.split(/^## /m).slice(1);
  for (const sec of sections) {
    const secTitle = sec.split("\n")[0].trim();
    const content = sec.slice(sec.indexOf("\n") + 1).trim();
    if (content.length === 0) issues.push(`body: section "${secTitle}" is empty`);
  }

  const hasDispositionH2 = h2.includes(BODY_H2_DISPOSITION);
  if (hasDispositionH2 !== expectDisposition) {
    issues.push(`body: "## 处置" section presence (${hasDispositionH2}) must match status resolved/voided/accepted (${expectDisposition}) — 26 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

export function validateCarrierCoherence(frontmatter, body) {
  const warnings = [];
  const text = typeof frontmatter.phenomenon === "string" ? frontmatter.phenomenon.trim() : "";
  if (text.length === 0) return { ok: true, issues: [], warnings };
  const content = sectionContent(body, "现象");
  if (content === null) return { ok: true, issues: [], warnings };
  if (!content.includes(text)) {
    warnings.push(carrierCoherenceMessage({
      section: "现象", field: "phenomenon", declared: text, actual: content, clause: "26 §8, §14.1",
    }));
  }
  return { ok: true, issues: [], warnings };
}

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

const FRONTMATTER_FIELD_ORDER = [
  "title", "status",
  "phenomenon", "attribution",
  "relations",
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

export async function createFrictionObject(args) {
  const {
    factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null,
    gitCommitResolver = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 现象'; the H1 is generated from title)");
  }
  const createH1 = requireBodyWithoutH1(bodyMarkdown, "bodyMarkdown");
  if (!createH1.ok) return failure("invalid_request", createH1.message);

  const uid = randomUUID();
  const now = new Date().toISOString();
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = FRICTION_TYPE_KEY;
  frontmatter.created_at = now;
  if (frontmatter.status !== undefined && frontmatter.status !== "open") {
    return failure("friction/initial_state_violation", `create must initialise as status=open; got ${JSON.stringify(frontmatter.status)} (26 §9 — 观察态已退出闭集；销账/废弃/接受是流转，不是初态)`);
  }
  frontmatter.status = "open";
  if (frontmatter.disposition !== undefined) {
    return failure("friction/frontmatter_invalid", "create must not carry disposition (26 §8: 出现 ⇔ status ∈ {resolved, voided, accepted}；初态为 open)");
  }
  if (frontmatter.occurrence === undefined) {
    return failure("friction/frontmatter_invalid", "create must carry occurrence { count, first_at, last_at } (26 §8 必填)");
  }
  const occurrenceShape = validateOccurrenceShape(frontmatter.occurrence);
  if (!occurrenceShape.ok) return occurrenceShape;
  if (Array.isArray(frontmatter.relations)
      && frontmatter.relations.some((rel) => rel !== null && typeof rel === "object" && rel.relation_key === "informs")) {
    return failure("friction/frontmatter_invalid", "create must not carry informs relations (26 §11: informs only attaches to a resolved transition)");
  }
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Friction 对象",
  }];

  const fmCheck = validateFrictionFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("friction/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateFrictionRelations(frontmatter, uid);
  if (!relCheck.ok) {
    return failure("friction/relations_invalid", "relations failed mechanical checks", { issues: relCheck.issues });
  }
  const attrCheck = await verifyAttributionRefResolves(factSourceRoot, frontmatter);
  if (!attrCheck.ok) return failure(attrCheck.code, attrCheck.message);
  if (Array.isArray(frontmatter.relations) && frontmatter.relations.length > 0) {
    const relTargets = await verifyRelationTargetsResolve(factSourceRoot, frontmatter, { gitCommitResolver });
    if (!relTargets.ok) return failure(relTargets.code, relTargets.message);
  }

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validateFrictionBodyStructure(body, frontmatter.title, frontmatter.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  const typeDir = join(factSourceRoot, FRICTION_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  const fingerprint = fileFingerprint(content);
  return success({ object_uid: uid, file: filePath, fingerprint });
}

export async function resolveFrictionObjectUid(factSourceRoot, input, currentProjectId = null) {
  const parsed = parseObjectIdentifier(input);
  if (!parsed.ok) {
    return { ok: false, error: failure("friction/invalid_uid", `${parsed.error.code}: ${parsed.error.message}`) };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  if (projectId !== undefined && currentProjectId !== null && projectId !== currentProjectId) {
    return { ok: false, error: failure("friction/invalid_uid", `foreign_project: identifier targets project "${projectId}", but this session is governed by "${currentProjectId}" — cross-project reads are not supported by this entry`) };
  }
  if (objectUid !== undefined) {
    if (declaredType !== undefined && declaredType !== "friction") {
      return { ok: false, error: failure("friction/invalid_uid", `type_prefix_mismatch: identifier declares type "${declaredType}", but this entry reads "friction" objects`) };
    }
    return { ok: true, objectUid };
  }
  const resolved = await resolveShortId({ factSourceRoot, shortId, declaredType: declaredType ?? "friction" });
  if (!resolved.ok) {
    const extra = resolved.error.candidates === undefined ? "" : `; candidates: ${resolved.error.candidates.join(", ")}`;
    return { ok: false, error: failure("friction/invalid_uid", `${resolved.error.code}: ${resolved.error.message}${extra}`) };
  }
  if (resolved.value.factTypeKey !== "friction") {
    return { ok: false, error: failure("friction/invalid_uid", `type_prefix_mismatch: short id "${shortId}" resolves to a ${resolved.value.factTypeKey} object, but this entry reads "friction" objects`) };
  }
  return { ok: true, objectUid: resolved.value.objectUid };
}

export async function readFrictionObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, currentProjectId = null } = args;
  const uidResolution = await resolveFrictionObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
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

export async function updateFrictionObject(args) {
  const {
    factSourceRoot, objectUid: objectUidInput, expectedFingerprint,
    frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary, sessionSignature = null,
    gitCommitResolver = null, currentProjectId = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("friction/change_summary_required", "changeSummary is required for update");
  }
  const uidResolution = await resolveFrictionObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 现象')");
  }
  const updateH1 = requireBodyWithoutH1(bodyMarkdownAfter, "bodyMarkdownAfter");
  if (!updateH1.ok) return failure("invalid_request", updateH1.message);

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("friction/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  const prevStatus = current.value.frontmatter.status;
  const isTerminal = prevStatus === "resolved" || prevStatus === "voided" || prevStatus === "accepted";
  if (isTerminal) {
    const terminalMessage = `status=${prevStatus} is terminal and the object is read-only (26 §9.2); a recurring obstacle goes through a NEW ledger entry referencing this uid`;
    if (prevStatus !== "accepted") return failure("friction/status_terminal", terminalMessage);
    if (
      frontmatterAfter === null
      || typeof frontmatterAfter !== "object"
      || (Object.prototype.hasOwnProperty.call(frontmatterAfter, "status")
        && frontmatterAfter.status !== "accepted")
    ) {
      return failure("friction/status_terminal", terminalMessage);
    }
    const baseline = current.value.frontmatter;
    const changedKeys = Object.keys(frontmatterAfter).filter((key) => {
      if (key === "object_uid" || key === "fact_type_key" || key === "created_at" || key === "change_log") return false;
      const next = frontmatterAfter[key];
      if (next === undefined) return false;
      return JSON.stringify(next) !== JSON.stringify(baseline[key]);
    });
    const outsideOccurrence = changedKeys.filter((key) => key !== "occurrence");
    if (outsideOccurrence.length > 0) {
      return failure(
        "friction/status_terminal",
        `status=accepted allows ONLY occurrence counting (26 §9.3 计数豁免 2026-11-02); this write also changes: ${outsideOccurrence.join(", ")}`,
      );
    }
    if (typeof bodyMarkdownAfter === "string" && bodyMarkdownAfter.length > 0) {
      const bodyWithoutH1 = current.value.body.replace(/^\s*#\s+.*(\n+|$)/, "").replace(/^\s+/, "");
      if (bodyMarkdownAfter !== bodyWithoutH1) {
        return failure(
          "friction/status_terminal",
          "status=accepted freezes the body verbatim (26 §9.3 计数豁免第 4 项：只增数字不增叙述)",
        );
      }
    }
  }

  const built = buildUpdateFrontmatter({
    currentFrontmatter: current.value.frontmatter,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: FRICTION_REMOVABLE_FIELDS,
    typeLabel: "friction",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const fm = built.value;
  fm.object_uid = objectUid;
  fm.fact_type_key = FRICTION_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("friction/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (open/resolved/voided/accepted, 26 §9)`);
  }

  const isTransition = nextStatus !== prevStatus;
  if (!isTransition && prevStatus === "open") {
    const supplementInforms = Array.isArray(fm.relations)
      && fm.relations.some((rel) => rel !== null && typeof rel === "object" && rel.relation_key === "informs");
    if (supplementInforms) {
      return failure("friction/relations_invalid", "supplement-level update must not carry informs relations (26 §11: informs only attaches to a resolved transition)");
    }
  }

  if (isTransition) {
    if (nextStatus === "resolved") {
      const informsCount = Array.isArray(fm.relations)
        ? fm.relations.filter((rel) => rel !== null && typeof rel === "object" && rel.relation_key === "informs").length
        : 0;
      if (informsCount === 0) {
        return failure("friction/relations_invalid", "resolving requires 1..n informs relations pointing at the remedy objects (26 §9.2/§11)");
      }
    }
    if (nextStatus === "voided" || nextStatus === "accepted") {
      if (typeof fm.disposition !== "string" || fm.disposition.trim().length === 0) {
        return failure("friction/frontmatter_invalid", `transition into ${nextStatus} must carry a non-empty disposition (26 §8: 终态去向说明) — 列表卡据此呈现废弃/接受理由`);
      }
    } else if (fm.disposition !== undefined) {
      return failure("friction/frontmatter_invalid", `disposition must appear only on voided/accepted records (26 §8: 出现 ⇔ status ∈ {voided, accepted}); transition into ${nextStatus} must clear it`);
    }
    if (nextStatus === "voided" || nextStatus === "accepted") {
      const terminalInforms = Array.isArray(fm.relations)
        && fm.relations.some((rel) => rel !== null && typeof rel === "object" && rel.relation_key === "informs");
      if (terminalInforms) {
        return failure("friction/relations_invalid", `${nextStatus} must not carry informs relations (26 §9.1)`);
      }
    }
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  const fmCheck = validateFrictionFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("friction/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateFrictionRelations(fm, objectUid);
  if (!relCheck.ok) {
    return failure("friction/relations_invalid", "updated relations failed mechanical checks", { issues: relCheck.issues });
  }
  const attrCheck = await verifyAttributionRefResolves(factSourceRoot, fm);
  if (!attrCheck.ok) return failure(attrCheck.code, attrCheck.message);

  const relTargets = await verifyRelationTargetsResolve(factSourceRoot, fm, { gitCommitResolver, selfUid: objectUid });
  if (!relTargets.ok) return failure(relTargets.code, relTargets.message);

  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const bodyCheck = validateFrictionBodyStructure(body, fm.title, fm.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}

export async function correctFrictionObject(args) {
  const {
    factSourceRoot, objectUid: objectUidInput, expectedFingerprint,
    relationsAfter = null, bodyMarkdownAfter, changeSummary, humanAuthorization,
    frontmatterRemovals = [],
    frontmatterAdditions = null,
    sessionSignature = null, gitCommitResolver = null, currentProjectId = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (02 §10.5: 每次实际修改恰好一条 change_log)");
  }
  const uidResolution = await resolveFrictionObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
  if (typeof humanAuthorization !== "string" || humanAuthorization.trim().length === 0) {
    return failure("invalid_request", "humanAuthorization is required for a terminal fact correction (26 §13 终态事实更正；Human 确认；无授权记录的更正请求 fail-closed)");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body starting with '## 现象')");
  }
  const correctH1 = requireBodyWithoutH1(bodyMarkdownAfter, "bodyMarkdownAfter");
  if (!correctH1.ok) return failure("invalid_request", correctH1.message);

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("friction/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }
  const fm = current.value.frontmatter;
  if (fm.status !== "resolved" && fm.status !== "voided" && fm.status !== "accepted") {
    return failure(
      "friction/correction_requires_terminal",
      `terminal fact correction applies to a RESOLVED, VOIDED or ACCEPTED record only (26 §13: 适用于 resolved/voided/accepted 三个终态); got status=${JSON.stringify(fm.status)} — open 内容修正走补充级更新或状态流转，本入口不得承载（否则等于把更正伪装成状态转换，02 §10.5）`,
    );
  }
  if (fm.status === "voided" || fm.status === "accepted") {
    const rel = fm.relations;
    if (rel !== undefined && !Array.isArray(rel)) {
      return failure("friction/relations_invalid", `${fm.status} correct branch: relations must be absent or an array (26 §13)`);
    }
    if (Array.isArray(rel) && rel.some((r) => r !== null && typeof r === "object" && r.relation_key === "informs")) {
      return failure("friction/relations_invalid", `${fm.status} correct branch: informs must be absent on a terminal record (26 §9.1)`);
    }
  }

  if (!Array.isArray(frontmatterRemovals)) {
    return failure("invalid_request", "frontmatterRemovals must be an array when provided (26 §13)");
  }
  const next = structuredClone(fm);
  const removedFields = [];
  for (const field of frontmatterRemovals) {
    if (CORRECT_REMOVABLE_FIELDS.has(field)) {
      if (Object.prototype.hasOwnProperty.call(next, field)) {
        delete next[field];
        removedFields.push(field);
      }
      continue;
    }
    if (CORRECT_REMOVABLE_ANCHOR_FIELDS.has(field)) {
      const anchorUid = normalizeAttributionRef(next[field])?.object_uid;
      if (anchorUid === undefined) {
        continue;
      }
      const resolves = await verifyAttributionRefResolves(factSourceRoot, { attribution_ref: next[field] });
      if (resolves.ok) {
        return failure(
          "friction/correction_anchor_target_alive",
          `refusing to remove ${JSON.stringify(field)}: its target ${JSON.stringify(anchorUid)} still resolves to a live fact object `
          + "(26 §13 第三类：只允许删除**指向已退役或将退役目标**的锚点字段——目标仍可解析时删除它，等于把「归因缺失」伪装成「目标已退役」)",
        );
      }
      delete next[field];
      removedFields.push(field);
      continue;
    }
    return failure(
      "friction/correction_removal_not_permitted",
      `correct may only remove fields retired from the type's closed set, fields violating §8 conditional constraints, or anchor fields whose target no longer resolves; got ${JSON.stringify(field)} (26 §13: 终态事实更正不得新增或改值 frontmatter)`,
    );
  }
  const addedFields = [];
  if (frontmatterAdditions !== null) {
    if (typeof frontmatterAdditions !== "object" || Array.isArray(frontmatterAdditions)) {
      return failure("invalid_request", "frontmatterAdditions must be an object when provided (26 §13)");
    }
    for (const [field, value] of Object.entries(frontmatterAdditions)) {
      if (!CORRECT_ADDABLE_FIELDS.has(field)) {
        return failure(
          "friction/correction_addition_not_permitted",
          `correct may only add fields newly admitted to the type's closed set; got ${JSON.stringify(field)} `
          + "(26 §13: 本动作不构成「correct 可改 frontmatter 值」的先例——可补的是「字段之无」，不是「字段的值」)",
        );
      }
      if (Object.prototype.hasOwnProperty.call(next, field)) {
        return failure(
          "friction/correction_addition_exists",
          `field ${JSON.stringify(field)} already exists on the record — frontmatterAdditions only fills a MISSING `
          + "field; changing an existing value is not this channel's business (26 §13)",
        );
      }
      if (field === "disposition") {
        if (next.status !== "voided" && next.status !== "accepted") {
          return failure("friction/frontmatter_invalid", `disposition may only be filled on a voided or accepted record (26 §8: 出现 ⇔ status ∈ {voided, accepted}); got status=${JSON.stringify(next.status)}`);
        }
        if (typeof value !== "string" || value.trim().length === 0) {
          return failure("friction/frontmatter_invalid", "disposition must be a non-empty string (26 §8: 一句话废弃去向)");
        }
      }
      if (field === "occurrence") {
        const shape = validateOccurrenceShape(value);
        if (!shape.ok) return shape;
      }
      next[field] = structuredClone(value);
      addedFields.push(field);
    }
  }
  if (relationsAfter !== null) {
    if (!Array.isArray(relationsAfter)) {
      return failure("friction/relations_invalid", "relationsAfter must be an array when provided (26 §13)");
    }
    if (fm.status === "voided" || fm.status === "accepted") {
      const terminalInforms = relationsAfter.filter((r) => r !== null && typeof r === "object" && r.relation_key === "informs").length;
      if (terminalInforms > 0) {
        return failure("friction/relations_invalid", `${fm.status} correct branch: informs must be absent (26 §9.1); got ${terminalInforms}`);
      }
    } else {
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
  const attrCheck = await verifyAttributionRefResolves(factSourceRoot, next);
  if (!attrCheck.ok) return failure(attrCheck.code, attrCheck.message);

  const relTargetsCorrect = await verifyRelationTargetsResolve(factSourceRoot, next, { gitCommitResolver, selfUid: objectUid });
  if (!relTargetsCorrect.ok) return failure(relTargetsCorrect.code, relTargetsCorrect.message);

  const body = assembleBody(next.title, bodyMarkdownAfter);
  const bodyCheck = validateFrictionBodyStructure(body, next.title, next.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "corrected body failed structural checks", { issues: bodyCheck.issues });
  }

  const trimEnd = (text) => text.replace(/\s+$/, "");
  const bodyUnchanged = trimEnd(assembleBody(fm.title, bodyMarkdownAfter)) === trimEnd(current.value.body);
  const normalizeRelations = (rels) => {
    const list = Array.isArray(rels) ? rels : [];
    return list.map((rel) => {
      const source = rel !== null && typeof rel === "object" ? rel : {};
      return {
        relation_key: source.relation_key ?? null,
        object_uid: source.target?.object_uid ?? null,
        target_commit: source.target?.commit ?? null,
        locator_commit: source.evidence_locator?.commit ?? null,
      };
    });
  };
  const relationsUnchanged = JSON.stringify(normalizeRelations(next.relations))
    === JSON.stringify(normalizeRelations(fm.relations));
  if (bodyUnchanged && relationsUnchanged && removedFields.length === 0 && addedFields.length === 0) {
    return failure("friction/no_op", "correction would change neither the body, the relations, the removed fields nor the added fields — 02 §10.5 不记录 no-op；refusing to append a change_log entry that claims a correction happened");
  }

  next.change_log = [...(fm.change_log ?? []), {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: `事实更正（非状态转换）——${changeSummary}。终态判定未变：status/title/phenomenon/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter 值（两处例外，均为「字段之有无」而非「字段之值」：① 2026-10 起可显式删除已退出类型闭集的字段，本次删除：${removedFields.length > 0 ? removedFields.join("、") : "无"}；② 2026-11 起可补填新进入类型闭集的字段，本次补填：${addedFields.length > 0 ? addedFields.join("、") : "无"}），不得改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：${humanAuthorization.trim()}`,
  }];
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(next, body);
  await atomicWriteFile(filePath, content);
  return success({ fingerprint: fileFingerprint(content) });
}

async function isNonDirectoryAncestor(dir) {
  let cursor = dir;
  for (;;) {
    try {
      const s = await stat(cursor);
      return !s.isDirectory();
    } catch (error) {
      if (error === null || typeof error !== "object" || error.code !== "ENOENT") return false;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

export async function listFrictionObjects(args) {
  const { factSourceRoot, limit = 200, statusFilter = FRICTION_DEFAULT_CANDIDATE_STATUSES } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }
  if (statusFilter !== null) {
    const values = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
    if (values.length === 0 || values.some((value) => typeof value !== "string" || !STATUSES.has(value))) {
      return failure("invalid_request", "statusFilter must be null (all) or a non-empty array of closed-set statuses; invalid values are refused (fail-closed)");
    }
  }

  const typeDir = join(factSourceRoot, FRICTION_DIRECTORY);
  let scanned;
  try {
    scanned = await scanCarrierDirectory(typeDir, "friction");
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (await isNonDirectoryAncestor(typeDir)) {
        return failure("friction/directory_unavailable", `cannot read frictions directory: ${typeDir} is not a directory`);
      }
      return success({ items: [], total: 0, complete: true, invalid: [] });
    }
    return failure("friction/directory_unavailable", `cannot read frictions directory: ${error.message}`);
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
    if (Array.isArray(statusFilter) && statusFilter.length > 0 && !statusFilter.includes(status)) continue;
    if (typeof statusFilter === "string" && statusFilter !== status) continue;
    items.push({
      object_uid: uid,
      fact_type_key: typeof frontmatter.fact_type_key === "string" ? frontmatter.fact_type_key : "",
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      phenomenon: typeof frontmatter.phenomenon === "string" ? frontmatter.phenomenon : "",
      status,
      attribution: typeof frontmatter.attribution === "string" ? frontmatter.attribution : undefined,
      attribution_ref: normalizeAttributionRef(frontmatter.attribution_ref),
      occurrence: frontmatter.occurrence && typeof frontmatter.occurrence === "object" ? frontmatter.occurrence : undefined,
      disposition: typeof frontmatter.disposition === "string" ? frontmatter.disposition : undefined,
      paired_with: Array.isArray(frontmatter.relations)
        ? frontmatter.relations
            .filter((rel) => rel !== null && typeof rel === "object" && rel.relation_key === "paired-with")
            .map((rel) => (typeof rel.target?.object_uid === "string" ? rel.target.object_uid : null))
            .filter((uid) => typeof uid === "string")
        : [],
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}

export { VALID_FM_KEYS };
export { STATUSES as STATUSES_EXPORT_FOR_TEST };
export { CORRECT_ADDABLE_FIELDS as CORRECT_ADDABLE_FIELDS_FOR_TEST };
export { CORRECT_REMOVABLE_FIELDS as CORRECT_REMOVABLE_FIELDS_FOR_TEST };

export async function findFrictionsPairedWith(args) {
  const { factSourceRoot, targetUid } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof targetUid !== "string" || !UUID_PATTERN.test(targetUid)) {
    return failure("invalid_request", `targetUid must be a canonical UUID (02 §8.2), got ${JSON.stringify(targetUid)}`);
  }
  const listed = await listFrictionObjects({ factSourceRoot, statusFilter: null, limit: 200 });
  if (!listed.ok) return listed;
  const wanted = targetUid.toLowerCase();
  const items = listed.value.items.filter((item) =>
    Array.isArray(item.paired_with) && item.paired_with.some((uid) => uid.toLowerCase() === wanted));
  const complete = listed.value.complete !== false;
  return success({
    items,
    total: items.length,
    invalid: listed.value.invalid,
    complete,
    scanned: listed.value.items.length,
    ledger_total: listed.value.total,
  });
}
