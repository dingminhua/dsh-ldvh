// LDVH research mechanical layer — runtime wiring (P0).
//
// This module connects the two research mechanical modules to the governed
// tool surface so the main controller can actually drive them from a live
// session:
//
//   - research-session.js (specs/33 §5–§8+§10): the research session state
//     machine — clarification analysis, three-layer convergence, three-state
//     evidence shaping, citation-loop audit, delivery contract, and the
//     round-driven ResearchSession. Exposed as ONE tool whose `action`
//     selects the state-machine entry (the machine is stateful across
//     calls within one agent turn chain; sessions live in a bounded Map,
//     see SESSIONS below).
//   - research-writer.js (specs/24 §13 + specs/03 §9): the Research object
//     writer — controlled create / precise read / CAS update against the
//     governed project's fact source. Exposed as one tool per 05 effect
//     class: research-read-object (read), research-write-object
//     (may_change_state).
//
// Authorities: specs/05 §6 (operation declaration + common envelope),
// §9.3 (may_change_state), specs/03 §9 (controlled read/create/update,
// write-back read-back), specs/24 §13 (type-specific mechanical checks).
// Effect classification per 05 §6.1: session-state actions never touch the
// fact source (effect: read — they mutate an in-process scratch session
// only); create/update write the fact source (effect: may_change_state).

import {
  analyzeClarificationNeeds,
  auditCitationLoop,
  checkDeliveryContract,
  ResearchSession,
} from "./research-session.js";
import { objectRef, objectRefOf } from "./object-reference.js";
import {
  createResearchObject,
  listResearchObjects,
  readResearchObject,
  updateResearchObject,
} from "./research-writer.js";
import { currentRouteValues } from "./session-signature.js";
import { FRONTMATTER_AFTER_DESCRIPTION, FRONTMATTER_REMOVALS_DESCRIPTION } from "./after-integrity.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "research-session-machine": {
    toolName: "ldvh_research_session",
    summary: "Drive the specs/33 research session state machine: clarify the question, submit evidence rounds (three-state + citation loop), audit convergence, and finalize the evidence bundle (specs/33 §7–§10, §13)",
    effect: "read"
  },
  "research-read-object": {
    toolName: "ldvh_research_read",
    summary: "Precise read of one Research fact object by object_uid: frontmatter, body, sub-stage and file fingerprint (specs/03 §9.2, specs/24 §13)",
    effect: "read"
  },
  "research-list-objects": {
    toolName: "ldvh_research_list",
    summary: "Enumerate Research fact objects (F0/F1 discovery): dedup-relevant projection (title/research_question/research_purpose/stopping_reason) for the governed project; active-only by default (specs/03 §8, specs/24 §12)",
    effect: "read"
  },
  "research-write-object": {
    toolName: "ldvh_research_write",
    writeShaped: true,
    summary: "Controlled write of Research fact objects: create (exploratory or directed) and CAS update with change_log, against the governed project's fact source (specs/03 §9.4–§9.5, specs/24 §13)",
    effect: "may_change_state"
  }
};

const FACT_SOURCE_ROOT_DIR = "ldvh-base";

// ---------------------------------------------------------------------------
// Bounded scratch sessions (research-session.js ResearchSession instances).
// A session accumulates rounds in memory only; it never touches the fact
// source. Bounded FIFO eviction keeps the map from growing without limit in
// a very long-lived agent process.
//
// Eviction is NOT silent: 33 §12.2 says an in-progress research stays out of the
// fact source, which was read as "memory is enough" — but a caller that comes
// back to an evicted id then gets "does not resolve", indistinguishable from its
// own typo, and the honest reading ("your rounds are gone, restart") never
// reaches it. `evictedIds` is a bounded ring of recently dropped ids so the
// failure can name its real cause instead of blaming the caller's input.
// Process restart is a different failure and is reported separately.
// ---------------------------------------------------------------------------

const MAX_SESSIONS = 32;
const MAX_EVICTED_REMEMBERED = 128;
const sessions = new Map();
const evictedIds = [];

function createSession(question, purpose, options) {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
    evictedIds.push(oldest);
    if (evictedIds.length > MAX_EVICTED_REMEMBERED) evictedIds.shift();
  }
  const id = `rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session = new ResearchSession({
    question,
    purpose,
    subQuestions: options?.sub_questions ?? [],
    maxRounds: options?.max_rounds ?? 4,
    clarificationLog: options?.clarification_log ?? [],
  });
  sessions.set(id, session);
  return { id, session };
}

function getSession(id) {
  return sessions.get(id) ?? null;
}

/**
 * Explain why a session id did not resolve.
 *
 * Three distinct causes, three distinct messages — the caller acts differently
 * in each case (restart the research / re-read the id / nothing to do).
 */
function sessionLossReason(id) {
  if (typeof id !== "string" || id.length === 0) return "session_id is required";
  if (evictedIds.includes(id)) {
    return `session ${id} was evicted: at most ${MAX_SESSIONS} live sessions are kept and this one aged out; its accumulated rounds are gone — recreate with action=create (33 §12.2 keeps in-progress research out of the fact source, so nothing was persisted)`;
  }
  return `session ${id} does not resolve to a live research session in this process — sessions are in-memory only and do not survive a restart; if this session predates a host restart, recreate with action=create`;
}

// ---------------------------------------------------------------------------
// Envelope helpers (05 §8 common response semantics)
// ---------------------------------------------------------------------------

function envelope(operationKey, outcome, fields) {
  return { operation_key: operationKey, outcome, ...fields };
}

function invalidRequest(operationKey, gap, requested) {
  return envelope(operationKey, "invalid_request", {
    result: null,
    scope: { requested: requested ?? null, completed: [], not_completed: [requested ?? operationKey] },
    sources: [],
    gaps: [gap],
    verification: { checks: [], passed: false },
    follow_up: []
  });
}

function rejected(operationKey, gaps, sources) {
  return envelope(operationKey, "rejected", {
    result: null,
    scope: { requested: operationKey, completed: [], not_completed: [operationKey] },
    sources: sources ?? [],
    gaps,
    verification: { checks: [], passed: false },
    follow_up: []
  });
}

async function governedProject(dshHomePath, exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  const scope = await resolveGovernanceScope(dshHomePath, cwd);
  if (scope.state !== "governed") {
    return { ok: false, scope };
  }
  return { ok: true, scope, project: scope.project };
}

/** The change_log signature fields, from the authoritative session record. */
async function signatureFor(deps, exec) {
  const route = await currentRouteValues(deps.sessionPersistence?.(), exec?.agent);
  if (!route.ok) return { ok: false, reason: route.reason };
  // Return the BRANDED carrier, not a plain object: the writers only accept
  // the branded form, and returning a plain object here is what let the
  // update paths silently drop the signature (found 2026-09-12). Branding
  // at the source makes it impossible for a caller to pass the wrong one.
  return { ok: true, value: authoritativeSignature({ provider: route.value.provider, model: route.value.model }) };
}

// ---------------------------------------------------------------------------
// research-session-machine handlers (specs/33 mechanical slice)
// ---------------------------------------------------------------------------

function executeSessionAction(args, exec) {
  const action = args?.action;
  switch (action) {
    case "clarify":
      return executeClarify(args);
    case "create":
      return executeSessionCreate(args);
    case "submit-round":
      return executeSubmitRound(args);
    case "audit-citation":
      return executeAuditCitation(args);
    case "check-delivery":
      return executeCheckDelivery(args);
    case "finalize":
      return executeFinalize(args);
    case "state":
      return executeSessionState(args);
    default:
      return Promise.resolve(invalidRequest(
        "research-session-machine",
        `action must be one of clarify|create|submit-round|audit-citation|check-delivery|finalize|state; got ${JSON.stringify(action)}`,
        action ?? null
      ));
  }
}

function executeClarify(args) {
  const question = args?.question;
  const purpose = args?.purpose ?? null;
  if (typeof question !== "string" || question.length === 0) {
    return Promise.resolve(invalidRequest("research-session-machine", "question is required for action=clarify", "clarify"));
  }
  const analysis = analyzeClarificationNeeds(question, purpose);
  return Promise.resolve(envelope("research-session-machine", "completed", {
    result: analysis.value,
    scope: { requested: "clarify", completed: ["clarify"], not_completed: [] },
    sources: [{ kind: "spec", path: "specs/33-调研吸收系统规范.md", section: "7. 调研入口澄清" }],
    gaps: [],
    verification: { checks: ["ambiguity-heuristics"], passed: true },
    follow_up: analysis.value.needsClarification
      ? ["surface the ≤3 clarification questions to Human (or record the degradation per 33 §7.4)", "action=create to start the session"]
      : ["action=create to start the session"]
  }));
}

function executeSessionCreate(args) {
  const question = args?.question;
  const purpose = args?.purpose;
  if (typeof question !== "string" || question.length === 0) {
    return Promise.resolve(invalidRequest("research-session-machine", "question is required for action=create", "create"));
  }
  if (typeof purpose !== "string" || purpose.length === 0) {
    return Promise.resolve(invalidRequest("research-session-machine", "purpose is required for action=create (the project judgement this research supports)", "create"));
  }
  // 33 §7.3: the clarification Q&A must be recorded verbatim so it can be
  // carried into the Research object. Before this the schema had no parameter
  // for it, so the obligation was unfulfillable through the tool surface.
  const clarificationLog = Array.isArray(args?.clarification_log) ? args.clarification_log : [];
  for (const [index, entry] of clarificationLog.entries()) {
    if (entry === null || typeof entry !== "object") {
      return Promise.resolve(invalidRequest("research-session-machine", `clarification_log[${index}] must be an object { question, answer, answered_by }`, "create"));
    }
    if (typeof entry.question !== "string" || entry.question.length === 0
      || typeof entry.answer !== "string" || entry.answer.length === 0
      || !["human", "external", "ai"].includes(entry.answered_by)) {
      return Promise.resolve(invalidRequest("research-session-machine", `clarification_log[${index}] requires non-empty question/answer and answered_by ∈ {human, external, ai} (24 §8 clarification_log 成员契约)`, "create"));
    }
  }

  // 33 §8.3: "轮次上限须与调研范围成正比，小范围调研不超过两轮，大范围调研不超过四轮."
  // The cap is the caller's judgement of scope, but a value outside [1,4] is not
  // a scope judgement — it silently disables the round-cap layer. Refuse instead
  // of clamping: clamping would let a caller believe it set 12 rounds.
  const requestedMaxRounds = args?.max_rounds;
  if (requestedMaxRounds !== undefined
    && (typeof requestedMaxRounds !== "number" || !Number.isInteger(requestedMaxRounds) || requestedMaxRounds < 1 || requestedMaxRounds > 4)) {
    return Promise.resolve(invalidRequest("research-session-machine", `max_rounds must be an integer in 1..4 (33 §8.3: small-scope ≤2, large-scope ≤4); got ${JSON.stringify(requestedMaxRounds)}`, "create"));
  }

  const { id, session } = createSession(question, purpose, {
    sub_questions: Array.isArray(args?.sub_questions) ? args.sub_questions : [],
    max_rounds: typeof requestedMaxRounds === "number" ? requestedMaxRounds : 4,
    clarification_log: clarificationLog,
  });
  return Promise.resolve(envelope("research-session-machine", "completed", {
    result: {
      session_id: id,
      max_rounds: session.maxRounds,
      sub_questions: session.subQuestions.length,
      clarification_log_entries: clarificationLog.length,
    },
    scope: { requested: "create", completed: ["create"], not_completed: [] },
    sources: [{ kind: "spec", path: "specs/33-调研吸收系统规范.md", section: "8. 三层收敛判定" }],
    gaps: [],
    verification: { checks: ["session-created"], passed: true },
    follow_up: ["action=submit-round with findings (each: statement, state, evidence/issue/gap)"]
  }));
}

function executeSubmitRound(args) {
  const id = args?.session_id;
  const session = typeof id === "string" ? getSession(id) : null;
  if (session === null) {
    return Promise.resolve(rejected("research-session-machine", [sessionLossReason(id)]));
  }
  const findings = args?.findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    return Promise.resolve(invalidRequest("research-session-machine", "findings (non-empty array) is required for action=submit-round", "submit-round"));
  }
  const round = session.submitRound(findings);
  const result = {
    round_number: session.roundNumber,
    stop: round.stop,
    reason: round.reason,
    accepted: round.accepted.length,
    rejected: round.rejected.map((r) => ({ statement: r.finding?.statement ?? null, code: r.error?.code, message: r.error?.message })),
    consecutive_no_gain_rounds: session.consecutiveNoGain,
    max_rounds: session.maxRounds,
  };
  return Promise.resolve(envelope("research-session-machine", round.rejected.length > 0 && round.accepted.length === 0 ? "rejected" : "completed", {
    result,
    scope: {
      requested: "submit-round",
      completed: round.accepted.length > 0 ? [`round ${session.roundNumber}: ${round.accepted.length} finding(s) accepted`] : [],
      not_completed: round.rejected.length > 0 ? [`${round.rejected.length} finding(s) rejected (reshape and resubmit)`] : []
    },
    sources: [{ kind: "spec", path: "specs/33-调研吸收系统规范.md", section: "9. 三态证据结构" }],
    gaps: round.rejected.length > 0 ? round.rejected.map((r) => `${r.error?.code}: ${r.error?.message}`) : [],
    verification: { checks: ["evidence-shaping", "convergence-evaluation"], passed: round.rejected.length === 0 },
    follow_up: round.stop
      ? ["action=finalize to produce the evidence bundle (after check-delivery on the report body)"]
      : ["action=submit-round for the next round, or action=state to inspect progress"]
  }));
}

function executeAuditCitation(args) {
  const body = args?.body;
  const confirmed = args?.confirmed;
  if (typeof body !== "string" || body.length === 0) {
    return Promise.resolve(invalidRequest("research-session-machine", "body (report markdown) is required for action=audit-citation", "audit-citation"));
  }
  if (!Array.isArray(confirmed)) {
    return Promise.resolve(invalidRequest("research-session-machine", "confirmed (evidence array from finalize) is required for action=audit-citation", "audit-citation"));
  }
  const audit = auditCitationLoop(body, confirmed);
  // scope/verification 必须点名**实际**检查过什么。旧值把整个审计写成
  // `["citation-loop-audit"]` 一个名字，调用方无法从结果看出这道门覆盖了
  // §10.3 的四项判据，还是只查了编号存在性。
  const CITATION_CHECKS = [
    "[n] 编号有对应证据条目（§10.3 第1项）",
    "每处引文逐字一致，同行不止查首个（§10.3 第2项）",
    "引用位置紧邻其引文，编号与引文归属一致（§10.3 第3项）",
    "引文不超出所引条目长度（§10.3 第4项）",
    "溯源 ref 可回指证据来源（§10.2）",
  ];
  return Promise.resolve(envelope("research-session-machine", audit.ok ? "completed" : "rejected", {
    result: { ok: audit.ok, issues: audit.issues },
    scope: { requested: "audit-citation", completed: audit.ok ? CITATION_CHECKS : [], not_completed: audit.ok ? [] : CITATION_CHECKS },
    sources: [{ kind: "spec", path: "specs/33-调研吸收系统规范.md", section: "10. 引用闭环" }],
    gaps: audit.issues,
    verification: { checks: CITATION_CHECKS, passed: audit.ok },
    follow_up: audit.ok ? [] : ["fix the cited issues; the report must not be delivered while the audit fails (33 §10.3)"]
  }));
}

function executeCheckDelivery(args) {
  const body = args?.body;
  if (typeof body !== "string" || body.length === 0) {
    return Promise.resolve(invalidRequest("research-session-machine", "body (report markdown) is required for action=check-delivery", "check-delivery"));
  }
  const check = checkDeliveryContract(body);
  // 同上：交付合同有 §13.1 与 §13.2 两组判据，只报 `["placeholder-scan"]`
  // 会让「已挂证据」与「UNVERIFIED 标注合规」两项的结论无处可读。
  const DELIVERY_CHECKS = [
    "无占位符残留（§13.1）",
    "每个发现单元挂 confirmed 证据，挂不上须标注 UNVERIFIED（§13.2 前半句）",
    "UNVERIFIED 标注须带优先级与缺口编号（§13.2 后半句）",
  ];
  return Promise.resolve(envelope("research-session-machine", check.ok ? "completed" : "rejected", {
    result: { ok: check.ok, issues: check.issues },
    scope: { requested: "check-delivery", completed: check.ok ? DELIVERY_CHECKS : [], not_completed: check.ok ? [] : DELIVERY_CHECKS },
    sources: [{ kind: "spec", path: "specs/33-调研吸收系统规范.md", section: "13. 交付合同" }],
    gaps: check.issues,
    verification: { checks: DELIVERY_CHECKS, passed: check.ok },
    follow_up: check.ok ? [] : ["fill the placeholders and re-run; fail loud, no half-finished report (33 §13.3)"]
  }));
}

function executeFinalize(args) {
  const id = args?.session_id;
  const session = typeof id === "string" ? getSession(id) : null;
  if (session === null) {
    return Promise.resolve(rejected("research-session-machine", [sessionLossReason(id)]));
  }
  const bundle = session.finalize();
  if (!bundle.ok) {
    return Promise.resolve(rejected("research-session-machine", [`${bundle.error.code}: ${bundle.error.message}`]));
  }
  return Promise.resolve(envelope("research-session-machine", "completed", {
    result: { session_id: id, ...bundle.value },
    scope: { requested: "finalize", completed: ["evidence bundle"], not_completed: [] },
    sources: [{ kind: "spec", path: "specs/33-调研吸收系统规范.md", section: "8. 三层收敛判定" }],
    gaps: [],
    verification: { checks: ["three-state-invariants", "stopping-consistency", "citation-loop"], passed: true },
    follow_up: ["research-write-object action=create to persist the Research object (specs/24 §13)"]
  }));
}

function executeSessionState(args) {
  const id = args?.session_id;
  const session = typeof id === "string" ? getSession(id) : null;
  if (session === null) {
    return Promise.resolve(rejected("research-session-machine", [sessionLossReason(id)]));
  }
  return Promise.resolve(envelope("research-session-machine", "completed", {
    result: {
      session_id: id,
      question: session.question,
      round_number: session.roundNumber,
      max_rounds: session.maxRounds,
      consecutive_no_gain_rounds: session.consecutiveNoGain,
      stopping_reason: session.stoppingReason,
      counts: { confirmed: session.confirmed.length, uncertain: session.uncertain.length, gaps: session.gaps.length, urls: session.urls.size }
    },
    scope: { requested: "state", completed: ["state"], not_completed: [] },
    sources: [],
    gaps: [],
    verification: { checks: [], passed: true },
    follow_up: []
  }));
}

// ---------------------------------------------------------------------------
// research-read-object / research-list-objects / research-write-object
// (specs/03 §8–§9 + specs/24 §12–§13)
// ---------------------------------------------------------------------------

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("research-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object discovery serves governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const includeRetired = args?.status === "all";
  const limit = typeof args?.limit === "number" && Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 200;
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listResearchObjects({ factSourceRoot, includeRetired, limit });
  if (!listed.ok) {
    return envelope("research-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "researches") }],
      gaps: [`${listed.error.code}: ${listed.error.message}`],
      verification: { checks: ["directory-scan"], passed: false },
      follow_up: []
    });
  }
  const value = listed.value;
  const gaps = value.invalid.map((entry) => `invalid carrier ${entry.file}: ${entry.reason}`);
  if (!value.complete) {
    // 03 §8.1: never let a truncated page pass for the full set.
    gaps.push(`projection truncated at limit=${limit} of ${value.total} matching objects — narrow the filter or raise the limit; do not treat this page as the full set (03 §8.1)`);
  }
  return envelope("research-list-objects", value.complete ? "completed" : "partial", {
    result: {
      count: value.items.length,
      total: value.complete ? value.items.length : value.total,
      filter: includeRetired ? "all" : "active",
      items: value.items,
    },
    scope: {
      requested: "list",
      completed: value.complete ? ["list"] : [`first ${value.items.length} of ${value.total}`],
      not_completed: value.complete ? [] : [`${value.total - value.items.length} objects beyond the limit`],
    },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "researches") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse", "f1-projection"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (24 §6) is a semantic comparison over research_question — performed by the AI on this projection, never by the tool",
      "research-read-object for the F3 full content of any candidate",
    ]
  });
}

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("research-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "research-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("research-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readResearchObject({ factSourceRoot, objectUid });
  if (!read.ok) {
    // Distinguish "not found / bad uid shape" (rejected) from carrier-level
    // defects (unavailable — the object exists but cannot be consumed).
    const rejectedCodes = new Set(["research/invalid_uid", "research/object_not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("research-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "researches") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  return envelope("research-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof value.frontmatter.title === "string" ? value.frontmatter.title : undefined,
      research_question: typeof value.frontmatter.research_question === "string" ? value.frontmatter.research_question : undefined,
      status: value.frontmatter.status,
      sub_stage: value.exploratory ? "exploratory" : "directed",
      body_valid: value.body_valid,
      body_issues: value.body_issues,
      frontmatter: value.frontmatter,
      body: value.body,
    },
    scope: { requested: objectUid, completed: [objectUid], not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see body_issues)"] },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: value.body_valid ? [] : value.body_issues,
    verification: { checks: ["frontmatter-parse", "body-structure"], passed: value.body_valid },
    follow_up: ["research-write-object action=update with the observed fingerprint when a controlled change is needed"]
  });
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update") {
    return invalidRequest("research-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("research-write-object", "unavailable", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: controlled writes serve governed projects only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const sig = await signatureFor(deps, exec);
  // Human requirement 2026-09-12: "changelog 和提交都要机械署名，不能署名的
  // 要报告 human". The commit half is already enforced by the Git Gate
  // trailer rules; this is the object half. When the authoritative
  // signature cannot be obtained the write is REFUSED and reported here,
  // rather than recorded as an unsigned stable fact (03 §6.1 says Code
  // fills the signature; 09 requires a definite unavailable outcome for
  // blank/historical sessions and model switches).
  if (!sig.ok) {
    return envelope("research-write-object", "unavailable", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`signature_unavailable: the authoritative provider/model could not be read from the DSH session record (${sig.reason}). `
        + "REFUSE to write an unsigned change_log entry; REPORT TO HUMAN — this write cannot be signed and must not be recorded as a stable fact."],
      verification: { checks: ["governance-scope", "signature-source"], passed: false },
      follow_up: ["human must resolve the session signature source, then retry"]
    });
  }

  if (action === "create") {
    const draft = args?.frontmatter_draft;
    const analysisBody = args?.analysis_body;
    const surveyBody = args?.survey_body ?? null;
    if (typeof draft !== "object" || draft === null || typeof analysisBody !== "string" || analysisBody.length === 0) {
      return invalidRequest("research-write-object", "frontmatter_draft (object) and analysis_body (markdown) are required for action=create", "create");
    }
    if (surveyBody !== null && (typeof surveyBody !== "string" || surveyBody.length === 0)) {
      return invalidRequest("research-write-object", "survey_body must be a non-empty string (exploratory) or omitted (directed)", "create");
    }
    const created = await createResearchObject({
      factSourceRoot,
      frontmatterDraft: draft,
      analysisBody,
      surveyBody,
      sessionSignature: sig.ok ? sig.value : null,
    });
    if (!created.ok) {
      return writeRejected("research-write-object", created, factSourceRoot);
    }
    // 03 §9.4 item 5: precise read-back of the current file after create.
    const readBack = await readResearchObject({ factSourceRoot, objectUid: created.value.object_uid });
    if (!readBack.ok || readBack.value.fingerprint !== created.value.fingerprint) {
      return envelope("research-write-object", "partial", {
        result: { object_uid: created.value.object_uid, file: created.value.file, fingerprint: created.value.fingerprint, read_back: "failed" },
        scope: { requested: "create", completed: ["create"], not_completed: ["read-back"] },
        sources: [{ kind: "fact-object", path: created.value.file }],
        gaps: [`created but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
        verification: { checks: ["create"], passed: false },
        follow_up: ["STOP further writes and success claims (03 §9.4 item 7); re-read and verify the file state before anything else"]
      });
    }
    return envelope("research-write-object", "completed", {
      result: {
        action: "create",
        object_uid: created.value.object_uid,
        actual_ref: created.value.file,
        fingerprint: created.value.fingerprint,
        read_back: { ok: true, fingerprint: readBack.value.fingerprint, body_valid: readBack.value.body_valid },
        changes: [{ object_uid: created.value.object_uid, change: "created", carrier: created.value.file }]
      },
      scope: { requested: "create", completed: ["create", "read-back"], not_completed: [] },
      sources: [{ kind: "fact-object", path: created.value.file, content_fingerprint: created.value.fingerprint }],
      gaps: sig.ok ? [] : [`change_log entry carries no provider/model: ${sig.reason}`],
      verification: { checks: ["frontmatter-closed-set", "body-structure", "index-body-coherence", "relations-contract", "atomic-write", "read-back"], passed: true },
      follow_up: ["the object is created and read back; committing it to Git goes through the controlled-commit contract (specs/06)"]
    });
  }

  // action === "update"
  const objectUid = args?.object_uid;
  const expectedFingerprint = args?.expected_fingerprint;
  const frontmatterAfter = args?.frontmatter_after;
  // 显式删除声明（specs/02 §10.5 三向声明）：省略即保留，删除须显式声明。
  const frontmatterRemovals = Array.isArray(args?.frontmatter_removals) ? args.frontmatter_removals : null;
  const analysisBodyAfter = args?.analysis_body_after;
  const surveyBodyAfter = args?.survey_body_after ?? null;
  const changeSummary = args?.change_summary;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("research-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("research-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof analysisBodyAfter !== "string" || analysisBodyAfter.length === 0) {
    return invalidRequest("research-write-object", "frontmatter_after (object) and analysis_body_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("research-write-object", "change_summary (one short semantic summary for the change_log) is required for action=update", "update");
  }
  const updated = await updateResearchObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    frontmatterRemovals,
    analysisBodyAfter,
    surveyBodyAfter,
    changeSummary,
    // Update path MUST brand the carrier exactly like the create path: a plain
    // {provider,model} object is rejected by resolveAuthoritativeSignature(), so
    // passing sig.value here silently wrote an unsigned change_log entry while
    // the envelope still reported sig.ok === true (no gap). Found 2026-09-12.
    sessionSignature: sig.ok ? sig.value : null,
  });
  if (!updated.ok) {
    return writeRejected("research-write-object", updated, factSourceRoot);
  }
  const readBack = await readResearchObject({ factSourceRoot, objectUid });
  if (!readBack.ok || readBack.value.fingerprint !== updated.value.fingerprint) {
    return envelope("research-write-object", "partial", {
      result: { object_uid: objectUid, fingerprint: updated.value.fingerprint, read_back: "failed" },
      scope: { requested: "update", completed: ["update"], not_completed: ["read-back"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "researches") }],
      gaps: [`updated but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
      verification: { checks: ["update"], passed: false },
      follow_up: ["STOP further writes and success claims (03 §9.7); re-read the object before anything else"]
    });
  }
  return envelope("research-write-object", "completed", {
    result: {
      action: "update",
      object_uid: objectUid,
      fingerprint: updated.value.fingerprint,
      read_back: { ok: true, fingerprint: readBack.value.fingerprint, body_valid: readBack.value.body_valid },
      changes: [{ object_uid: objectUid, change: "updated", summary: changeSummary }]
    },
    scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: readBack.value.file, content_fingerprint: updated.value.fingerprint }],
    gaps: sig.ok ? [] : [`change_log entry carries no provider/model: ${sig.reason}`],
    verification: { checks: ["cas-baseline", "frontmatter-closed-set", "body-structure", "index-body-coherence", "relations-contract", "sub-stage-immutability", "atomic-write", "read-back"], passed: true },
    follow_up: ["use the NEW fingerprint from this result for the next update; committing goes through the controlled-commit contract (specs/06)"]
  });
}

function writeRejected(operationKey, failureResult, factSourceRoot) {
  const code = failureResult.error.code;
  // Mechanical rejections (source-defined conditions refusing the write) vs
  // availability failures (carrier/IO-level problems). Both are zero-write.
  const mechanicalCodes = new Set([
    "research/frontmatter_invalid", "research/body_invalid", "research/coherence_invalid",
    "research/relations_invalid", "research/relation_target_unresolvable", "research/substage_mismatch",
    "research/substage_immutable", "research/cas_conflict", "research/change_summary_required",
    "research/invalid_uid", "invalid_request",
  ]);
  const outcome = mechanicalCodes.has(code) ? "rejected" : "unavailable";
  const issues = Array.isArray(failureResult.error.details?.issues) ? failureResult.error.details.issues : [];
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: "write", completed: [], not_completed: ["write"] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "researches") }],
    gaps: [`${code}: ${failureResult.error.message}`, ...issues],
    verification: { checks: [], passed: false },
    follow_up: code === "research/cas_conflict"
      ? ["re-read the object (research-read-object), reconcile the concurrent change, and retry with the fresh fingerprint"]
      : ["fix the reported mechanical issues and retry; zero write has occurred"]
  });
}

// ---------------------------------------------------------------------------
// Registration (same shape as subagent-result.js — mounted from
// registerLdvhTools, so tools land only in governed sessions)
// ---------------------------------------------------------------------------

function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  const result = env.result;
  if (result?.session_id !== undefined) lines.push(`session: ${result.session_id}`);
  if (result?.object_uid !== undefined) lines.push(`object: ${objectRef({ object_uid: result.object_uid, fact_type_key: result.fact_type_key ?? "research" })}`);
  if (result?.title !== undefined) lines.push(`title: ${result.title}`);
  if (result?.status !== undefined) lines.push(`status: ${result.status}`);
  if (result?.sub_stage !== undefined) lines.push(`sub_stage: ${result.sub_stage}`);
  if (result?.research_question !== undefined) lines.push(`question: ${result.research_question}`);
  // Full fingerprint, never truncated (03 §9.5): the render output is the
  // model's only window on the tool result — a truncated fingerprint makes
  // the CAS baseline unobtainable and blocks every controlled update.
  if (result?.fingerprint !== undefined) lines.push(`fingerprint: ${result.fingerprint}`);
  if (result?.body_valid !== undefined) lines.push(`body_valid: ${result.body_valid}`);
  if (result?.read_back?.ok !== undefined) lines.push(`read_back: ${result.read_back.ok ? "ok" : "FAILED"}`);
  if (result?.file !== undefined) lines.push(`file: ${result.file}`);
  if (result?.stop !== undefined) lines.push(`converged: ${result.stop}${result.reason ? ` (${result.reason})` : ""}`);
  if (result?.round_number !== undefined) lines.push(`round: ${result.round_number}/${result.max_rounds ?? "?"}`);
  // F1 discovery projection (24 §12 / 03 §8): the render output is the model's
  // ONLY window on the tool result (03 §9.5), so a list that carries `count`
  // and `items` in its envelope but prints neither leaves the model with a bare
  // outcome line and no candidates at all. That was the real state of
  // ldvh_research_list: the data was in `result`, the tests asserted on
  // `result.items`, and every test passed while the tool was unusable through
  // the model surface. Mirrors the spark render (20 §12).
  if (result?.count !== undefined) lines.push(`count: ${result.count}${result.total !== undefined && result.total !== result.count ? ` (of ${result.total})` : ""}`);
  if (Array.isArray(result?.items)) {
    for (const item of result.items) {
      // Research has no `priority`/`refs` (unlike Spark); the projection contract
      // for this type is title + status + stopping_reason + created_at, so those
      // are what render. stopping_reason is the field a reader actually triages
      // on (sufficient vs round-cap vs no-gain says whether the report closed).
      const uid = objectRef({ object_uid: item.object_uid, fact_type_key: item.fact_type_key ?? "research" });
      const stop = item.stopping_reason ? ` [${item.stopping_reason}]` : "";
      const when = typeof item.created_at === "string" ? ` (${item.created_at.slice(0, 10)})` : "";
      lines.push(`- ${uid} [${item.status}]${stop} ${item.title}${when}`);
    }
  }
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${objectRefOf(change.object_uid, change.fact_type_key ?? "research")}`);
  if (typeof env.changes !== "undefined" && Array.isArray(env.changes)) { /* result.changes already covered */ }
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  // Models mis-shape open objects ({"item": ...} instead of arrays) when they
  // see additionalProperties:true with no declared properties — the schema is
  // the model's instruction sheet, so every Research data object/array
  // declares its shape explicitly (mirrors 24 §8 field contract).
  const urlEntry = {
    type: "object",
    properties: {
      ref: { type: "string", description: "absolute HTTP(S) URL" },
      title: { type: "string", description: "source title" },
      summary: { type: "string", description: "what this source supports/limits" }
    },
    required: ["ref"],
    additionalProperties: false
  };
  const implicationEntry = {
    type: "object",
    properties: {
      finding_ref: { type: "string", description: "must match a confirmed_statements member verbatim" },
      implication: { type: "string", description: "one-sentence project implication" }
    },
    required: ["finding_ref", "implication"],
    additionalProperties: false
  };
  const gapEntry = {
    type: "object",
    properties: {
      description: { type: "string" },
      priority: { type: "string", enum: ["high", "medium", "low"] },
      blocked_scope: { type: "string" }
    },
    required: ["description", "priority"],
    additionalProperties: false
  };
  const uncertainEntry = {
    type: "object",
    properties: {
      issue: { type: "string" },
      reason: { type: "string" }
    },
    required: ["issue", "reason"],
    additionalProperties: false
  };
  const relationEntry = {
    type: "object",
    properties: {
      relation_key: { type: "string", enum: ["inspired-by", "informs", "updates"] },
      target: { type: "object", properties: { object_uid: { type: "string" } }, required: ["object_uid"], additionalProperties: false }
    },
    required: ["relation_key", "target"],
    additionalProperties: false
  };
  // The Research frontmatter draft (24 §8 type fields; Code assigns identity).
  const researchFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log",
    properties: {
      title: { type: "string" },
      status: { type: "string", enum: ["active", "retired"], description: "create must be active; update may transition to retired (24 §9)" },
      research_question: { type: "string" },
      research_purpose: { type: "string" },
      stopping_reason: { type: "string", enum: ["sufficient", "no-gain", "round-cap"] },
      urls: { type: "array", items: urlEntry, description: "external sources (at least one)" },
      confirmed_statements: { type: "array", items: { type: "string" }, description: "finding-unit declaration index (verbatim H3 titles of the 关键发现 section)" },
      uncertain: { type: "array", items: uncertainEntry },
      gaps: { type: "array", items: gapEntry },
      implications: { type: "array", items: implicationEntry },
      clarification_log: {
        type: "array",
        items: {
          type: "object",
          properties: { question: { type: "string" }, answer: { type: "string" }, answered_by: { type: "string", enum: ["human", "external", "ai"] } },
          required: ["question", "answer", "answered_by"],
          additionalProperties: false
        }
      },
      relations: { type: "array", items: relationEntry },
      retirement_reason: {
        type: "string",
        enum: ["outdated", "superseded", "out-of-scope", "rejected"],
        description: "create MUST NOT supply this; update may set when transitioning active → retired (24 §9)"
      },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "research_question", "research_purpose", "stopping_reason", "urls"],
    additionalProperties: false
  };
  const findingSchema = {
    type: "object",
    properties: {
      statement: { type: "string", description: "The factual claim (required)" },
      state: { type: "string", enum: ["confirmed", "uncertain", "gap"] },
      evidence: {
        type: "object",
        description: "confirmed only: { text (verbatim quote), source (HTTP(S) URL), anchor (relocatable locator), confidence (high/medium/low) }",
        properties: {
          text: { type: "string" },
          source: { type: "string" },
          anchor: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] }
        },
        additionalProperties: false
      },
      issue: { type: "object", description: "uncertain only: { issue, reason }", properties: { issue: { type: "string" }, reason: { type: "string" } }, required: ["issue", "reason"], additionalProperties: false },
      gap: { type: "object", description: "gap only: { description, priority (high/medium/low) }", properties: { description: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] } }, required: ["description", "priority"], additionalProperties: false },
      sub_question_key: { type: "string", description: "Optional: tag this finding to a sub-question for coverage checks" }
    },
    required: ["statement", "state"],
    additionalProperties: false
  };
  switch (operationKey) {
    case "research-session-machine":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["clarify", "create", "submit-round", "audit-citation", "check-delivery", "finalize", "state"], description: "State-machine entry (specs/33 §7–§10, §13)" },
          question: { type: "string", description: "clarify/create: the research question" },
          purpose: { type: "string", description: "clarify/create: the project judgement this research supports" },
          sub_questions: { type: "array", items: { type: "string" }, description: "create: sub-question keys for sufficient-coverage checks" },
          max_rounds: { type: "number", description: "create: round-cap limit (default 4; small-scope ≤2, large-scope ≤4 per 33 §8.3)" },
          clarification_log: {
            type: "array",
            description: "create: clarification Q&A that changed the question, object boundary or evidence reading (33 §7.3). Recorded verbatim so the finalize bundle can carry it into the Research object's clarification_log.",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                answer: { type: "string" },
                answered_by: { type: "string", enum: ["human", "external", "ai"] }
              },
              required: ["question", "answer", "answered_by"],
              additionalProperties: false
            }
          },
          session_id: { type: "string", description: "submit-round/finalize/state: session id from create" },
          findings: { type: "array", items: findingSchema, description: "submit-round: raw findings for this round" },
          body: { type: "string", description: "audit-citation/check-delivery: the report markdown to audit" },
          confirmed: {
            type: "array",
            items: {
              oneOf: [
                { type: "string", description: "a confirmed statement" },
                {
                  type: "object",
                  description: "a confirmed evidence entry from the finalize bundle ({ statement, quotes[] }) — required for verbatim quote checking",
                  properties: {
                    statement: { type: "string" },
                    confidence: { type: "string" },
                    quotes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          text: { type: "string" },
                          anchor: { type: "string" },
                          source: { type: "string" }
                        }
                      }
                    }
                  }
                }
              ]
            },
            description: "audit-citation: the confirmed evidence array from finalize. Bare statements are accepted (checks references only); pass the full entries to also check verbatim quotes"
          }
        },
        required: ["action"],
        additionalProperties: false
      };
    case "research-read-object":
      return {
        type: "object",
        properties: {
          object_uid: { type: "string", description: "Canonical object_uid of the Research object to read" }
        },
        required: ["object_uid"],
        additionalProperties: false
      };
    case "research-list-objects":
      return {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["active", "all"],
            description: "active = default (current evidence inputs, 24 §12 F2); all = include retired for research history / source tracing"
          },
          limit: {
            type: "number",
            description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)"
          }
        },
        required: [],
        additionalProperties: false
      };
    case "research-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"] },
          frontmatter_draft: researchFrontmatter,
          analysis_body: { type: "string", description: "create: the analysis markdown (研究问题/输入与边界/关键发现/未证实与缺口/建议/后续分流 H2)" },
          survey_body: { type: "string", description: "create, exploratory only: the survey-stage markdown (四个固定 H3); omit for directed" },
          object_uid: { type: "string", description: "update: target object" },
          expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
          frontmatter_after: (() => { const { required: _r, ...rest } = researchFrontmatter; return { ...rest, description: FRONTMATTER_AFTER_DESCRIPTION }; })(),
          frontmatter_removals: { type: "array", items: { type: "string" }, description: FRONTMATTER_REMOVALS_DESCRIPTION },
          analysis_body_after: { type: "string", description: "update: the complete target analysis body" },
          survey_body_after: { type: "string", description: "update, exploratory only: the complete target survey body (sub-stage immutable)" },
          change_summary: { type: "string", description: "update: one short semantic summary for the change_log entry" }
        },
        required: ["action"],
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

export function toolDescriptorFor(operationKey, operation, handler) {
  return {
    name: operation.toolName,
    description: operation.summary,
    parameters: parameterSchemaFor(operationKey),
    timeoutMs: 30000,
    async execute(args, exec) {
      try {
        const result = await handler(args, exec);
        return { envelope: result };
      } catch (error) {
        return {
          envelope: envelope(operationKey, "execution_error", {
            result: null,
            scope: { requested: null, completed: [], not_completed: [operationKey] },
            sources: [],
            gaps: [String(error?.message ?? error)],
            verification: { checks: [], passed: false },
            follow_up: []
          })
        };
      }
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => renderEnvelope(operationKey, value)
    }
  };
}

export function registerResearchTools(ctx, deps) {
  const handlers = {
    "research-session-machine": (args, exec) => executeSessionAction(args, exec),
    "research-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "research-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "research-write-object": (args, exec) => executeWriteObject(args, exec, deps),
  };
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    // Coverage is registered from the declaration itself, so the guard's target
    // set always matches the tools this build really exposes (a hardcoded list
    // drifts into phantom or stale entries).
    if (operation.writeShaped === true) registerWriteShapedTool(operation.toolName);
    disposers.push(ctx.tools.register(toolDescriptorFor(operationKey, operation, handlers[operationKey])));
  }
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* already removed */ }
    }
  };
}

export { OPERATIONS };
