
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";
import { scanCarrierDirectory } from "./carrier-scan.js";
import { h2Titles, h3TitlesInSection, sectionContent } from "./markdown-structure.js";
import { parseObjectIdentifier, resolveShortId } from "./object-identifier.js";
import { carrierCoherenceMessage } from "./coherence-report.js";


const REPORT_TYPE_KEY = "report";

export const REPORT_DIRECTORY = "reports";

const MAIN_H2_DIRECTED = ["研究问题", "输入与边界", "关键发现", "未证实与缺口", "建议", "后续分流"];
const MAIN_H2_EXPLORATORY = ["研究问题", "输入与边界", "调查阶段", "关键发现", "未证实与缺口", "建议", "后续分流"];
const SURVEY_H3 = ["调查问题与范围", "调查方法与来源", "调查发现", "调查停止与交接"];
const MAIN_H2_SUMMARY = ["范围与目的", "工作与结论", "证据摘录", "遗留与下一步"];
const MAIN_H2_AUDIT = ["被审对象与背景", "审核结论", "证据性发现", "未覆盖范围与保证边界", "后续处置"];
const MAIN_H2_ACTION = ["行动目标与背景", "执行过程", "结果与结论", "证据摘录", "遗留与下一步"];
const MAIN_H2_REFERENCE = ["参考内容", "出处与来源", "记录理由", "未验证与疑点", "后续核验方向"];

const PRIORITY_VALUES = new Set(["high", "medium", "low"]);
const STOPPING_REASONS = new Set(["sufficient", "no-gain", "round-cap"]);
const REPORT_FORMS = new Set(["research", "summary", "audit", "action", "reference"]);
const STATUSES = new Set(["active", "retired"]);
const ANSWERED_BY = new Set(["human", "external", "ai"]);
const RETIREMENT_REASONS = new Set(["outdated", "superseded", "out-of-scope", "rejected"]);

const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status", "report_form",
  "urls", "relations", "change_log",
  "research_question", "research_purpose", "stopping_reason", "confirmed_statements", "uncertain", "gaps",
  "implications", "clarification_log",
  "serves",
  "retirement_reason", "retired_at",
]);

export const REPORT_REMOVABLE_FIELDS = new Set(["uncertain", "gaps", "clarification_log", "implications"]);

const RELATION_KEYS = new Set(["inspired-by", "informs", "updates"]);
const FORBIDDEN_RELATION_KEYS = new Set(["supersedes", "depends-on"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}


export function validateResearchFrontmatter(frontmatter, { allowRetiredAtMissing = false, body = null } = {}) {
  const issues = [];

  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 24 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  const LEGACY_TYPE_KEYS = new Set(["research", REPORT_TYPE_KEY]);
  if (!LEGACY_TYPE_KEYS.has(frontmatter.fact_type_key)) {
    issues.push(`fact_type_key: must be "${REPORT_TYPE_KEY}" (legacy "research" accepted during migration, 02 §6.4)`);
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

  const hasForm = frontmatter.report_form !== undefined;
  const form = hasForm ? frontmatter.report_form : "research";
  if (hasForm && !REPORT_FORMS.has(form)) {
    issues.push(`report_form: must be one of ${[...REPORT_FORMS].join("/")}`);
  }
  const isResearch = form === "research";

  if (isResearch) {
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
  } else if (frontmatter.urls !== undefined) {
    issues.push(`urls: forbidden for report_form=${form} (internal sources use §10.2 anchors, not urls)`);
  }

  if (isResearch) {
  for (const field of ["research_question", "research_purpose"]) {
    if (typeof frontmatter[field] !== "string" || frontmatter[field].length === 0) {
      issues.push(`${field}: required non-empty string`);
    }
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
  if (frontmatter.stopping_reason === "round-cap" && gaps.length === 0 && form !== "reference") {
    const diversion = sectionContent(body ?? "", "后续分流");
    if (diversion === null || diversion.length === 0) {
      issues.push("stopping consistency: round-cap must declare unmet scope in gaps or in the body's 后续分流 section");
    }
  }

  if (form === "reference") {
    if (confirmed_statements.length > 0) {
      issues.push("report_form=reference is for unverified content: confirmed_statements must be empty");
    }
    if (uncertain.length === 0 && gaps.length === 0) {
      issues.push("report_form=reference requires at least one uncertain or gaps entry to record what is unverified");
    }
    if (frontmatter.stopping_reason === "sufficient") {
      issues.push("report_form=reference forbids stopping_reason=sufficient (content is explicitly unverified)");
    }
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

  if (frontmatter.status === "retired") {
    if (typeof frontmatter.retirement_reason !== "string" || frontmatter.retirement_reason.length === 0) {
      issues.push("lifecycle: status=retired requires non-empty retirement_reason (closed set: outdated/superseded/out-of-scope/rejected)");
    } else if (!RETIREMENT_REASONS.has(frontmatter.retirement_reason)) {
      issues.push(`lifecycle: retirement_reason must be one of ${[...RETIREMENT_REASONS].join("/")}, got ${JSON.stringify(frontmatter.retirement_reason)}`);
    }
    if (!allowRetiredAtMissing && (typeof frontmatter.retired_at !== "string" || frontmatter.retired_at.length === 0)) {
      issues.push("lifecycle: status=retired requires retired_at (ISO 8601, Code-assigned — AI must not supply this field)");
    }
  } else {
    if (frontmatter.retirement_reason !== undefined) {
      issues.push("lifecycle: retirement_reason must not be present when status=active");
    }
    if (frontmatter.retired_at !== undefined) {
      issues.push("lifecycle: retired_at must not be present when status=active");
    }
  }

  if (frontmatter.status === "retired" && frontmatter.retirement_reason === "superseded") {
    const hasUpdates = (frontmatter.relations ?? []).some((r) => r?.relation_key === "updates");
    if (!hasUpdates) {
      issues.push("lifecycle: retirement_reason=superseded requires at least one updates relation in relations[] pointing to the replacement Research");
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

function updatesTargetUid(frontmatter, selfUid) {
  for (const rel of frontmatter.relations ?? []) {
    if (rel?.relation_key === "updates" && rel?.target?.object_uid !== selfUid) {
      return rel.target.object_uid;
    }
  }
  return null;
}


export function validateBodyStructure(body, retirementMode = false, reportForm = "research") {
  const issues = [];
  const h2 = h2Titles(body);
  const INTERNAL_FORM_H2 = { summary: MAIN_H2_SUMMARY, audit: MAIN_H2_AUDIT, action: MAIN_H2_ACTION, reference: MAIN_H2_REFERENCE };
  if (INTERNAL_FORM_H2[reportForm]) {
    const expected = INTERNAL_FORM_H2[reportForm];
    if (h2.includes("调查阶段")) {
      issues.push(`body: 「调查阶段」H2 is forbidden for report_form=${reportForm} (sub-stage belongs to research only, 24 §7)`);
    }
    if (h2.length !== expected.length) {
      issues.push(`body: expected ${expected.length} H2 sections (${expected.join(" / ")}), found ${h2.length} (${h2.join(" / ")})`);
    } else {
      for (let i = 0; i < expected.length; i++) {
        if (h2[i] !== expected[i]) {
          issues.push(`body: H2 #${i + 1} expected "${expected[i]}", found "${h2[i]}"`);
        }
      }
    }
    return { ok: issues.length === 0, issues, exploratory: false };
  }
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

  const sections = body.split(/^## /m).slice(1);
  for (const sec of sections) {
    const title = sec.split("\n")[0].trim();
    const content = sec.slice(sec.indexOf("\n") + 1).trim();
    if (content.length === 0) issues.push(`body: section "${title}" is empty`);
  }

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

export function validateIndexBodyCoherence(frontmatter, body) {
  const issues = [];
  const urlRefs = new Set((frontmatter.urls ?? []).map((u) => u.ref).filter((r) => typeof r === "string"));
  const units = extractFindingUnits(body);
  const statements = frontmatter.confirmed_statements ?? [];

  if (statements.length > 0 && units.length === 0) {
    issues.push("index-body coherence: confirmed_statements is non-empty but 关键发现 has no finding units");
  }

  const unitTitles = new Set(units.map((u) => u.title));
  for (const s of statements) {
    if (!unitTitles.has(s)) {
      issues.push(`index-body coherence: confirmed_statement "${s.slice(0, 40)}..." has no verbatim finding unit (H3 title) match`);
    }
  }

  for (const u of units) {
    if (!u.hasTrace) {
      issues.push(`trace anchor: finding unit "${u.title.slice(0, 40)}..." has no 溯源：<ref>（<anchor>） line`);
    } else if (!urlRefs.has(u.traceRef)) {
      issues.push(`trace anchor: ref "${u.traceRef}" in unit "${u.title.slice(0, 40)}..." does not match any urls[].ref`);
    }
  }

  const question = typeof frontmatter.research_question === "string"
    ? frontmatter.research_question.trim()
    : "";
  if (question.length > 0) {
    const sections = body.split(/^## /m).slice(1);
    const qSection = sections.find((s) => s.split("\n")[0].trim() === "研究问题");
    const qContent = qSection ? qSection.slice(qSection.indexOf("\n") + 1).trim() : "";
    if (!qContent.includes(question)) {
      issues.push(carrierCoherenceMessage({
        section: "研究问题", field: "research_question", declared: question, actual: qContent,
        clause: "24 §8 invariant 10",
      }));
    }
  }

  return { ok: issues.length === 0, issues };
}


export const INTERNAL_SOURCE_KINDS = new Set(["commit", "object", "session", "run-record"]);

const COMMIT_LOCATOR_PATTERN = /^[0-9a-f]{40}$/;

const INTERNAL_SOURCE_PATTERN = /^\s*来源：([^\s（]+)（(.+?)）\s*$/;

export function validateInternalSourceAnchors(body, { requireAny = false, resolveObject = null } = {}) {
  const issues = [];
  const anchors = [];
  if (typeof body !== "string") {
    return { ok: false, issues: ["internal-source: body must be a string"], anchors };
  }
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(INTERNAL_SOURCE_PATTERN);
    if (!m) continue;
    const kind = m[1];
    const locator = m[2].trim();
    anchors.push({ kind, locator });
    if (!INTERNAL_SOURCE_KINDS.has(kind)) {
      issues.push(`internal-source: kind "${kind}" not in closed set {${[...INTERNAL_SOURCE_KINDS].join(", ")}} (24 §10.2)`);
      continue;
    }
    if (kind === "commit") {
      if (!COMMIT_LOCATOR_PATTERN.test(locator)) {
        issues.push(`internal-source: commit locator must be 40 lowercase hex chars, got ${JSON.stringify(locator)} (24 §10.2)`);
      }
    } else if (kind === "object") {
      if (!UUID_PATTERN.test(locator)) {
        issues.push(`internal-source: object locator must be a canonical object_uid, got ${JSON.stringify(locator)} (24 §10.2)`);
      } else if (typeof resolveObject === "function" && resolveObject(locator) === false) {
        issues.push(`internal-source: object locator does not resolve to an existing object: ${locator} (24 §10.2)`);
      }
    } else {
      if (locator.length === 0) {
        issues.push(`internal-source: ${kind} locator must be non-empty (24 §10.2)`);
      }
    }
    if (/(^|\/)docs\//.test(locator)) {
      issues.push(`internal-source: docs/ path must not be used as locator — quote the content verbatim into the body instead (24 §10.2 禁止事项 1)`);
    }
    if (/^(\/|~|[A-Za-z]:[\\/])/.test(locator)) {
      issues.push(`internal-source: absolute/local path must not be used as locator (24 §10.2 禁止事项 2)`);
    }
  }
  if (requireAny && anchors.length === 0) {
    issues.push("internal-source: summary/audit body must carry at least one 来源：<kind>（<locator>） anchor (24 §10.2)");
  }
  return { ok: issues.length === 0, issues, anchors };
}

async function resolveInternalObjectLocators(factSourceRoot, anchors) {
  const issues = [];
  for (const { kind, locator } of anchors) {
    if (kind !== "object" || !UUID_PATTERN.test(locator)) continue;
    try {
      await access(objectFilePath(factSourceRoot, locator));
    } catch {
      issues.push(`internal-source: object locator does not resolve to an existing report object: ${locator} (24 §10.2)`);
    }
  }
  return issues;
}


export const RESEARCH_CORRECTABLE_FIELDS = new Set([
  "confirmed_statements", "uncertain", "gaps", "implications", "research_question",
]);

export async function correctResearchObject(args) {
  const {
    factSourceRoot, objectUid: objectUidInput, expectedFingerprint,
    frontmatterAfter = null, analysisBodyAfter, surveyBodyAfter = null,
    changeSummary, humanAuthorization, sessionSignature = null, currentProjectId = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  const uidResolution = await resolveResearchObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
  if (typeof changeSummary !== "string" || changeSummary.trim().length === 0) {
    return failure("research/change_summary_required", "changeSummary is required for correct");
  }
  if (typeof humanAuthorization !== "string" || humanAuthorization.trim().length === 0) {
    return failure(
      "research/human_authorization_required",
      "humanAuthorization is required for action=correct (24 §13 终态事实更正：Human 确认；无授权记录的更正请求 fail-closed)",
    );
  }
  if (typeof analysisBodyAfter !== "string" || analysisBodyAfter.length === 0) {
    return failure("invalid_request", "analysisBodyAfter is required (the complete target body)");
  }

  const current = await readResearchObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("research/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  const fm = structuredClone(current.value.frontmatter);
  if (fm.status !== "retired") {
    return failure(
      "research/correction_requires_retired",
      `action=correct applies to status=retired only; this object is ${JSON.stringify(fm.status)} — active 的内容修正走 update`,
    );
  }

  if (frontmatterAfter !== null) {
    if (typeof frontmatterAfter !== "object" || Array.isArray(frontmatterAfter)) {
      return failure("invalid_request", "frontmatterAfter must be an object when provided (24 §13)");
    }
    for (const field of Object.keys(frontmatterAfter)) {
      if (field === "status" || field === "retirement_reason" || field === "retired_at") {
        return failure(
          "research/correction_terminal_field_immutable",
          `correct may not touch ${JSON.stringify(field)} — 24 §13: 终态判定与 retirement 字段逐字继承，本入口不得改变记录为何退出`,
        );
      }
      if (field === "stopping_reason") {
        return failure(
          "research/correction_judgment_field_immutable",
          "correct may not touch \"stopping_reason\" — 它是停止判断而非错述；改动它属判断变更，不是本入口的业务 (24 §13)",
        );
      }
      if (!RESEARCH_CORRECTABLE_FIELDS.has(field)) {
        return failure(
          "research/correction_field_not_permitted",
          `correct may only write ${[...RESEARCH_CORRECTABLE_FIELDS].join("/")}; got ${JSON.stringify(field)} (24 §13)`,
        );
      }
      fm[field] = structuredClone(frontmatterAfter[field]);
    }
  }

  const wasExploratory = current.value.exploratory;
  const isExploratory = typeof surveyBodyAfter === "string" && surveyBodyAfter.length > 0;
  if (wasExploratory !== isExploratory) {
    return failure("research/substage_immutable", `cannot change sub-stage through correct (was ${wasExploratory ? "exploratory" : "directed"})`);
  }
  const body = isExploratory
    ? insertSurveySection(analysisBodyAfter, surveyBodyAfter.trim())
    : analysisBodyAfter;

  const bodyCheck = validateBodyStructure(body, true, fm.report_form ?? "research");
  if (!bodyCheck.ok) {
    return failure("research/body_invalid", "corrected body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateIndexBodyCoherence(fm, body);
  if (!coherenceCheck.ok) {
    return failure("research/coherence_invalid", "index-body coherence failed on correction", { issues: coherenceCheck.issues });
  }

  const trimEnd = (text) => text.replace(/\s+$/, "");
  const bodyUnchanged = trimEnd(body) === trimEnd(current.value.body);
  const changedFields = Object.keys(frontmatterAfter ?? {});
  if (bodyUnchanged && changedFields.length === 0) {
    return failure(
      "research/no_op",
      "correction would not change the body or any correctable field — 02 §10.5 不记录 no-op；refusing to append a change_log entry that claims a correction happened",
    );
  }

  const prevLog = Array.isArray(fm.change_log) ? fm.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: `事实更正（非状态转换）——${changeSummary}。终态判定未变：status/retirement_reason/retired_at/urls/research_purpose/stopping_reason 逐字继承落盘对象，可写范围仅 ${[...RESEARCH_CORRECTABLE_FIELDS].join("／")} 与正文（24 §13）。经 Human 授权：${humanAuthorization.trim()}`,
  }];

  const fmCheck = validateResearchFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("research/frontmatter_invalid", "corrected frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}


export async function listResearchObjects(args) {
  const { factSourceRoot, includeRetired = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }

  const typeDir = join(factSourceRoot, REPORT_DIRECTORY);
  let scanned;
  try {
    scanned = await scanCarrierDirectory(typeDir, "report");
  } catch (error) {
    return failure("research/directory_unavailable", `cannot read researches directory: ${error.message}`);
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
    if (!includeRetired && status !== "active") continue;
    items.push({
      object_uid: uid,
      fact_type_key: typeof frontmatter.fact_type_key === "string" ? frontmatter.fact_type_key : REPORT_TYPE_KEY,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      research_question: typeof frontmatter.research_question === "string" ? frontmatter.research_question : undefined,
      research_purpose: typeof frontmatter.research_purpose === "string" ? frontmatter.research_purpose : undefined,
      stopping_reason: typeof frontmatter.stopping_reason === "string" ? frontmatter.stopping_reason : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}


export function reportFileName(uid) { return `report-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, REPORT_DIRECTORY, reportFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

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


export async function createResearchObject(args) {
  const { factSourceRoot, frontmatterDraft, analysisBody, surveyBody = null, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }

  const exploratory = typeof surveyBody === "string" && surveyBody.length > 0;
  if (surveyBody !== null && !exploratory) {
    return failure("invalid_request", "surveyBody must be non-empty string (exploratory) or null (directed)");
  }

  let body;
  if (exploratory) {
    body = insertSurveySection(analysisBody, surveyBody.trim());
  } else {
    body = analysisBody;
  }

  const uid = randomUUID();
  const now = new Date().toISOString();
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = REPORT_TYPE_KEY;
  frontmatter.created_at = now;
  if (frontmatter.status !== undefined && frontmatter.status !== "active") {
    return failure("research/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(frontmatter.status)} (24 §9: 初态只能是 active；retired 是转换，不是初态)`);
  }
  frontmatter.status = "active";
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Research 对象",
  }];

  const fmCheck = validateResearchFrontmatter(frontmatter, { body });
  if (!fmCheck.ok) {
    return failure("research/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
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

  const bodyCheck = validateBodyStructure(body, false, frontmatter.report_form ?? "research");
  if (!bodyCheck.ok) {
    return failure("research/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  if (bodyCheck.exploratory !== exploratory) {
    return failure("research/substage_mismatch", `body structure implies ${bodyCheck.exploratory ? "exploratory" : "directed"} but surveyBody says ${exploratory ? "exploratory" : "directed"}`);
  }

  if (frontmatter.report_form === "summary" || frontmatter.report_form === "audit" || frontmatter.report_form === "action" || frontmatter.report_form === "reference") {
    const anchorCheck = validateInternalSourceAnchors(body, { requireAny: true });
    const resolved = await resolveInternalObjectLocators(factSourceRoot, anchorCheck.anchors);
    const allIssues = [...anchorCheck.issues, ...resolved];
    if (allIssues.length > 0) {
      return failure("research/internal_source_anchor_invalid", "internal source anchors failed mechanical checks", { issues: allIssues });
    }
  }

  const coherenceCheck = validateIndexBodyCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("research/coherence_invalid", "index-body coherence failed", { issues: coherenceCheck.issues });
  }

  const typeDir = join(factSourceRoot, REPORT_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  const fingerprint = fileFingerprint(content);
  return success({ object_uid: uid, file: filePath, fingerprint });
}

function insertSurveySection(analysisBody, surveyH3Content) {
  const lines = analysisBody.split("\n");
  const insertIndex = lines.findIndex((line) => line.trim() === "## 关键发现");
  if (insertIndex === -1) {
    return analysisBody + "\n\n## 调查阶段\n\n" + surveyH3Content + "\n";
  }
  const surveySection = ["## 调查阶段", "", surveyH3Content, ""];
  lines.splice(insertIndex, 0, ...surveySection);
  return lines.join("\n");
}


export async function resolveResearchObjectUid(factSourceRoot, input, currentProjectId = null) {
  const parsed = parseObjectIdentifier(input);
  if (!parsed.ok) {
    return { ok: false, error: failure("research/invalid_uid", `${parsed.error.code}: ${parsed.error.message}`) };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  if (projectId !== undefined && currentProjectId !== null && projectId !== currentProjectId) {
    return { ok: false, error: failure("research/invalid_uid", `foreign_project: identifier targets project "${projectId}", but this session is governed by "${currentProjectId}" — cross-project reads are not supported by this entry`) };
  }
  if (objectUid !== undefined) {
    if (declaredType !== undefined && declaredType !== REPORT_TYPE_KEY) {
      return { ok: false, error: failure("research/invalid_uid", `type_prefix_mismatch: identifier declares type "${declaredType}", but this entry reads "${REPORT_TYPE_KEY}" objects`) };
    }
    return { ok: true, objectUid };
  }
  const resolved = await resolveShortId({ factSourceRoot, shortId, declaredType });
  if (!resolved.ok) {
    const extra = resolved.error.candidates === undefined ? "" : `; candidates: ${resolved.error.candidates.join(", ")}`;
    return { ok: false, error: failure("research/invalid_uid", `${resolved.error.code}: ${resolved.error.message}${extra}`) };
  }
  if (resolved.value.factTypeKey !== REPORT_TYPE_KEY) {
    return { ok: false, error: failure("research/invalid_uid", `type_prefix_mismatch: short id "${shortId}" resolves to a ${resolved.value.factTypeKey} object, but this entry reads "${REPORT_TYPE_KEY}" objects`) };
  }
  return { ok: true, objectUid: resolved.value.objectUid };
}

export async function readResearchObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, currentProjectId = null } = args;
  const uidResolution = await resolveResearchObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
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
  const structure = validateBodyStructure(body, false, frontmatter.report_form ?? "research");

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


export async function updateResearchObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, expectedFingerprint, frontmatterAfter, frontmatterRemovals = null, analysisBodyAfter, surveyBodyAfter = null, changeSummary, sessionSignature = null, currentProjectId = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("research/change_summary_required", "changeSummary is required for update");
  }
  const uidResolution = await resolveResearchObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;

  const current = await readResearchObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("research/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  const wasExploratory = current.value.exploratory;
  const isExploratory = typeof surveyBodyAfter === "string" && surveyBodyAfter.length > 0;
  if (wasExploratory !== isExploratory) {
    return failure("research/substage_immutable", `cannot change sub-stage after creation (was ${wasExploratory ? "exploratory" : "directed"}, trying ${isExploratory ? "exploratory" : "directed"})`);
  }

  let body;
  if (isExploratory) {
    body = insertSurveySection(analysisBodyAfter, surveyBodyAfter.trim());
  } else {
    body = analysisBodyAfter;
  }

  const built = buildUpdateFrontmatter({
    currentFrontmatter: current.value.frontmatter,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: REPORT_REMOVABLE_FIELDS,
    typeLabel: "research",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const fm = built.value;
  fm.object_uid = objectUid;
  fm.fact_type_key = REPORT_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const prevStatus = current.value.frontmatter.status;
  const nextStatus = fm.status;
  if (nextStatus === "retired") {
    if (prevStatus === "retired") {
      return failure("research/status_terminal", "status=retired is terminal and cannot be re-entered (24 §9)");
    }
    if (prevStatus !== "active") {
      return failure("research/status_transition_invalid", `transition ${prevStatus} → retired is not allowed (24 §9: only active → retired)`);
    }
    fm.retired_at = new Date().toISOString();
  } else if (nextStatus === "active" && prevStatus === "retired") {
    return failure("research/status_terminal", "status=retired is terminal and cannot be re-opened (24 §9)");
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  const fmCheck = validateResearchFrontmatter(fm, { body });
  if (!fmCheck.ok) {
    return failure("research/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
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
  const bodyCheck = validateBodyStructure(body, fm.status === "retired", fm.report_form ?? "research");
  if (!bodyCheck.ok) {
    return failure("research/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  if (bodyCheck.exploratory !== isExploratory) {
    return failure("research/substage_mismatch", "updated body structure does not match declared sub-stage");
  }

  if (fm.report_form === "summary" || fm.report_form === "audit" || fm.report_form === "action" || fm.report_form === "reference") {
    const anchorCheck = validateInternalSourceAnchors(body, { requireAny: true });
    const resolved = await resolveInternalObjectLocators(factSourceRoot, anchorCheck.anchors);
    const allIssues = [...anchorCheck.issues, ...resolved];
    if (allIssues.length > 0) {
      return failure("research/internal_source_anchor_invalid", "internal source anchors failed mechanical checks on update", { issues: allIssues });
    }
  }

  const coherenceCheck = validateIndexBodyCoherence(fm, body);
  if (!coherenceCheck.ok) {
    return failure("research/coherence_invalid", "index-body coherence failed on update", { issues: coherenceCheck.issues });
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}
