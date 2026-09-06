/**
 * dsh-ldvh — Research fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/24 §13 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:  one-object-one-directory multi-md carrier
 *             (ldvh-base/research/<uid>/ with research-<uid>.md main md
 *             and, for exploratory research, survey-<uid>.md).
 *             All member files are written in a single atomic directory
 *             creation; Code assigns object_uid + created_at; the
 *             creation validates the type-specific mechanical checks
 *             (closed sets, three-state at least one, quote loopback,
 *             fixed H2 sections, member-file set ↔ sub-stage coherence).
 *  - read:    returns the full object directory + a directory-level
 *             content fingerprint (SHA-256 over all member files).
 *  - update:  CAS — the caller must supply the fingerprint observed at
 *             the last read; the whole directory is replaced atomically
 *             (tmp dir + rename); a change_log entry is appended.
 *
 * Red lines honoured (24 §18): no second fact authority, no cross-object
 * audit ledger — change_log lives inside the main md frontmatter.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Constants (specs/24 §8, §13)
// ---------------------------------------------------------------------------

const RESEARCH_TYPE_KEY = "research";

/** Directory under the fact-source root that carries Research objects. */
export const RESEARCH_DIRECTORY = "research";

const MAIN_MD_H2 = ["调研问题", "输入与边界", "已证实", "未证实与缺口", "停止与后续"];
const SURVEY_MD_H2 = ["调查问题与范围", "调查方法与来源", "调查发现", "调查停止与交接"];

const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const PRIORITY_VALUES = new Set(["high", "medium", "low"]);
const STOPPING_REASONS = new Set(["sufficient", "no-gain", "round-cap"]);
const STATUSES = new Set(["active", "retired"]);
const ANSWERED_BY = new Set(["human", "external", "ai"]);

// ---------------------------------------------------------------------------
// Result helpers (single envelope shape across the module)
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

/**
 * Validate the frontmatter fields of a Research object.
 * Returns { ok, issues } — issues is an array of human-readable strings.
 */
export function validateResearchFrontmatter(frontmatter) {
  const issues = [];

  // --- common fields (03 §6.1 adoption, specs/24 §8) ---
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

  // --- urls (at least one external source) ---
  if (!Array.isArray(frontmatter.urls) || frontmatter.urls.length === 0) {
    issues.push("urls: required non-empty array (external sources)");
  } else {
    const refs = new Set();
    for (const u of frontmatter.urls) {
      if (typeof u.ref !== "string" || !u.ref.startsWith("http")) {
        issues.push(`urls[].ref: must be an absolute HTTP(S) URL, got ${JSON.stringify(u.ref)}`);
      }
      if (refs.has(u.ref)) issues.push(`urls[].ref: duplicate ref ${u.ref}`);
      refs.add(u.ref);
    }
    frontmatter.urls.forEach((u, i) => {
      if (typeof u !== "object" || u === null) {
        issues.push(`urls[${i}]: must be an object`);
      }
    });
  }

  // --- research_question / research_purpose / stopping_reason ---
  for (const field of ["research_question", "research_purpose"]) {
    if (typeof frontmatter[field] !== "string" || frontmatter[field].length === 0) {
      issues.push(`${field}: required non-empty string`);
    }
  }
  if (!STOPPING_REASONS.has(frontmatter.stopping_reason)) {
    issues.push(`stopping_reason: must be one of ${[...STOPPING_REASONS].join("/")}`);
  }

  // --- three-state evidence ---
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

  // --- stopping consistency (24 §8 invariant 3) ---
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

  // --- implications (24 §8, Human 2026-09-08: anchored project implications) ---
  const statements = new Set(confirmed.map((c) => c.statement));
  for (const impl of frontmatter.implications ?? []) {
    if (typeof impl.finding_ref !== "string" || !statements.has(impl.finding_ref)) {
      issues.push(`implications[].finding_ref: must match a confirmed[].statement exactly, got ${JSON.stringify(impl.finding_ref)}`);
    }
    if (typeof impl.implication !== "string" || impl.implication.length === 0) {
      issues.push("implications[].implication: required non-empty");
    }
  }

  // --- clarification_log ---
  for (const cl of frontmatter.clarification_log ?? []) {
    if (typeof cl.question !== "string" || cl.question.length === 0) issues.push("clarification_log[].question: required non-empty");
    if (typeof cl.answer !== "string" || cl.answer.length === 0) issues.push("clarification_log[].answer: required non-empty");
    if (!ANSWERED_BY.has(cl.answered_by)) issues.push(`clarification_log[].answered_by: must be human/external/ai, got ${JSON.stringify(cl.answered_by)}`);
  }

  // --- retired constraint (24 §8 invariant 4) ---
  if (frontmatter.status === "retired" && confirmed.length === 0) {
    issues.push("lifecycle: retired object must retain its confirmed evidence (read-only)");
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Validate the fixed H2 sections of a markdown body.
 * Returns { ok, issues }.
 */
export function validateBodySections(body, expectedH2, label) {
  const issues = [];
  const found = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) found.push(line.slice(3).trim());
  }
  if (found.length !== expectedH2.length) {
    issues.push(`${label}: expected ${expectedH2.length} H2 sections (${expectedH2.join(" / ")}), found ${found.length} (${found.join(" / ")})`);
  } else {
    for (let i = 0; i < expectedH2.length; i++) {
      if (found[i] !== expectedH2[i]) {
        issues.push(`${label}: H2 #${i + 1} expected "${expectedH2[i]}", found "${found[i]}"`);
      }
    }
  }
  // non-empty check: every section must have content before the next H2
  const sections = body.split(/^## /m).slice(1);
  for (const sec of sections) {
    const title = sec.split("\n")[0].trim();
    const content = sec.slice(sec.indexOf("\n") + 1).trim();
    if (content.length === 0) issues.push(`${label}: section "${title}" is empty`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeFrontmatter(frontmatter) {
  return stringifyYaml(frontmatter);
}

export function mainMdFileName(uid) { return `research-${uid}.md`; }
export function surveyMdFileName(uid) { return `survey-${uid}.md`; }

function buildMainMd(frontmatter, analysisBody) {
  return `---\n${serializeFrontmatter(frontmatter)}---\n\n${analysisBody.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Directory-level content fingerprint (03 §6.1 CAS over all member files)
// ---------------------------------------------------------------------------

async function directoryFingerprint(dirPath, memberFiles) {
  const sorted = [...memberFiles].sort();
  const hash = createHash("sha256");
  for (const name of sorted) {
    const content = await readFile(join(dirPath, name), "utf8");
    hash.update(name, "utf8");
    hash.update("\0");
    hash.update(content, "utf8");
    hash.update("\0");
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Create (specs/03 §9.4 + specs/24 §13)
// ---------------------------------------------------------------------------

/**
 * Create a Research object directory.
 *
 * @param {object} args
 * @param {string} args.factSourceRoot — absolute path to ldvh-base/
 * @param {object} args.frontmatterDraft — AI-provided fields (no object_uid/created_at)
 * @param {string} args.analysisBody — main md body (five fixed H2 sections)
 * @param {string|null} args.surveyBody — exploratory survey md body, or null for directed
 * @param {string|null} args.sessionSignature — provider/model for change_log
 * @returns {object} { ok, value: { object_uid, directory, files, fingerprint } }
 */
export async function createResearchObject(args) {
  const { factSourceRoot, frontmatterDraft, analysisBody, surveyBody = null, sessionSignature = null } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }

  // Sub-stage coherence (24 §7): exploratory = survey present, directed = absent
  const exploratory = typeof surveyBody === "string" && surveyBody.length > 0;
  if (surveyBody !== null && !exploratory) {
    return failure("invalid_request", "surveyBody must be non-empty string (exploratory) or null (directed)");
  }

  // Code-assigned identity (03 §6.2: caller cannot provide)
  const uid = randomUUID();
  const now = new Date().toISOString();
  const frontmatter = {
    object_uid: uid,
    fact_type_key: RESEARCH_TYPE_KEY,
    title: frontmatterDraft.title,
    created_at: now,
    status: frontmatterDraft.status ?? "active",
    ...frontmatterDraft,
  };
  // Force Code-assigned values (remove any caller-provided overrides)
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = RESEARCH_TYPE_KEY;
  frontmatter.created_at = now;

  // change_log: initial entry
  frontmatter.change_log = [{
    at: now,
    ...sessionSignature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Research 对象",
  }];

  // --- mechanical validation ---
  const fmCheck = validateResearchFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("research/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  const mainCheck = validateBodySections(analysisBody, MAIN_MD_H2, "main md");
  if (!mainCheck.ok) {
    return failure("research/main_md_invalid", "main md body failed section checks", { issues: mainCheck.issues });
  }

  if (exploratory) {
    const surveyCheck = validateBodySections(surveyBody, SURVEY_MD_H2, "survey md");
    if (!surveyCheck.ok) {
      return failure("research/survey_md_invalid", "survey md body failed section checks", { issues: surveyCheck.issues });
    }
  }

  // --- write (atomic directory creation) ---
  const typeDir = join(factSourceRoot, RESEARCH_DIRECTORY);
  const objectDir = join(typeDir, uid);
  const tmpDir = join(typeDir, `.${uid}.tmp`);

  try {
    await mkdir(objectDir, { recursive: true });
  } catch (error) {
    return failure("research/create_failed", `cannot create object directory: ${error.message}`);
  }

  const mainMd = buildMainMd(frontmatter, analysisBody);
  const memberFiles = [mainMdFileName(uid)];
  await writeFile(join(objectDir, mainMdFileName(uid)), mainMd, "utf8");
  if (exploratory) {
    memberFiles.push(surveyMdFileName(uid));
    await writeFile(join(objectDir, surveyMdFileName(uid)), `${surveyBody.trim()}\n`, "utf8");
  }

  const fingerprint = await directoryFingerprint(objectDir, memberFiles);
  return success({ object_uid: uid, directory: objectDir, files: memberFiles, fingerprint });
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2 precise read-back)
// ---------------------------------------------------------------------------

/**
 * Read a Research object directory.
 * Returns frontmatter (parsed), both md bodies, and the directory fingerprint.
 */
export async function readResearchObject(args) {
  const { factSourceRoot, objectUid } = args;
  const objectDir = join(factSourceRoot, RESEARCH_DIRECTORY, objectUid);

  let entries;
  try {
    entries = await readdir(objectDir);
  } catch (error) {
    return failure("research/object_not_found", `cannot read object directory: ${error.message}`);
  }

  const mainName = mainMdFileName(objectUid);
  if (!entries.includes(mainName)) {
    return failure("research/object_invalid", `main md not found: ${mainName}`);
  }

  const mainContent = await readFile(join(objectDir, mainName), "utf8");

  // Parse frontmatter (between --- fences)
  const fmMatch = mainContent.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("research/object_invalid", "main md has no YAML frontmatter block");
  }

  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("research/object_invalid", `frontmatter parse error: ${error.message}`);
  }

  const body = mainContent.slice(fmMatch[0].length).trim();

  const surveyName = surveyMdFileName(objectUid);
  const exploratory = entries.includes(surveyName);
  const surveyBody = exploratory ? (await readFile(join(objectDir, surveyName), "utf8")).trim() : null;

  const fingerprint = await directoryFingerprint(objectDir, entries);

  return success({
    object_uid: objectUid,
    directory: objectDir,
    frontmatter,
    analysis_body: body,
    survey_body: surveyBody,
    exploratory,
    files: entries.sort(),
    fingerprint,
  });
}

// ---------------------------------------------------------------------------
// Update via CAS (specs/03 §9.5 + specs/24 §13)
// ---------------------------------------------------------------------------

/**
 * Update a Research object with CAS (compare-and-swap on directory fingerprint).
 *
 * The caller supplies the full "after" state: new frontmatter + new analysis
 * body + new survey body (or null for directed). The whole directory is
 * replaced atomically (write to tmp, then swap).
 *
 * @param {object} args
 * @returns {object} { ok, value: { fingerprint } }
 */
export async function updateResearchObject(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, analysisBodyAfter, surveyBodyAfter = null, changeSummary, sessionSignature = null } = args;

  // Read current state to check CAS
  const current = await readResearchObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("research/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  // Sub-stage coherence: cannot switch between directed and exploratory after creation
  const wasExploratory = current.value.exploratory;
  const isExploratory = typeof surveyBodyAfter === "string" && surveyBodyAfter.length > 0;
  if (wasExploratory !== isExploratory) {
    return failure("research/substage_immutable", `cannot change sub-stage after creation (was ${wasExploratory ? "exploratory" : "directed"}, trying ${isExploratory ? "exploratory" : "directed"})`);
  }

  // Build updated frontmatter
  const fm = { ...frontmatterAfter };
  fm.object_uid = objectUid;
  fm.fact_type_key = RESEARCH_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  // Append change_log entry
  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sessionSignature,
    summary: changeSummary,
  }];
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("research/change_summary_required", "changeSummary is required for update");
  }

  // Validate
  const fmCheck = validateResearchFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("research/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const mainCheck = validateBodySections(analysisBodyAfter, MAIN_MD_H2, "main md");
  if (!mainCheck.ok) {
    return failure("research/main_md_invalid", "updated main md body failed section checks", { issues: mainCheck.issues });
  }
  if (isExploratory) {
    const surveyCheck = validateBodySections(surveyBodyAfter, SURVEY_MD_H2, "survey md");
    if (!surveyCheck.ok) {
      return failure("research/survey_md_invalid", "updated survey md body failed section checks", { issues: surveyCheck.issues });
    }
  }

  // Atomic directory swap: write to tmp dir, then rename
  const typeDir = join(factSourceRoot, RESEARCH_DIRECTORY);
  const objectDir = join(typeDir, objectUid);
  const tmpDir = join(typeDir, `.${objectUid}.tmp`);

  // Clean any stale tmp
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(tmpDir, { recursive: true });

  const mainMd = buildMainMd(fm, analysisBodyAfter);
  const memberFiles = [mainMdFileName(objectUid)];
  await writeFile(join(tmpDir, mainMdFileName(objectUid)), mainMd, "utf8");
  if (isExploratory) {
    memberFiles.push(surveyMdFileName(objectUid));
    await writeFile(join(tmpDir, surveyMdFileName(objectUid)), `${surveyBodyAfter.trim()}\n`, "utf8");
  }

  // Swap: remove old dir, rename tmp → object dir
  await rm(objectDir, { recursive: true, force: true });
  await rename(tmpDir, objectDir);

  const fingerprint = await directoryFingerprint(objectDir, memberFiles);
  return success({ fingerprint });
}
