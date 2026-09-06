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
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Constants (specs/24 §8, §13)
// ---------------------------------------------------------------------------

const RESEARCH_TYPE_KEY = "research";

/** Directory under the fact-source root that carries Research objects. */
export const RESEARCH_DIRECTORY = "researches";

const MAIN_H2_DIRECTED = ["调研问题", "输入与边界", "已证实", "未证实与缺口", "停止与后续"];
const MAIN_H2_EXPLORATORY = ["调研问题", "调查阶段", "输入与边界", "已证实", "未证实与缺口", "停止与后续"];
const SURVEY_H3 = ["调查问题与范围", "调查方法与来源", "调查发现", "调查停止与交接"];

const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const PRIORITY_VALUES = new Set(["high", "medium", "low"]);
const STOPPING_REASONS = new Set(["sufficient", "no-gain", "round-cap"]);
const STATUSES = new Set(["active", "retired"]);
const ANSWERED_BY = new Set(["human", "external", "ai"]);

/** Closed set of frontmatter keys (24 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "urls", "relations", "change_log",
  "research_question", "research_purpose", "stopping_reason",
  "confirmed", "uncertain", "gaps",
  "implications", "clarification_log",
]);

/** UUID format check (W3: path-injection guard). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function validateResearchFrontmatter(frontmatter) {
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

  const { confirmed = [], uncertain = [], gaps = [] } = frontmatter;
  if (!Array.isArray(confirmed) || !Array.isArray(uncertain) || !Array.isArray(gaps)) {
    issues.push("confirmed/uncertain/gaps: must be arrays");
    return { ok: false, issues };
  }
  if (confirmed.length === 0 && uncertain.length === 0 && gaps.length === 0) {
    issues.push("three-state invariant: at least one of confirmed/uncertain/gaps must be present");
  }

  const urlRefs = new Set((frontmatter.urls ?? []).map((u) => u.ref).filter((r) => typeof r === "string"));

  for (const c of confirmed) {
    if (typeof c.statement !== "string" || c.statement.length === 0) {
      issues.push("confirmed[].statement: required non-empty");
    }
    if (!CONFIDENCE_VALUES.has(c.confidence)) {
      issues.push(`confirmed[].confidence: must be high/medium/low, got ${JSON.stringify(c.confidence)}`);
    }
    if (!Array.isArray(c.quotes) || c.quotes.length === 0) {
      issues.push("confirmed[].quotes: at least one quote required (citation loop)");
      continue;
    }
    for (const q of c.quotes) {
      if (typeof q.text !== "string" || q.text.length === 0) {
        issues.push("quotes[].text: required non-empty verbatim excerpt");
      }
      if (typeof q.anchor !== "string" || q.anchor.length === 0) {
        issues.push("quotes[].anchor: required non-empty locator");
      }
      if (typeof q.source !== "string" || !urlRefs.has(q.source)) {
        issues.push(`quotes[].source: must match a urls[].ref exactly, got ${JSON.stringify(q.source)}`);
      }
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

  if (frontmatter.stopping_reason === "sufficient" && confirmed.length === 0) {
    issues.push("stopping consistency: sufficient requires non-empty confirmed");
  }
  if (frontmatter.stopping_reason === "sufficient") {
    const hasHighGap = gaps.some((g) => g.priority === "high");
    if (hasHighGap) issues.push("stopping consistency: sufficient must not have an open high-priority gap");
  }
  if (frontmatter.stopping_reason === "round-cap" && gaps.length === 0) {
    issues.push("stopping consistency: round-cap must declare unmet scope in gaps");
  }

  const statements = new Set(confirmed.map((c) => c.statement));
  for (const impl of frontmatter.implications ?? []) {
    if (typeof impl.finding_ref !== "string" || !statements.has(impl.finding_ref)) {
      issues.push(`implications[].finding_ref: must match a confirmed[].statement exactly, got ${JSON.stringify(impl.finding_ref)}`);
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

  if (frontmatter.status === "retired" && confirmed.length === 0) {
    issues.push("lifecycle: retired object must retain its confirmed evidence (read-only)");
  }

  return { ok: issues.length === 0, issues };
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
 */
export function validateBodyStructure(body) {
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

  return { ok: issues.length === 0, issues, exploratory: hasSurvey };
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
  return `---\n${stringifyYaml(frontmatter)}---\n\n${body.trim()}\n`;
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
  frontmatter.status = frontmatterDraft.status ?? "active";
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

  const bodyCheck = validateBodyStructure(body);
  if (!bodyCheck.ok) {
    return failure("research/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  if (bodyCheck.exploratory !== exploratory) {
    return failure("research/substage_mismatch", `body structure implies ${bodyCheck.exploratory ? "exploratory" : "directed"} but surveyBody says ${exploratory ? "exploratory" : "directed"}`);
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
  const lines = analysisBody.split("\n");
  const insertIndex = lines.findIndex((line) => line.trim() === "## 输入与边界");
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
  // Strip caller-only params before building the persistent frontmatter
  const { change_summary: _strippedUpdate, ...afterFields } = frontmatterAfter;
  const fm = { ...afterFields };
  fm.object_uid = objectUid;
  fm.fact_type_key = RESEARCH_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

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
  const bodyCheck = validateBodyStructure(body);
  if (!bodyCheck.ok) {
    return failure("research/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  if (bodyCheck.exploratory !== isExploratory) {
    return failure("research/substage_mismatch", "updated body structure does not match declared sub-stage");
  }

  // Atomic single-file write
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}
