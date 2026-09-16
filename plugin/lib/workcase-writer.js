/**
 * dsh-ldvh — WorkCase fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/21 §14 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:   flat single-file carrier
 *              (ldvh-base/workcases/workcase-<uid>.md) with YAML
 *              frontmatter + markdown body. Code assigns object_uid +
 *              created_at and generates the H1 from title; creation
 *              validates the type-specific mechanical checks (closed
 *              sets, plan[].done_criteria non-empty, carrier coherence,
 *              serves ⇔ goal.md SG-n resolution).
 *  - read:     returns frontmatter + body + file-level content
 *              fingerprint (SHA-256).
 *  - approve (Gate 1): draft → open. Human Gate on the flow level; the
 *              writer stamps `gate_1` (approved_at + approver supplied by
 *              the flow, authorization_fingerprint computed BY CODE over
 *              the current plan+scope, scope_snapshot copied from the
 *              current scope) and allocates the first attempt token.
 *  - execute: open-period updates — attempt heartbeat / takeover /
 *              reallocation, body progress, result drafts in the body,
 *              relations changes. plan/scope are frozen by C2: any
 *              substantive change is refused here and must go through
 *              rebatch (21 §10.3).
 *  - close (Gate 2): open → closed. Human Gate on the flow level; the
 *              writer stamps result + outcome, retracts the attempt
 *              token (收口) and validates the criteria_checks ⇔ plan
 *              correspondence.
 *  - rebatch:  open → draft (C2 局部重批). attempt voided, result /
 *              outcome cleared (invariant: result ⇔ closed), gate_1
 *              dropped (draft must not carry it); the prior evidence
 *              snapshot goes into the change_log entry (21 §9.2).
 *  - cancel:   draft → closed with outcome=cancelled (21 §9.2: 计划未
 *              经执行即被取消 — Human Gate on the flow level).
 *  - revise:   draft → draft controlled revision (plan/scope may still
 *              evolve before Gate 1; each revision = exactly one
 *              change_log entry).
 *  - list:     F0/F1 discovery projection (draft+open by default,
 *              21 §13: closed 只在精确引用、证据链反查或历史追溯时展开).
 *
 * Authorization pinning (C2, 21 §10.3): the fingerprint binds
 * gate_1.authorization_fingerprint to the content of plan+scope.
 * While status=open, every writer flow verifies the fingerprint still
 * matches; a mismatch is a C2 invalidation and the only legal path is
 * rebatch, never a silent in-place edit.
 *
 * attempt tokens (21 §10.4): monotonic, at most one active, allocated
 * by Code only. attempt_id derives from the change_log history the
 * writer itself produced (each allocation/void is recorded there), so
 * re-entry after an interruption gets a strictly higher id. The token
 * carries NO authorization — authorization only comes from Gate 1.
 *
 * Known spec tension (recorded, deliberately resolved wide at the
 * mechanical layer): 21 §8 states `gate_1 出现 ⇔ status ∈ {open,
 * closed}` while §9.2 defines a draft → closed(cancelled) path whose
 * closed state carries no Gate 1 approval. The writer enforces
 * gate_1 presence for status=open (per §9.1) and validates shape
 * whenever gate_1 is present, but does not require gate_1 on every
 * closed object — the draft-cancelled path would otherwise be
 * unrepresentable. The tension is left for the 32 号 system spec to
 * close; do not "fix" it silently here.
 *
 * Red lines honoured (21 §19): no urls field, no priority, no
 * process-log fields, no WC-to-WC relations (contributed-to → Pitfall
 * only), no multi-attempt reservation, no requirement-review state.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { readGoalAnchors as readGoalAnchorsFromGoal } from "./goal-writer.js";

// ---------------------------------------------------------------------------
// Constants (specs/21 §7, §8, §9)
// ---------------------------------------------------------------------------

const WORKCASE_TYPE_KEY = "workcase";

/** Directory under the fact-source root that carries WorkCase objects. */
export const WORKCASE_DIRECTORY = "workcases";

/** Status closed set (21 §9): draft → open → closed. */
const STATUSES = new Set(["draft", "open", "closed"]);

/** Outcome closed set (21 §9.3): four terminal values. */
const OUTCOMES = new Set(["completed", "partial", "not-achieved", "cancelled"]);

/** Outcomes that require a non-empty residual[]. */
const RESIDUAL_REQUIRED_OUTCOMES = new Set(["partial", "not-achieved"]);

/** Body H2 sections (21 §8). 摘要/授权范围/计划 always present; 执行 and
 * 结果 are conditional (执行 ⇔ execution has happened i.e. status=open or
 * closed-with-gate_1; 结果 ⇔ closed, optional as a draft while open). */
const BODY_H2_CORE = ["摘要", "授权范围", "计划"];
const BODY_H2_EXECUTION = "执行";
const BODY_H2_RESULT = "结果";

/** Title cap (21 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** Relations contract (21 §12): contributed-to → Pitfall only. */
const ALLOWED_RELATION_KEYS = new Set(["contributed-to"]);
const PITFALL_DIRECTORY = "pitfalls";

const OBJECT_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SG_ANCHOR_PATTERN = /^SG-\d+$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/** Frontmatter closed set (21 §8). Anything beyond this is rejected. */
export const VALID_FM_KEYS = new Set([
  "fact_type_key", "object_uid", "title", "status",
  "serves", "summary", "scope", "plan",
  "gate_1", "attempt", "reviews", "result", "outcome",
  "relations", "created_at", "change_log",
]);

/** 21 §8: `reviews` 单条 `summary` 的字符上限（Human 裁定 2026-09-16）。 */
export const REVIEW_SUMMARY_MAX_CHARS = 600;

/** 21 §8: `reviews` 的条数上限（起草者按 Human「其他按你推荐」授权定为 20，比照 20 §8 evolution）。 */
export const REVIEW_ENTRIES_MAX = 20;

// ---------------------------------------------------------------------------
// Small helpers (shared conventions with the pitfall/spark writers)
// ---------------------------------------------------------------------------

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

function h2Titles(body) {
  const out = [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^ {0,3}##[ \t]+(.+?)[ \t]*$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function countAtxHeadings(body, level) {
  const hashes = "#".repeat(level);
  let count = 0;
  let inFence = false;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(new RegExp(`^ {0,3}${hashes}[ \\t]+\\S`));
    if (m) count += 1;
  }
  return count;
}

function sectionContent(body, h2Title) {
  const sections = body.replace(/\r\n?/g, "\n").split(/^## /m);
  const sec = sections.slice(1).find((s) => s.split("\n")[0].trim() === h2Title);
  if (!sec) return null;
  return sec.slice(sec.indexOf("\n") + 1).trim();
}

export function workcaseFileName(uid) { return `workcase-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, WORKCASE_DIRECTORY, workcaseFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  const ordered = orderFrontmatterFields(frontmatter);
  return `---\n${stringifyYaml(ordered)}---\n\n${body}\n`;
}

function orderFrontmatterFields(frontmatter) {
  const order = [
    "fact_type_key", "object_uid", "title", "status",
    "serves", "summary", "scope", "plan",
    "gate_1", "attempt", "result", "outcome",
    "relations", "created_at", "change_log",
  ];
  const out = {};
  for (const key of order) if (key in frontmatter) out[key] = frontmatter[key];
  for (const key of Object.keys(frontmatter)) if (!order.includes(key)) out[key] = frontmatter[key];
  return out;
}

async function atomicWriteFile(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}

function assertValidUid(objectUid) {
  if (typeof objectUid !== "string" || !OBJECT_UID_PATTERN.test(objectUid)) {
    return failure("workcase/invalid_uid", `object_uid must be a canonical UUIDv4, got ${JSON.stringify(objectUid)}`);
  }
  return null;
}

function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.replace(/\s+$/, "")}\n`;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stableStringify(value) {
  // Deterministic JSON (fixed key order, sorted for nested maps) so the
  // authorization fingerprint only changes with content, not ordering.
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** C2 content fingerprint over the authorized pair: plan + scope (21 §10.1). */
export function computeAuthorizationFingerprint(plan, scope) {
  const canonical = stableStringify({ plan, scope });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Frontmatter validation (specs/21 §8 + §15.1)
// ---------------------------------------------------------------------------

function validatePlanShape(frontmatter, issues) {
  if (!Array.isArray(frontmatter.plan) || frontmatter.plan.length === 0) {
    issues.push("plan: must be a non-empty array of {step, done_criteria} (21 §8)");
    return;
  }
  frontmatter.plan.forEach((item, i) => {
    if (!isPlainObject(item)) {
      issues.push(`plan[${i}]: must be an object of shape {step, done_criteria}`);
      return;
    }
    const extra = Object.keys(item).filter((k) => k !== "step" && k !== "done_criteria");
    if (extra.length > 0) issues.push(`plan[${i}]: unexpected field(s) ${extra.join(", ")} (only step/done_criteria, 21 §8)`);
    if (typeof item.step !== "string" || item.step.trim().length === 0) {
      issues.push(`plan[${i}].step: required non-empty`);
    }
    if (typeof item.done_criteria !== "string" || item.done_criteria.trim().length === 0) {
      issues.push(`plan[${i}].done_criteria: required non-empty and evidence-decidable (21 §6.1/§8)`);
    }
  });
}

function validateGate1(frontmatter, issues) {
  const g = frontmatter.gate_1;
  if (!isPlainObject(g)) {
    issues.push("gate_1: must be an object {approved_at, approver, authorization_fingerprint, scope_snapshot} (21 §8)");
    return;
  }
  const extra = Object.keys(g).filter((k) => !["approved_at", "approver", "authorization_fingerprint", "scope_snapshot"].includes(k));
  if (extra.length > 0) issues.push(`gate_1: unexpected field(s) ${extra.join(", ")}`);
  if (typeof g.approved_at !== "string" || !RFC3339_PATTERN.test(g.approved_at)) {
    issues.push("gate_1.approved_at: required RFC3339");
  }
  if (typeof g.approver !== "string" || g.approver.length === 0) {
    issues.push("gate_1.approver: required non-empty (the approving Human identity)");
  }
  if (typeof g.authorization_fingerprint !== "string" || !FINGERPRINT_PATTERN.test(g.authorization_fingerprint)) {
    issues.push("gate_1.authorization_fingerprint: required 64-hex SHA-256 content fingerprint over plan+scope (Code-computed, 21 §10.1)");
  }
  if (typeof g.scope_snapshot !== "string" || g.scope_snapshot.length === 0) {
    issues.push("gate_1.scope_snapshot: required non-empty snapshot of the approved scope (21 §10.1)");
  }
}

function validateAttempt(frontmatter, issues) {
  const a = frontmatter.attempt;
  if (!isPlainObject(a)) {
    issues.push("attempt: must be an object {attempt_id, started_at, controller, heartbeat_at} (21 §8)");
    return;
  }
  const extra = Object.keys(a).filter((k) => !["attempt_id", "started_at", "controller", "heartbeat_at"].includes(k));
  if (extra.length > 0) issues.push(`attempt: unexpected field(s) ${extra.join(", ")}`);
  if (!Number.isInteger(a.attempt_id) || a.attempt_id < 1) {
    issues.push("attempt.attempt_id: required positive integer (Code-allocated, monotonic, 21 §10.4)");
  }
  if (typeof a.started_at !== "string" || !RFC3339_PATTERN.test(a.started_at)) {
    issues.push("attempt.started_at: required RFC3339");
  }
  if (typeof a.controller !== "string" || a.controller.length === 0) {
    issues.push("attempt.controller: required non-empty (the current executing controller identity)");
  }
  if (typeof a.heartbeat_at !== "string" || !RFC3339_PATTERN.test(a.heartbeat_at)) {
    issues.push("attempt.heartbeat_at: required RFC3339 (refreshed at execution entry)");
  }
}

/**
 * 21 §8: `reviews` — 复核节点概要流水。
 *
 * 每项 `{at, provider, model, summary}`；`at`/署名由 Code 托管（此处只校验
 * 形状与存在性），`summary` 非空且 ≤ 600 字符，条数 ≤ 20。
 * 达上限 fail-closed：拒绝写入而非截断或压缩既有条目（防静默丢历史）。
 * 只读复核不产生条目，故本字段缺失是合法状态（条件字段，03 §6.1）。
 */
function validateReviews(frontmatter, issues) {
  const list = frontmatter.reviews;
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    issues.push("reviews: must be an array of {at, provider, model, summary} (21 §8)");
    return;
  }
  if (list.length === 0) {
    issues.push("reviews: must be omitted when there are no review entries — an empty array fabricates a conditional field (03 §6.1)");
    return;
  }
  if (list.length > REVIEW_ENTRIES_MAX) {
    issues.push(`reviews: exceeds the ${REVIEW_ENTRIES_MAX}-entry cap (21 §8); refuse rather than truncate or compress existing entries`);
  }
  list.forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      issues.push(`reviews[${i}]: must be an object {at, provider, model, summary}`);
      return;
    }
    const extra = Object.keys(entry).filter((k) => !["at", "provider", "model", "summary"].includes(k));
    if (extra.length > 0) issues.push(`reviews[${i}]: unexpected field(s) ${extra.join(", ")} (only at/provider/model/summary)`);
    if (typeof entry.at !== "string" || !RFC3339_PATTERN.test(entry.at)) {
      issues.push(`reviews[${i}].at: required RFC3339 (Code-managed)`);
    }
    if (typeof entry.provider !== "string" || entry.provider.length === 0) {
      issues.push(`reviews[${i}].provider: required non-empty (Code-managed authoritative signature)`);
    }
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      issues.push(`reviews[${i}].model: required non-empty (Code-managed authoritative signature)`);
    }
    if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
      issues.push(`reviews[${i}].summary: required non-empty (复核节点概要)`);
    } else if (entry.summary.length > REVIEW_SUMMARY_MAX_CHARS) {
      issues.push(`reviews[${i}].summary: ${entry.summary.length} chars exceeds the ${REVIEW_SUMMARY_MAX_CHARS}-char cap (21 §8)`);
    }
  });
}

function validateResult(frontmatter, issues) {
  const r = frontmatter.result;
  if (!isPlainObject(r)) {
    issues.push("result: must be an object {criteria_checks[], achieved_scope, residual[]} (21 §8)");
    return;
  }
  const extra = Object.keys(r).filter((k) => !["criteria_checks", "achieved_scope", "residual"].includes(k));
  if (extra.length > 0) issues.push(`result: unexpected field(s) ${extra.join(", ")}`);
  if (typeof r.achieved_scope !== "string" || r.achieved_scope.length === 0) {
    issues.push("result.achieved_scope: required non-empty (已证实范围的核对结论)");
  }
  const isCancelled = frontmatter.outcome === "cancelled";
  if (r.criteria_checks !== undefined) {
    if (!Array.isArray(r.criteria_checks)) {
      issues.push("result.criteria_checks: must be an array");
    } else {
      // 逐条对应 plan[].done_criteria — length must match (21 §8 invariant).
      // cancelled may omit the array entirely (nothing was executed).
      if (!isCancelled && r.criteria_checks.length !== frontmatter.plan.length) {
        issues.push(`result.criteria_checks: length ${r.criteria_checks.length} must match plan length ${frontmatter.plan.length} (逐条对应, 21 §8)`);
      }
      r.criteria_checks.forEach((c, i) => {
        if (!isPlainObject(c)) {
          issues.push(`result.criteria_checks[${i}]: must be an object {satisfied, evidence}`);
          return;
        }
        const cExtra = Object.keys(c).filter((k) => k !== "satisfied" && k !== "evidence");
        if (cExtra.length > 0) issues.push(`result.criteria_checks[${i}]: unexpected field(s) ${cExtra.join(", ")}`);
        if (typeof c.satisfied !== "boolean") issues.push(`result.criteria_checks[${i}].satisfied: required boolean`);
        if (typeof c.evidence !== "string" || c.evidence.trim().length === 0) {
          issues.push(`result.criteria_checks[${i}].evidence: required non-empty (核对依据)`);
        }
      });
    }
  } else if (!isCancelled) {
    issues.push("result.criteria_checks: required (one entry per plan step) unless outcome=cancelled (21 §9.3)");
  }
  if (r.residual !== undefined) {
    if (!Array.isArray(r.residual)) {
      issues.push("result.residual: must be an array of strings");
    } else {
      if (r.residual.length === 0 && RESIDUAL_REQUIRED_OUTCOMES.has(frontmatter.outcome)) {
        issues.push(`result.residual: must be non-empty when outcome=${frontmatter.outcome} (21 §9.3)`);
      }
      r.residual.forEach((x, i) => {
        if (typeof x !== "string" || x.trim().length === 0) issues.push(`result.residual[${i}]: required non-empty string`);
      });
    }
  } else if (RESIDUAL_REQUIRED_OUTCOMES.has(frontmatter.outcome)) {
    issues.push(`result.residual: required when outcome=${frontmatter.outcome} (21 §9.3)`);
  }
}

/**
 * Mechanical frontmatter validation (21 §8 closed set + field invariants +
 * §15.1 type-specific checks). serves ⇔ goal.md resolution and relations
 * target resolution need the fact-source root and happen in the flows.
 */
export function validateWorkcaseFrontmatter(frontmatter) {
  const issues = [];

  for (const key of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(key)) {
      issues.push(`frontmatter: unknown field "${key}" — closed set is ${[...VALID_FM_KEYS].join("/")} (21 §8); unknown fields never enter the canonical object (03 §6.1)`);
    }
  }

  if (frontmatter.fact_type_key !== WORKCASE_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${WORKCASE_TYPE_KEY}", got ${JSON.stringify(frontmatter.fact_type_key)}`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.trim().length === 0) {
    issues.push("title: required non-empty");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} 字 (21 §8), got ${frontmatter.title.length}`);
  }
  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")} (21 §9)`);
  }
  if (typeof frontmatter.summary !== "string" || frontmatter.summary.trim().length === 0) {
    issues.push("summary: required non-empty (21 §8 — 使未读原计划的后续执行者可独立执行)");
  }
  if (typeof frontmatter.scope !== "string" || frontmatter.scope.trim().length === 0) {
    issues.push("scope: required non-empty (21 §8 — 授权范围与边界, 越权拒绝的比对基准)");
  }
  validatePlanShape(frontmatter, issues);

  if (frontmatter.serves !== undefined) {
    if (typeof frontmatter.serves !== "string" || !SG_ANCHOR_PATTERN.test(frontmatter.serves)) {
      issues.push(`serves: must match SG-n (e.g. SG-3), got ${JSON.stringify(frontmatter.serves)}`);
    }
  }

  // ---- Field invariants (21 §8) ----
  const status = frontmatter.status;
  // gate_1 出现 ⇒ status ≠ draft；status=open ⇒ gate_1 必填 (§9.1)
  if (frontmatter.gate_1 !== undefined) {
    if (status === "draft") {
      issues.push("gate_1: must not be present while status=draft (21 §9.1)");
    } else {
      validateGate1(frontmatter, issues);
    }
  } else if (status === "open") {
    issues.push("gate_1: required when status=open (21 §9.1)");
  }
  // attempt 出现 ⇔ status=open (§8)；closed 时 attempt 已收口 (§9.1)
  if (frontmatter.attempt !== undefined) {
    if (status !== "open") {
      issues.push(`attempt: may appear only while status=open (21 §8 出现 ⇔ open), got status=${JSON.stringify(status)}`);
    } else {
      validateAttempt(frontmatter, issues);
    }
  } else if (status === "open") {
    issues.push("attempt: required when status=open (21 §9.1)");
  }
  // reviews（21 §8）：条件字段，draft 期不得出现（复核只在执行期发生）；
  // open/closed 均可携带，重批回退时保留（§9.2 不清空）。
  if (frontmatter.reviews !== undefined) {
    if (status === "draft") {
      issues.push("reviews: must not be present while status=draft — 复核 occurs during execution, not before Gate 1 (21 §8/§9.1)");
    } else {
      validateReviews(frontmatter, issues);
    }
  }
  // result/outcome 出现 ⇔ status=closed (§8)
  if (frontmatter.result !== undefined || frontmatter.outcome !== undefined) {
    if (status !== "closed") {
      issues.push(`result/outcome: may appear only when status=closed (21 §8), got status=${JSON.stringify(status)}`);
    }
  }
  if (status === "closed") {
    if (typeof frontmatter.outcome !== "string" || !OUTCOMES.has(frontmatter.outcome)) {
      issues.push(`outcome: required one of ${[...OUTCOMES].join("/")} when status=closed (21 §8)`);
    }
    if (frontmatter.result === undefined) {
      issues.push("result: required when status=closed (21 §9.1)");
    }
  }
  if (frontmatter.outcome !== undefined && OUTCOMES.has(frontmatter.outcome)) {
    if (frontmatter.result !== undefined) validateResult(frontmatter, issues);
    if (frontmatter.outcome === "completed" && Array.isArray(frontmatter.result?.criteria_checks)) {
      const unmet = frontmatter.result.criteria_checks.filter((c) => isPlainObject(c) && c.satisfied !== true);
      if (unmet.length > 0) {
        issues.push(`outcome=completed requires every criteria_checks entry satisfied, found ${unmet.length} unmet (21 §9.3/§15.1)`);
      }
    }
  }

  // relations: contributed-to → Pitfall only (21 §12)
  if (frontmatter.relations !== undefined) {
    if (!Array.isArray(frontmatter.relations) || frontmatter.relations.length === 0) {
      issues.push("relations: must be a non-empty array of {relation_key: contributed-to, target: {object_uid}} — omit when there is none (03 §6.1)");
    } else {
      const seen = new Set();
      for (const entry of frontmatter.relations) {
        if (!isPlainObject(entry)) { issues.push("relations[]: members must be objects"); continue; }
        if (!ALLOWED_RELATION_KEYS.has(entry.relation_key)) {
          issues.push(`relations[].relation_key: must be "contributed-to" (21 §12 关系闭集), got ${JSON.stringify(entry.relation_key)} — fail closed`);
        }
        const target = entry.target?.object_uid;
        if (typeof target !== "string" || !OBJECT_UID_PATTERN.test(target)) {
          issues.push(`relations[].target.object_uid: must be a canonical UUIDv4 (Pitfall target, 21 §12), got ${JSON.stringify(target)}`);
        } else if (seen.has(target)) {
          issues.push(`relations[]: duplicate target ${target} (03 §7.2 invariant 3)`);
        }
        seen.add(target);
      }
    }
  }

  if (typeof frontmatter.created_at !== "string" || !RFC3339_PATTERN.test(frontmatter.created_at)) {
    issues.push("created_at: required RFC3339 (Code-assigned; AI must not fill it, 21 §7)");
  }
  if (!Array.isArray(frontmatter.change_log) || frontmatter.change_log.length === 0) {
    issues.push("change_log: required array (create writes the first entry)");
  } else {
    frontmatter.change_log.forEach((e, i) => {
      if (!isPlainObject(e) || typeof e.summary !== "string" || e.summary.length === 0) {
        issues.push(`change_log[${i}]: required {at, summary} with non-empty summary`);
      }
    });
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Body validation + carrier coherence (21 §8 正文承载)
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {boolean} opts.hasExecution — status=open, or closed with gate_1
 *   (i.e. execution actually happened). draft never carries 执行.
 * @param {boolean} opts.requireResult — status=closed requires 结果;
 *   open may carry it as a Gate 2 draft (21 §8 条件出现), draft may not.
 */
export function validateWorkcaseBodyStructure(body, title, opts) {
  const issues = [];
  const { hasExecution, requireResult } = opts;
  // 执行/结果 are conditional (21 §8):
  //   - 执行 appears iff execution happened (status=open, or closed with gate_1);
  //   - 结果 is REQUIRED when closed, but MAY appear while open as the Gate 2
  //     draft — the very shape the v5 three-state view reads as `awaiting_gate2`
  //     (deriveWorkCaseV5View). Treating 结果 as expected-only-when-closed made
  //     that state unreachable (Friction bf73fad4).
  const expected = [...BODY_H2_CORE];
  if (hasExecution) expected.push(BODY_H2_EXECUTION);
  expected.push(BODY_H2_RESULT);

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty.trimEnd().replace(/^ {0,3}/, "").replace(/(?<=^#+)[ \t]+/, " ") !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 21 §8)`);
  }
  const h1Count = countAtxHeadings(body, 1);
  if (h1Count !== 1) {
    issues.push(`body: expected exactly 1 H1 heading, found ${h1Count} (21 §8: 正文自 H2 起)`);
  }

  const h2 = h2Titles(body);
  // 执行 requires that execution actually happened (status=open, or closed with
  // gate_1) — a pure draft never carries it.
  if (!hasExecution && h2.includes(BODY_H2_EXECUTION)) {
    issues.push(`body: "## 执行" must not be present before Gate 1 (draft carries no execution, 21 §8)`);
  }
  // 结果 is NOT gated on execution: 21 §9.2 defines a legal `draft → closed
  // (outcome=cancelled)` transition in which `result` records the cancellation
  // reason and the range that never happened — so a draft being closed DOES
  // carry 结果. Both open (Gate 2 draft) and that closed path may therefore
  // present 结果. What remains forbidden is the reverse: a draft that is NOT
  // being closed must not carry it. That is already enforced by requireResult
  // below and by the caller's status pairing; no extra guard is added here.
  if (requireResult && !h2.includes(BODY_H2_RESULT)) {
    issues.push(`body: "## 结果" required when status=closed (21 §8)`);
  }
  // Order check over the sections that ACTUALLY appear: the present set must be
  // a prefix-preserving subsequence of [core..., 执行, 结果]. 结果 may legitimately
  // be absent while open (Gate 2 draft not yet written) — comparing against the
  // full expected list unconditionally is what broke awaiting_gate2.
  const present = expected.filter((t) => h2.includes(t));
  const filtered = h2.filter((t) => expected.includes(t));
  if (filtered.length !== present.length) {
    issues.push(`body: expected H2 sections (${present.join(" / ")}), found ${filtered.join(" / ") || "none"}`);
  } else {
    for (let i = 0; i < present.length; i++) {
      if (filtered[i] !== present[i]) {
        issues.push(`body: H2 #${i + 1} expected "${present[i]}", found "${filtered[i]}"`);
      }
    }
  }
  // Non-empty core sections
  for (const sec of BODY_H2_CORE) {
    const content = sectionContent(body, sec);
    if (content === null || content.length === 0) issues.push(`body: section "${sec}" is missing or empty`);
  }
  if (hasExecution) {
    const content = sectionContent(body, BODY_H2_EXECUTION);
    if (content === null || content.length === 0) issues.push(`body: section "${BODY_H2_EXECUTION}" is missing or empty`);
  }
  if (h2.includes(BODY_H2_RESULT)) {
    const content = sectionContent(body, BODY_H2_RESULT);
    if (content === null || content.length === 0) issues.push(`body: section "${BODY_H2_RESULT}" is present but empty`);
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (03 载体内聚, pitfall/spark precedent): frontmatter
 * summary / scope are the single authoritative texts — their body sections
 * must contain them verbatim. plan[].step must appear in order in the
 * 计划 section so the plan body cannot drift from the authoritative array.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const pairs = [
    ["summary", "摘要"],
    ["scope", "授权范围"],
  ];
  for (const [field, section] of pairs) {
    const text = typeof frontmatter[field] === "string" ? frontmatter[field].trim() : "";
    if (text.length === 0) continue;
    const content = sectionContent(body, section);
    if (content === null) continue;
    if (!content.includes(text)) {
      issues.push(`carrier coherence: frontmatter ${field} must appear verbatim in "## ${section}" (03 §6.1 单一权威)`);
    }
  }
  const planContent = sectionContent(body, "计划");
  if (planContent !== null && Array.isArray(frontmatter.plan)) {
    let cursor = -1;
    frontmatter.plan.forEach((item, i) => {
      if (typeof item?.step !== "string" || item.step.length === 0) return;
      const idx = planContent.indexOf(item.step, cursor + 1);
      if (idx === -1) {
        issues.push(`carrier coherence: plan[${i}].step not found (in order) in "## 计划" — the body plan may not drift from the authoritative array`);
      } else {
        cursor = idx;
      }
    });
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// attempt allocation (21 §10.4: Code-allocated, monotonic)
// ---------------------------------------------------------------------------

/**
 * Derive the next attempt_id from the change_log history the writer itself
 * produced (every allocation/void is recorded as "attempt <n>") plus the
 * current active attempt. Purely mechanical; never reused.
 */
export function nextAttemptId(frontmatter) {
  let max = 0;
  if (Number.isInteger(frontmatter.attempt?.attempt_id)) max = Math.max(max, frontmatter.attempt.attempt_id);
  for (const entry of frontmatter.change_log ?? []) {
    if (typeof entry?.summary !== "string") continue;
    for (const m of entry.summary.matchAll(/attempt (\d+)/g)) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2)
// ---------------------------------------------------------------------------

export async function readWorkcaseObject(args) {
  const { factSourceRoot, objectUid } = args;
  const uidCheck = assertValidUid(objectUid);
  if (uidCheck) return uidCheck;
  let content;
  try {
    content = await readFile(objectFilePath(factSourceRoot, objectUid), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return failure("workcase/object_not_found", `cannot read object file: ${error.message}`);
    }
    return failure("workcase/object_unreadable", `cannot read object file: ${error.message}`);
  }
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("workcase/carrier_invalid", "no YAML frontmatter block");
  }
  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("workcase/carrier_invalid", `frontmatter parse error: ${error.message}`);
  }
  const body = content.slice(fmMatch[0].length).replace(/^\s+/, "");
  const fmCheck = validateWorkcaseFrontmatter(frontmatter);
  return success({
    frontmatter,
    body,
    mechanical_issues: fmCheck.ok ? [] : fmCheck.issues,
    fingerprint: fileFingerprint(content),
    file: objectFilePath(factSourceRoot, objectUid),
  });
}

// ---------------------------------------------------------------------------
// Shared write path: validate + atomic write + read-back
// ---------------------------------------------------------------------------

async function writeValidated(factSourceRoot, frontmatter, body) {
  const fmCheck = validateWorkcaseFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("workcase/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const hasExecution = frontmatter.status === "open" || (frontmatter.status === "closed" && frontmatter.gate_1 !== undefined);
  const requireResult = frontmatter.status === "closed";
  const bodyCheck = validateWorkcaseBodyStructure(body, frontmatter.title, { hasExecution, requireResult });
  if (!bodyCheck.ok) {
    return failure("workcase/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("workcase/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }
  const typeDir = join(factSourceRoot, WORKCASE_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, frontmatter.object_uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);
  // 写后精确回读 (03 §9)
  const readBack = await readWorkcaseObject({ factSourceRoot, objectUid: frontmatter.object_uid });
  if (!readBack.ok) {
    return failure("workcase/read_back_failed", readBack.error.message);
  }
  return success({
    object_uid: frontmatter.object_uid,
    file: filePath,
    fingerprint: readBack.value.fingerprint,
    read_back: "ok",
  });
}

async function resolveServes(factSourceRoot, serves) {
  if (serves === undefined) return null;
  const goal = await readGoalAnchorsFromGoal({ factSourceRoot });
  if (!goal.ok) {
    return failure("workcase/serves_unresolvable", `serves declared (${serves}) but goal.md is not readable: ${goal.error?.message ?? "unknown"} (21 §10.1: Gate 1 无法受理 without an anchor — fail closed)`);
  }
  if (!goal.value.anchors.includes(serves)) {
    return failure("workcase/serves_unresolvable", `serves ${serves} does not match any SG-n in goal.md 子目标 (available: ${goal.value.anchors.join(", ") || "none"})`);
  }
  return null;
}

async function resolveRelationsTargets(factSourceRoot, relations) {
  if (!Array.isArray(relations) || relations.length === 0) return null;
  const missing = [];
  for (const entry of relations) {
    const target = entry?.target?.object_uid;
    if (typeof target !== "string") continue;
    try {
      await readFile(join(factSourceRoot, PITFALL_DIRECTORY, `pitfall-${target}.md`), "utf8");
    } catch {
      missing.push(target);
    }
  }
  if (missing.length > 0) {
    return failure("workcase/relations_unresolvable", `contributed-to target(s) not found as Pitfall objects: ${missing.join(", ")} (21 §12: target must resolve to a same-project Pitfall)`, { missing });
  }
  return null;
}

function stripCallerOnlyFields(draft) {
  const { change_summary: _s, ...rest } = draft ?? {};
  return rest;
}

// ---------------------------------------------------------------------------
// create — draft (21 §14 C1 提案对象模式; 初态 draft)
// ---------------------------------------------------------------------------

export async function createWorkcaseObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (starting with '## 摘要'; the H1 is generated from title)");
  }

  const uid = randomUUID();
  const now = new Date().toISOString();
  const frontmatter = { ...stripCallerOnlyFields(frontmatterDraft) };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = WORKCASE_TYPE_KEY;
  frontmatter.created_at = now;
  // 21 §9: create always initialises as draft — Gate 1 is the only way to open.
  if (frontmatter.status !== undefined && frontmatter.status !== "draft") {
    return failure("workcase/initial_state_violation", `create must initialise as status=draft; got ${JSON.stringify(frontmatter.status)} (21 §9)`);
  }
  frontmatter.status = "draft";
  // Gate/attempt/result/outcome never exist at creation (they attach to the
  // respective transitions, which create never performs).
  if (frontmatter.gate_1 !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry gate_1 (only Gate 1 approval stamps it, 21 §14)");
  if (frontmatter.attempt !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry attempt (only approve allocates it, 21 §10.4)");
  if (frontmatter.result !== undefined || frontmatter.outcome !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry result/outcome (only Gate 2 closure stamps them, 21 §14)");

  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft?.change_summary ?? "受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）",
  }];

  const servesCheck = await resolveServes(factSourceRoot, frontmatter.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, frontmatter.relations);
  if (relCheck) return relCheck;

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  return writeValidated(factSourceRoot, frontmatter, body);
}

// ---------------------------------------------------------------------------
// CAS update primitive (03 §9.5) — shared by every transition flow
// ---------------------------------------------------------------------------

async function loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint) {
  if (typeof expectedFingerprint !== "string" || !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    return failure("invalid_request", "expectedFingerprint is required for CAS (64-hex SHA-256 from your last precise read)");
  }
  const current = await readWorkcaseObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("workcase/cas_conflict", `fingerprint mismatch — the object changed since your last read (expected ${expectedFingerprint.slice(0, 8)}…, found ${current.value.fingerprint.slice(0, 8)}…); re-read and retry (03 §9.5 CAS)`);
  }
  return current;
}

function appendChangeLog(frontmatter, sig, summary) {
  frontmatter.change_log = [
    ...(frontmatter.change_log ?? []),
    { at: new Date().toISOString(), ...sig.signature, summary },
  ];
}

/** C2 guard: while open, plan and scope are frozen (21 §10.3). */
function assertAuthorizedPairFrozen(before, after, issuesRef) {
  const fpBefore = computeAuthorizationFingerprint(before.plan, before.scope);
  const fpAfter = computeAuthorizationFingerprint(after.plan, after.scope);
  if (fpBefore !== fpAfter) {
    issuesRef.push("plan/scope are frozen while status=open — the C2 authorization fingerprint no longer matches; the only legal path is rebatch (open → draft, 局部重批), never an in-place edit (21 §10.3)");
  }
}

// ---------------------------------------------------------------------------
// approve — Gate 1: draft → open (21 §14, §10.1)
// ---------------------------------------------------------------------------

export async function approveWorkcaseObject(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, approver, controller, changeSummary, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof approver !== "string" || approver.length === 0) {
    return failure("invalid_request", "approver is required (the approving Human identity, 21 §10.1)");
  }
  if (typeof controller !== "string" || controller.length === 0) {
    return failure("invalid_request", "controller is required (the current executing controller identity, 21 §10.4)");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (one-line semantic summary for the change_log entry)");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `Gate 1 approval requires status=draft, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }

  const now = new Date().toISOString();
  const next = structuredClone(fm);
  next.status = "open";
  next.gate_1 = {
    approved_at: now,
    approver,
    authorization_fingerprint: computeAuthorizationFingerprint(fm.plan, fm.scope),
    scope_snapshot: fm.scope,
  };
  const attemptId = nextAttemptId(fm);
  next.attempt = { attempt_id: attemptId, started_at: now, controller, heartbeat_at: now };
  appendChangeLog(next, sig, `${changeSummary} [gate_1 approved by ${approver}; attempt ${attemptId} allocated to ${controller}]`);

  // Body: ensure the 执行 section exists (writer-stamped entry line).
  let body = current.value.body;
  if (!h2Titles(body).includes(BODY_H2_EXECUTION)) {
    body = `${body.replace(/\s+$/, "")}\n\n## 执行\n\n- attempt ${attemptId} started at ${now} (controller: ${controller})；Gate 1 授权范围见 gate_1.scope_snapshot。\n`;
  } else {
    const content = sectionContent(body, BODY_H2_EXECUTION) ?? "";
    body = replaceSection(body, BODY_H2_EXECUTION, `${content}\n- attempt ${attemptId} started at ${now} (controller: ${controller})；Gate 1 授权范围见 gate_1.scope_snapshot。`);
  }
  return writeValidated(factSourceRoot, next, body);
}

function replaceSection(body, h2Title, newContent) {
  const re = new RegExp(`(^|\\n)(## ${h2Title}\\n)([\\s\\S]*?)(?=\\n## |\\s*$)`, "m");
  return body.replace(re, `$1$2\n${newContent}\n`);
}

// ---------------------------------------------------------------------------
// execute — open-period update (21 §14 执行期更新)
// ---------------------------------------------------------------------------

/**
 * Open-period controlled update. Allowed payloads: body progress (incl.
 * result drafts in the body), relations, summary refresh; attempt
 * operations: heartbeat (default) | takeover (new controller, new
 * attempt id) | reallocate (void + new id, 冷恢复 path).
 * plan/scope frozen by C2 — substantive change must go through rebatch.
 */
export async function executeWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary,
    attemptOperation = "heartbeat", newController = null,
    sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body starting with '## 摘要')");
  }
  if (!["heartbeat", "takeover", "reallocate"].includes(attemptOperation)) {
    return failure("invalid_request", `attemptOperation must be heartbeat|takeover|reallocate, got ${JSON.stringify(attemptOperation)}`);
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `execute updates require status=open, got ${JSON.stringify(fm.status)} (21 §14)`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  // Code-managed fields: identity, gate, attempt, change_log never come
  // from the caller payload.
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "open";
  next.gate_1 = fm.gate_1;
  next.change_log = fm.change_log;

  // C2 guard (21 §10.3): plan/scope frozen while open.
  const c2Issues = [];
  assertAuthorizedPairFrozen(fm, next, c2Issues);
  if (c2Issues.length > 0) {
    return failure("workcase/c2_fingerprint_invalidated", c2Issues[0]);
  }
  // attempt is Code-managed here.
  const now = new Date().toISOString();
  let attemptNote;
  if (attemptOperation === "heartbeat") {
    next.attempt = { ...fm.attempt, heartbeat_at: now };
    attemptNote = `attempt ${fm.attempt.attempt_id} heartbeat refreshed`;
  } else {
    const controller = typeof newController === "string" && newController.length > 0 ? newController : fm.attempt.controller;
    const newId = nextAttemptId(fm);
    next.attempt = { attempt_id: newId, started_at: now, controller, heartbeat_at: now };
    attemptNote = attemptOperation === "takeover"
      ? `attempt ${fm.attempt.attempt_id} taken over → attempt ${newId} (controller: ${controller})`
      : `attempt ${fm.attempt.attempt_id} voided → attempt ${newId} reallocated (controller: ${controller})`;
  }
  appendChangeLog(next, sig, `${changeSummary} [${attemptNote}]`);

  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body);
}

// ---------------------------------------------------------------------------
// close — Gate 2: open → closed (21 §14, §10.2)
// ---------------------------------------------------------------------------

export async function closeWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    outcome, result, changeSummary, bodyMarkdownAfter, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body including the 结果 section)");
  }
  if (!OUTCOMES.has(outcome)) {
    return failure("invalid_request", `outcome must be one of ${[...OUTCOMES].join("/")} (21 §9.3)`);
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `Gate 2 closure requires status=open, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }

  const next = structuredClone(fm);
  next.status = "closed";
  next.outcome = outcome;
  next.result = stripCallerOnlyFields(result);
  // attempt 收口: the token is retracted; its history stays in change_log.
  const closedAttempt = fm.attempt?.attempt_id;
  delete next.attempt;
  appendChangeLog(next, sig, `${changeSummary} [gate_2 closed with outcome=${outcome}; attempt ${closedAttempt ?? "none"} retracted]`);

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body);
}

// ---------------------------------------------------------------------------
// rebatch — open → draft (C2 局部重批, 21 §9.2/§10.3/§14)
// ---------------------------------------------------------------------------

export async function rebatchWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (must carry 重批原因 + 当时已完成的 criteria_checks 快照结论, 21 §9.2)");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the revised draft body: 摘要/授权范围/计划)");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `rebatch requires status=open (C2 invalidation happens while executing), got ${JSON.stringify(fm.status)} (21 §10.3)`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "draft";
  // §9.2: attempt 作废（不续跑）；result/outcome 一并清空；gate_1 回落（draft
  // 不得携带）——已取得的核对证据写入 change_log 语义摘要（调用方职责）。
  const voidedAttempt = fm.attempt?.attempt_id;
  delete next.attempt;
  delete next.result;
  delete next.outcome;
  delete next.gate_1;
  appendChangeLog(next, sig, `${changeSummary} [C2 局部重批 open→draft; attempt ${voidedAttempt ?? "none"} voided, gate_1 dropped — 重新组织后重走 Gate 1]`);

  const servesCheck = await resolveServes(factSourceRoot, next.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body);
}

// ---------------------------------------------------------------------------
// cancel — draft → closed, outcome=cancelled (21 §9.2)
// ---------------------------------------------------------------------------

export async function cancelWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    result, changeSummary, bodyMarkdownAfter, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body including the 结果 section with the cancellation record)");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `cancel (draft→closed) requires status=draft; an approved workcase must go through Gate 2 instead, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }

  const next = structuredClone(fm);
  next.status = "closed";
  next.outcome = "cancelled";
  next.result = stripCallerOnlyFields(result);
  appendChangeLog(next, sig, `${changeSummary} [cancelled before execution; no Gate 1 approval existed]`);

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body);
}

// ---------------------------------------------------------------------------
// revise — draft → draft controlled revision (03 §9.5, 21 §14)
// ---------------------------------------------------------------------------

export async function reviseWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `revise requires status=draft (pre-Gate-1 evolution); once open, substantive change goes through rebatch, got ${JSON.stringify(fm.status)}`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "draft";
  next.change_log = fm.change_log;
  appendChangeLog(next, sig, changeSummary);

  const servesCheck = await resolveServes(factSourceRoot, next.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body);
}

// ---------------------------------------------------------------------------
// list — F0/F1 discovery (21 §13)
// ---------------------------------------------------------------------------

export async function listWorkcaseObjects(args) {
  const { factSourceRoot, includeClosed = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }
  const typeDir = join(factSourceRoot, WORKCASE_DIRECTORY);
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return success({ items: [], total: 0, complete: true, invalid: [] });
    return failure("workcase/directory_unavailable", `cannot read workcases directory: ${error.message}`);
  }

  const invalid = [];
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const nameMatch = entry.name.match(/^workcase-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i);
    if (!nameMatch) continue;
    const uid = nameMatch[1].toLowerCase();
    let content;
    try {
      content = await readFile(join(typeDir, entry.name), "utf8");
    } catch (error) {
      invalid.push({ file: entry.name, reason: `unreadable: ${error.message}` });
      continue;
    }
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) { invalid.push({ file: entry.name, reason: "no YAML frontmatter block" }); continue; }
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
    // F1 default candidates: draft + open (21 §13: closed 只在精确引用、
    // 证据链反查或历史追溯时展开).
    if (!includeClosed && status === "closed") continue;
    items.push({
      object_uid: uid,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      serves: typeof frontmatter.serves === "string" ? frontmatter.serves : undefined,
      outcome: status === "closed" && typeof frontmatter.outcome === "string" ? frontmatter.outcome : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  return success({ items: complete ? items : items.slice(0, limit), total: items.length, complete, invalid });
}
