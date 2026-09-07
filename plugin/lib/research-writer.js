/**
 * dsh-ldvh — Research fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/24 §13 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/researches/research-<uid>.md) with YAML
 *             frontmatter + markdown body. Code assigns object_uid +
 *             created_at; the creation validates the type-specific
 *             mechanical checks (closed sets, three-state at least one,
 *             quote loopback, fixed H2 sections (+ H3 for exploratory),
 *             sub-stage coherence).
 *  - read:    returns frontmatter + body + file-level content
 *             fingerprint (SHA-256).
 *  - update:  CAS — the caller must supply the fingerprint observed at
 *             the last read; the whole file is replaced atomically;
 *             a change_log entry is appended. Sub-stage (调查阶段 H2)
 *             is immutable across updates.
 *
 * Red lines honoured (24 §18): no second fact authority, no cross-object
 * audit ledger — change_log lives inside the file's frontmatter.
 */

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Constants (specs/24 §8, §13)
// ---------------------------------------------------------------------------

const RESEARCH_TYPE_KEY = "research";

/** Directory under the fact-source root that carries Research objects. */
export const RESEARCH_DIRECTORY = "researches";

const MAIN_H2_DIRECTED = ["研究问题", "输入与边界", "关键发现", "未证实与缺口", "建议", "后续分流"];
const MAIN_H2_EXPLORATORY = ["研究问题", "输入与边界", "调查阶段", "关键发现", "未证实与缺口", "建议", "后续分流"];
const SURVEY_H3 = ["调查问题与范围", "调查方法与来源", "调查发现", "调查停止与交接"];

const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const PRIORITY_VALUES = new Set(["high", "medium", "low"]);
const STOPPING_REASONS = new Set(["sufficient", "no-gain", "round-cap"]);
const STATUSES = new Set(["active", "retired"]);
const ANSWERED_BY = new Set(["human", "external", "ai"]);
const RETIREMENT_REASONS = new Set(["outdated", "superseded", "out-of-scope", "rejected"]);

/** Closed set of frontmatter keys (24 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "urls", "relations", "change_log",
  "research_question", "research_purpose", "stopping_reason",
  "confirmed_statements", "uncertain", "gaps",
  "implications", "clarification_log",
  "retirement_reason", "retired_at",
]);

/** Relation keys allowed for Research (24 §11). */
const RELATION_KEYS = new Set(["inspired-by", "informs", "updates"]);
/** Relation keys explicitly forbidden for Research (24 §11). */
const FORBIDDEN_RELATION_KEYS = new Set(["supersedes", "depends-on"]);

/** UUID format check (W3: path-injection guard). 03 §6.1：canonical UUIDv4（版本位 4）。 */
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
// Validation (the mechanical slice of specs/24 §6, §8, §13)
// ---------------------------------------------------------------------------

export function validateResearchFrontmatter(frontmatter, { allowRetiredAtMissing = false } = {}) {
  const issues = [];

  // Closed-set check (24 §8.5): unknown fields reject the object
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 24 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  if (frontmatter.fact_type_key !== RESEARCH_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${RESEARCH_TYPE_KEY}"`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }
  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

  if (!Array.isArray(frontmatter.urls) || frontmatter.urls.length === 0) {
    issues.push("urls: required non-empty array (external sources)");
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

  for (const field of ["research_question", "research_purpose"]) {
    if (typeof frontmatter[field] !== "string" || frontmatter[field].length === 0) {
      issues.push(`${field}: required non-empty string`);
    }
  }
  if (!STOPPING_REASONS.has(frontmatter.stopping_reason)) {
    issues.push(`stopping_reason: must be one of ${[...STOPPING_REASONS].join("/")}`);
  }

  const { confirmed_statements = [], uncertain = [], gaps = [] } = frontmatter;
  if (!Array.isArray(confirmed_statements) || !Array.isArray(uncertain) || !Array.isArray(gaps)) {
    issues.push("confirmed_statements/uncertain/gaps: must be arrays");
    return { ok: false, issues };
  }
  if (confirmed_statements.length === 0 && uncertain.length === 0 && gaps.length === 0) {
    issues.push("three-state invariant: at least one of confirmed_statements/uncertain/gaps must be present");
  }
  for (const s of confirmed_statements) {
    if (typeof s !== "string" || s.length === 0) {
      issues.push("confirmed_statements[]: members must be non-empty strings");
    }
  }

  for (const u of uncertain) {
    if (typeof u.issue !== "string" || u.issue.length === 0) issues.push("uncertain[].issue: required non-empty");
    if (typeof u.reason !== "string" || u.reason.length === 0) issues.push("uncertain[].reason: required non-empty");
  }

  for (const g of gaps) {
    if (typeof g.description !== "string" || g.description.length === 0) issues.push("gaps[].description: required non-empty");
    if (!PRIORITY_VALUES.has(g.priority)) issues.push(`gaps[].priority: must be high/medium/low, got ${JSON.stringify(g.priority)}`);
  }

  if (frontmatter.stopping_reason === "sufficient" && confirmed_statements.length === 0) {
    issues.push("stopping consistency: sufficient requires non-empty confirmed_statements");
  }
  if (frontmatter.stopping_reason === "sufficient") {
    const hasHighGap = gaps.some((g) => g.priority === "high");
    if (hasHighGap) issues.push("stopping consistency: sufficient must not have an open high-priority gap");
  }
  if (frontmatter.stopping_reason === "round-cap" && gaps.length === 0) {
    issues.push("stopping consistency: round-cap must declare unmet scope in gaps");
  }

  const statements = new Set(confirmed_statements);
  for (const impl of frontmatter.implications ?? []) {
    if (typeof impl.finding_ref !== "string" || !statements.has(impl.finding_ref)) {
      issues.push(`implications[].finding_ref: must match a confirmed_statements[] member exactly, got ${JSON.stringify(impl.finding_ref)}`);
    }
    if (typeof impl.implication !== "string" || impl.implication.length === 0) {
      issues.push("implications[].implication: required non-empty");
    }
  }

  for (const cl of frontmatter.clarification_log ?? []) {
    if (typeof cl.question !== "string" || cl.question.length === 0) issues.push("clarification_log[].question: required non-empty");
    if (typeof cl.answer !== "string" || cl.answer.length === 0) issues.push("clarification_log[].answer: required non-empty");
    if (!ANSWERED_BY.has(cl.answered_by)) issues.push(`clarification_log[].answered_by: must be human/external/ai, got ${JSON.stringify(cl.answered_by)}`);
  }

  if (frontmatter.status === "retired" && confirmed_statements.length === 0) {
    issues.push("lifecycle: retired object must retain its confirmed evidence (read-only)");
  }

  // 24 §9 invariant 9: retirement completeness
  // `allowRetiredAtMissing` is true during the update flow for a retirement
  // transition: Code injects retired_at after validation passes, so the check
  // must not fire on the incoming frontmatter. Static callers (type checks)
  // use the default false to enforce the requirement end-to-end.
  if (frontmatter.status === "retired") {
    if (typeof frontmatter.retirement_reason !== "string" || frontmatter.retirement_reason.length === 0) {
      issues.push("lifecycle: status=retired requires non-empty retirement_reason (closed set: outdated/superseded/out-of-scope/rejected)");
    } else if (!RETIREMENT_REASONS.has(frontmatter.retirement_reason)) {
      issues.push(`lifecycle: retirement_reason must be one of ${[...RETIREMENT_REASONS].join("/")}, got ${JSON.stringify(frontmatter.retirement_reason)}`);
    }
    if (!allowRetiredAtMissing && (typeof frontmatter.retired_at !== "string" || frontmatter.retired_at.length === 0)) {
      issues.push("lifecycle: status=retired requires retired_at (ISO 8601, Code-assigned — AI must not supply this field)");
    }
    // Cross-field: retirement_reason=superseded requires an updates relation (checked in create/update flows)
  } else {
    // active status must not carry retirement fields
    if (frontmatter.retirement_reason !== undefined) {
      issues.push("lifecycle: retirement_reason must not be present when status=active");
    }
    if (frontmatter.retired_at !== undefined) {
      issues.push("lifecycle: retired_at must not be present when status=active");
    }
  }

  // Cross-field invariant: retirement_reason=superseded requires an updates relation
  if (frontmatter.status === "retired" && frontmatter.retirement_reason === "superseded") {
    const hasUpdates = (frontmatter.relations ?? []).some((r) => r?.relation_key === "updates");
    if (!hasUpdates) {
      issues.push("lifecycle: retirement_reason=superseded requires at least one updates relation in relations[] pointing to the replacement Research");
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Validate the relations contract (24 §11 + 03 §7.2).
 *
 * Mechanical scope (24 §14): relation_key closed set, minimal target shape,
 * updates cardinality and self-reference, duplicate edges. Target *type*
 * closed sets for cross-type keys (inspired-by/informs → spark/workcase/adr)
 * need target resolution, which lands with the 20–22 type rebuilds — the
 * `updates` target IS resolvable in our own directory and is checked by the
 * create/update flows (research/relation_target_unresolvable).
 *
 * @param {object} frontmatter — the complete frontmatter (relations optional)
 * @param {string|null} selfUid — this object's uid (self-reference check);
 *   null skips the self-check (pure validation without an assigned identity)
 * @returns {{ok: boolean, issues: string[]}}
 */
export function validateResearchRelations(frontmatter, selfUid = null) {
  const issues = [];
  const relations = frontmatter.relations;
  if (relations === undefined) return { ok: true, issues };
  if (!Array.isArray(relations)) {
    issues.push("relations: must be an array (03 §7.2)");
    return { ok: false, issues };
  }

  const seen = new Set();
  let updatesCount = 0;
  for (const rel of relations) {
    if (typeof rel !== "object" || rel === null) {
      issues.push("relations[]: members must be objects");
      continue;
    }
    // 03 §7.2 minimal shape: entries keep only relation_key + target —
    // no copied target titles, explanations or reverse navigation.
    const relExtra = Object.keys(rel).filter((k) => k !== "relation_key" && k !== "target");
    if (relExtra.length > 0) {
      issues.push(`relations[]: entry carries fields beyond relation_key/target (${relExtra.join(", ")}) — 03 §7.2 minimal shape`);
    }

    const key = rel.relation_key;
    if (FORBIDDEN_RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key "${key}" is forbidden for Research (24 §11)`);
      continue;
    }
    if (typeof key !== "string" || !RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key ${JSON.stringify(key)} not in closed set {inspired-by, informs, updates} (24 §11)`);
      continue;
    }

    const target = rel.target;
    if (typeof target !== "object" || target === null || typeof target.object_uid !== "string" || !UUID_PATTERN.test(target.object_uid)) {
      // This also rejects v4 legacy ids (study-XXXX…) and legacy triples:
      // canonical targets are object_uid only (03 §7.2, 24 §11).
      issues.push(`relations[]: target.object_uid must be a canonical UUID (03 §7.2); got ${JSON.stringify(target?.object_uid)}`);
      continue;
    }
    const targetExtra = Object.keys(target).filter((k) => k !== "object_uid");
    if (targetExtra.length > 0) {
      issues.push(`relations[]: target carries fields beyond object_uid (${targetExtra.join(", ")}) — 03 §7.2 minimal shape`);
    }

    if (key === "updates") {
      updatesCount += 1;
      if (updatesCount > 1) issues.push("relations[]: at most one updates relation per object (24 §11)");
      if (selfUid !== null && target.object_uid === selfUid) issues.push("relations[]: updates target must not be the object itself (24 §11)");
    }

    const dedupe = `${key}::${target.object_uid}`;
    if (seen.has(dedupe)) issues.push(`relations[]: duplicate relation ${key} → ${target.object_uid}`);
    seen.add(dedupe);
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Extract the resolvable updates-target uid (24 §11: 目标必须可解析且不等于自身),
 * or null when there is none to resolve.
 */
function updatesTargetUid(frontmatter, selfUid) {
  for (const rel of frontmatter.relations ?? []) {
    if (rel?.relation_key === "updates" && rel?.target?.object_uid !== selfUid) {
      return rel.target.object_uid;
    }
  }
  return null;
}

/**
 * Extract H2 titles (in order) from a markdown body.
 */
function h2Titles(body) {
  const titles = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) titles.push(line.slice(3).trim());
  }
  return titles;
}

/**
 * Extract the H3 titles (in order) inside a given H2 section.
 */
function h3TitlesInSection(body, h2Title) {
  const lines = body.split("\n");
  const titles = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inSection = line.slice(3).trim() === h2Title;
      continue;
    }
    if (inSection && line.startsWith("### ")) {
      titles.push(line.slice(4).trim());
    }
  }
  return titles;
}

/**
 * Validate the body structure. Returns { ok, issues, exploratory }.
 * When `retirementMode` is true (caller is validating a retired object),
 * enforces 24 §9: 建议 section's last bullet must answer "在何种条件下仍
 * 可被回查" (lightweight mechanical sniff — at least one of the listed
 * keywords must appear, semantic truth is AI/in-dependent-review scope).
 */
export function validateBodyStructure(body, retirementMode = false) {
  const issues = [];
  const h2 = h2Titles(body);
  const hasSurvey = h2.includes("调查阶段");
  const expected = hasSurvey ? MAIN_H2_EXPLORATORY : MAIN_H2_DIRECTED;

  if (h2.length !== expected.length) {
    issues.push(`body: expected ${expected.length} H2 sections (${expected.join(" / ")}), found ${h2.length} (${h2.join(" / ")})`);
  } else {
    for (let i = 0; i < expected.length; i++) {
      if (h2[i] !== expected[i]) {
        issues.push(`body: H2 #${i + 1} expected "${expected[i]}", found "${h2[i]}"`);
      }
    }
  }

  // Non-empty check for every H2 section
  const sections = body.split(/^## /m).slice(1);
  for (const sec of sections) {
    const title = sec.split("\n")[0].trim();
    const content = sec.slice(sec.indexOf("\n") + 1).trim();
    if (content.length === 0) issues.push(`body: section "${title}" is empty`);
  }

  // Exploratory: 调查阶段 must contain the four fixed H3 in order
  if (hasSurvey) {
    const h3 = h3TitlesInSection(body, "调查阶段");
    if (h3.length !== SURVEY_H3.length) {
      issues.push(`调查阶段: expected ${SURVEY_H3.length} H3 sections (${SURVEY_H3.join(" / ")}), found ${h3.length} (${h3.join(" / ")})`);
    } else {
      for (let i = 0; i < SURVEY_H3.length; i++) {
        if (h3[i] !== SURVEY_H3[i]) {
          issues.push(`调查阶段: H3 #${i + 1} expected "${SURVEY_H3[i]}", found "${h3[i]}"`);
        }
      }
    }
    // H3 sections must be non-empty too
    const surveySection = sections.find((s) => s.split("\n")[0].trim() === "调查阶段");
    if (surveySection) {
      const h3Sections = surveySection.split(/^### /m).slice(1);
      for (const sec of h3Sections) {
        const title = sec.split("\n")[0].trim();
        const content = sec.slice(sec.indexOf("\n") + 1).trim();
        if (content.length === 0) issues.push(`调查阶段: H3 "${title}" is empty`);
      }
    }
  }

  // 24 §9: when retiring, 建议 section's last bullet must answer
  // "在何种条件下仍可被回查". Lightweight mechanical sniff — at least one
  // of the keywords 回查/仍可/留存/后续/再触发/仍可消费 must appear
  // somewhere in the 建议 section.
  if (retirementMode) {
    const sections2 = body.split(/^## /m).slice(1);
    const adviceSection = sections2.find((s) => s.split("\n")[0].trim() === "建议");
    if (adviceSection) {
      const keywords = ["回查", "仍可", "留存", "后续", "再触发", "仍可消费", "检索"];
      const hasKeyword = keywords.some((k) => adviceSection.includes(k));
      if (!hasKeyword) {
        issues.push("retired 24 §9: 建议 section must explicitly state under which conditions this object may still be referenced back (轻量机械提示: 至少含「回查/仍可/留存/后续/再触发/仍可消费/检索」之一)");
      }
    }
  }

  return { ok: issues.length === 0, issues, exploratory: hasSurvey };
}

/**
 * Extract finding units from the 关键发现 section: each H3 is a unit.
 * Returns array of { title, content, traceRef, traceAnchor } — traceRef/traceAnchor
 * are null when the unit has no valid 溯源 anchor line.
 */
export function extractFindingUnits(body) {
  const lines = body.split("\n");
  const units = [];
  let inSection = false;
  let current = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) units.push(current);
      current = null;
      inSection = line.slice(3).trim() === "关键发现";
      continue;
    }
    if (inSection && line.startsWith("### ")) {
      if (current) units.push(current);
      current = { title: line.slice(4).trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) units.push(current);

  // Parse trace anchor: last non-empty line matching 溯源：<ref>（<anchor>）
  const TRACE_PATTERN = /^溯源：(https?:\/\/\S+?)（(.+?)）\s*$/;
  return units.map((u) => {
    const contentLines = u.lines.filter((l) => l.trim().length > 0);
    let traceRef = null;
    let traceAnchor = null;
    const lastLine = contentLines[contentLines.length - 1] ?? "";
    const m = lastLine.match(TRACE_PATTERN);
    if (m) {
      traceRef = m[1];
      traceAnchor = m[2];
    }
    return {
      title: u.title,
      content: u.lines.join("\n").trim(),
      traceRef,
      traceAnchor,
      hasTrace: m !== null,
    };
  });
}

/**
 * Cross-validate: confirmed_statements ↔ finding units ↔ trace anchors.
 * Returns { ok, issues }.
 */
export function validateIndexBodyCoherence(frontmatter, body) {
  const issues = [];
  const urlRefs = new Set((frontmatter.urls ?? []).map((u) => u.ref).filter((r) => typeof r === "string"));
  const units = extractFindingUnits(body);
  const statements = frontmatter.confirmed_statements ?? [];

  if (statements.length > 0 && units.length === 0) {
    issues.push("index-body coherence: confirmed_statements is non-empty but 关键发现 has no finding units");
  }

  // Invariant 7: every confirmed_statement matches a finding unit declaration (H3 title)
  const unitTitles = new Set(units.map((u) => u.title));
  for (const s of statements) {
    if (!unitTitles.has(s)) {
      issues.push(`index-body coherence: confirmed_statement "${s.slice(0, 40)}..." has no verbatim finding unit (H3 title) match`);
    }
  }

  // Invariant 2: every finding unit has a valid trace anchor with ref ∈ urls
  for (const u of units) {
    if (!u.hasTrace) {
      issues.push(`trace anchor: finding unit "${u.title.slice(0, 40)}..." has no 溯源：<ref>（<anchor>） line`);
    } else if (!urlRefs.has(u.traceRef)) {
      issues.push(`trace anchor: ref "${u.traceRef}" in unit "${u.title.slice(0, 40)}..." does not match any urls[].ref`);
    }
  }

  // Invariant 10 (24 §8): the 研究问题 body section must contain the
  // frontmatter research_question verbatim — frontmatter is the single
  // authoritative text, the body only expands around it. Prevents the two
  // occurrences from evolving into divergent second fact sources.
  const question = typeof frontmatter.research_question === "string"
    ? frontmatter.research_question.trim()
    : "";
  if (question.length > 0) {
    const sections = body.split(/^## /m).slice(1);
    const qSection = sections.find((s) => s.split("\n")[0].trim() === "研究问题");
    const qContent = qSection ? qSection.slice(qSection.indexOf("\n") + 1).trim() : "";
    if (!qContent.includes(question)) {
      issues.push(`question-coherence: 研究问题 section must contain research_question verbatim (24 §8 invariant 10): "${question.slice(0, 40)}..."`);
    }
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function researchFileName(uid) { return `research-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, RESEARCH_DIRECTORY, researchFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * 24 §7 规范阅读序（Human 2026-09-09 定，同日修正为展示层约定）：语义块在前
 * （标题/状态/研究三要素/三态证据/澄清启发/退出语义），引用与身份居后，
 * change_log 沉底。规范不强制书写顺序（YAML 映射无序、写入方任意键序均合规）——
 * 本函数是参考写入端的输出格式约定（非规范约束）：按阅读序输出使文件确定性
 * （git diff 稳定、直接可读）且无人被强制。字段闭集不变——只重排键序，
 * 不新增、不删除、不改值；未在表中的条件字段自然跳过。
 */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status",
  "research_question", "research_purpose", "stopping_reason",
  "confirmed_statements", "uncertain", "gaps", "clarification_log", "implications",
  "retirement_reason", "retired_at",
  "urls", "relations",
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
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, "utf8");
  // Write verification (W4): read back and compare before rename —
  // catches partial writes (disk-full at flush time, etc.)
  const written = await readFile(tmp, "utf8");
  if (written !== content) {
    await unlink(tmp).catch(() => {});
    throw new Error("atomic write verification failed: written content does not match");
  }
  await rename(tmp, filePath);
}

/** Validate objectUid format (W3 path-injection guard). */
function assertValidUid(objectUid) {
  if (typeof objectUid !== "string" || !UUID_PATTERN.test(objectUid)) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Create (specs/03 §9.4 + specs/24 §13)
// ---------------------------------------------------------------------------

export async function createResearchObject(args) {
  const { factSourceRoot, frontmatterDraft, analysisBody, surveyBody = null, sessionSignature = null } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }

  // Sub-stage: exploratory = survey section present, directed = absent
  const exploratory = typeof surveyBody === "string" && surveyBody.length > 0;
  if (surveyBody !== null && !exploratory) {
    return failure("invalid_request", "surveyBody must be non-empty string (exploratory) or null (directed)");
  }

  // Build the body: inject 调查阶段 H2 (with survey H3 content) when exploratory
  let body;
  if (exploratory) {
    body = insertSurveySection(analysisBody, surveyBody.trim());
  } else {
    body = analysisBody;
  }

  // Code-assigned identity (03 §6.2)
  const uid = randomUUID();
  const now = new Date().toISOString();
  // Strip caller-only params (change_summary is a call argument, not object metadata)
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = RESEARCH_TYPE_KEY;
  frontmatter.created_at = now;
  // 24 §9 invariant 9: when creating with status=retired, Code still must NOT
  // (24 §9: "初态只能是 active"; create must be active). Reject explicitly to
  // make the contract visible at the create boundary.
  if (frontmatter.status === "retired") {
    return failure("research/initial_state_violation", "create must initialise as status=active; retired is a transition, not an initial state (24 §9)");
  }
  frontmatter.status = "active";
  frontmatter.change_log = [{
    at: now,
    ...sessionSignature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Research 对象",
  }];

  // Validate
  const fmCheck = validateResearchFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("research/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  // Relations contract (24 §11): closed keys, shape, updates cardinality,
  // plus resolvability of the updates target inside our own directory.
  const relCheck = validateResearchRelations(frontmatter, uid);
  if (!relCheck.ok) {
    return failure("research/relations_invalid", "relations failed mechanical checks", { issues: relCheck.issues });
  }
  const targetUid = updatesTargetUid(frontmatter, uid);
  if (targetUid !== null) {
    const targetPath = objectFilePath(factSourceRoot, targetUid);
    try {
      await access(targetPath);
    } catch {
      return failure("research/relation_target_unresolvable", `updates target ${targetUid} does not resolve to an existing Research object`);
    }
  }

  const bodyCheck = validateBodyStructure(body);
  if (!bodyCheck.ok) {
    return failure("research/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  if (bodyCheck.exploratory !== exploratory) {
    return failure("research/substage_mismatch", `body structure implies ${bodyCheck.exploratory ? "exploratory" : "directed"} but surveyBody says ${exploratory ? "exploratory" : "directed"}`);
  }

  // Index-body coherence (24 §8 invariants 2/7): statements ↔ units ↔ anchors
  const coherenceCheck = validateIndexBodyCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("research/coherence_invalid", "index-body coherence failed", { issues: coherenceCheck.issues });
  }

  // Write (single flat file, atomic)
  const typeDir = join(factSourceRoot, RESEARCH_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  const fingerprint = fileFingerprint(content);
  return success({ object_uid: uid, file: filePath, fingerprint });
}

/**
 * Insert the 调查阶段 H2 section into the analysis body,
 * right after 调研问题 and before 输入与边界.
 */
function insertSurveySection(analysisBody, surveyH3Content) {
  // New v4-skeleton order: ...研究问题 → 输入与边界 → 调查阶段 → 关键发现...
  // Insert AFTER 输入与边界 (i.e., before 关键发现).
  const lines = analysisBody.split("\n");
  const insertIndex = lines.findIndex((line) => line.trim() === "## 关键发现");
  if (insertIndex === -1) {
    return analysisBody + "\n\n## 调查阶段\n\n" + surveyH3Content + "\n";
  }
  const surveySection = ["## 调查阶段", "", surveyH3Content, ""];
  lines.splice(insertIndex, 0, ...surveySection);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2 precise read-back)
// ---------------------------------------------------------------------------

export async function readResearchObject(args) {
  const { factSourceRoot, objectUid } = args;
  if (!assertValidUid(objectUid)) {
    return failure("research/invalid_uid", "objectUid must be a valid UUID");
  }
  const filePath = objectFilePath(factSourceRoot, objectUid);

  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    return failure("research/object_not_found", `cannot read object file: ${error.message}`);
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("research/object_invalid", "file has no YAML frontmatter block");
  }

  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("research/object_invalid", `frontmatter parse error: ${error.message}`);
  }

  const body = content.slice(fmMatch[0].length).trim();
  const structure = validateBodyStructure(body);

  return success({
    object_uid: objectUid,
    file: filePath,
    frontmatter,
    body,
    exploratory: structure.exploratory,
    body_valid: structure.ok,
    body_issues: structure.issues,
    fingerprint: fileFingerprint(content),
  });
}

// ---------------------------------------------------------------------------
// Update via CAS (specs/03 §9.5 + specs/24 §13)
// ---------------------------------------------------------------------------

export async function updateResearchObject(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, analysisBodyAfter, surveyBodyAfter = null, changeSummary, sessionSignature = null } = args;

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("research/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(args.objectUid)) {
    return failure("research/invalid_uid", "objectUid must be a valid UUID");
  }

  const current = await readResearchObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("research/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  // Sub-stage immutability: cannot add or remove 调查阶段 H2
  const wasExploratory = current.value.exploratory;
  const isExploratory = typeof surveyBodyAfter === "string" && surveyBodyAfter.length > 0;
  if (wasExploratory !== isExploratory) {
    return failure("research/substage_immutable", `cannot change sub-stage after creation (was ${wasExploratory ? "exploratory" : "directed"}, trying ${isExploratory ? "exploratory" : "directed"})`);
  }

  // Build updated body
  let body;
  if (isExploratory) {
    body = insertSurveySection(analysisBodyAfter, surveyBodyAfter.trim());
  } else {
    body = analysisBodyAfter;
  }

  // Build updated frontmatter
  // Strip caller-only params before building the persistent frontmatter.
  // Also strip Code-managed fields (retired_at) that AI must not supply.
  const { change_summary: _strippedUpdate, retired_at: _strippedRetiredAt, ...afterFields } = frontmatterAfter;
  const fm = { ...afterFields };
  fm.object_uid = objectUid;
  fm.fact_type_key = RESEARCH_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  // 24 §9: active → retired transition; Code fills retired_at from the
  // transition wall clock (AI must not supply this field).
  const prevStatus = current.value.frontmatter.status;
  const nextStatus = fm.status;
  if (nextStatus === "retired") {
    if (prevStatus === "retired") {
      return failure("research/status_terminal", "status=retired is terminal and cannot be re-entered (24 §9)");
    }
    if (prevStatus !== "active") {
      return failure("research/status_transition_invalid", `transition ${prevStatus} → retired is not allowed (24 §9: only active → retired)`);
    }
    // Code-managed retired_at
    fm.retired_at = new Date().toISOString();
  } else if (nextStatus === "active" && prevStatus === "retired") {
    return failure("research/status_terminal", "status=retired is terminal and cannot be re-opened (24 §9)");
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sessionSignature,
    summary: changeSummary,
  }];

  // Validate
  const fmCheck = validateResearchFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("research/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  // Relations contract on update (24 §11), incl. updates-target resolvability.
  const relCheck = validateResearchRelations(fm, objectUid);
  if (!relCheck.ok) {
    return failure("research/relations_invalid", "updated relations failed mechanical checks", { issues: relCheck.issues });
  }
  const targetUid = updatesTargetUid(fm, objectUid);
  if (targetUid !== null) {
    const targetPath = objectFilePath(factSourceRoot, targetUid);
    try {
      await access(targetPath);
    } catch {
      return failure("research/relation_target_unresolvable", `updates target ${targetUid} does not resolve to an existing Research object`);
    }
  }
  const bodyCheck = validateBodyStructure(body, fm.status === "retired");
  if (!bodyCheck.ok) {
    return failure("research/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  if (bodyCheck.exploratory !== isExploratory) {
    return failure("research/substage_mismatch", "updated body structure does not match declared sub-stage");
  }

  // Index-body coherence on update
  const coherenceCheck = validateIndexBodyCoherence(fm, body);
  if (!coherenceCheck.ok) {
    return failure("research/coherence_invalid", "index-body coherence failed on update", { issues: coherenceCheck.issues });
  }

  // Atomic single-file write
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}
