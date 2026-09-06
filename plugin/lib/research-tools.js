// LDVH research mechanical layer — runtime wiring (P0).
//
// This module connects the two research mechanical modules to the governed
// tool surface so the main controller can actually drive them from a live
// session:
//
//   - research-session.js (specs/11 §5–§8+§10): the research session state
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
  shapeEvidence,
  auditCitationLoop,
  checkDeliveryContract,
  ResearchSession,
} from "./research-session.js";
import {
  createResearchObject,
  readResearchObject,
  updateResearchObject,
} from "./research-writer.js";
import { currentRouteValues } from "./session-signature.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";

const OPERATIONS = {
  "research-session-machine": {
    toolName: "ldvh_research_session",
    summary: "Drive the specs/11 research session state machine: clarify the question, submit evidence rounds (three-state + citation loop), audit convergence, and finalize the evidence bundle (specs/11 §5–§8, §10)",
    effect: "read"
  },
  "research-read-object": {
    toolName: "ldvh_research_read",
    summary: "Precise read of one Research fact object by object_uid: frontmatter, body, sub-stage and file fingerprint (specs/03 §9.2, specs/24 §13)",
    effect: "read"
  },
  "research-write-object": {
    toolName: "ldvh_research_write",
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
// ---------------------------------------------------------------------------

const MAX_SESSIONS = 32;
const sessions = new Map();

function createSession(question, purpose, options) {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
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
  return { ok: true, value: { provider: route.value.provider, model: route.value.model } };
}

// ---------------------------------------------------------------------------
// research-session-machine handlers (specs/11 mechanical slice)
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
    sources: [{ kind: "spec", path: "specs/11-调研系统规范.md", section: "5. 调研入口澄清" }],
    gaps: [],
    verification: { checks: ["ambiguity-heuristics"], passed: true },
    follow_up: analysis.value.needsClarification
      ? ["surface the ≤3 clarification questions to Human (or record the degradation per 11 §5.4)", "action=create to start the session"]
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
  const { id, session } = createSession(question, purpose, {
    sub_questions: Array.isArray(args?.sub_questions) ? args.sub_questions : [],
    max_rounds: typeof args?.max_rounds === "number" && args.max_rounds > 0 ? args.max_rounds : 4,
  });
  return Promise.resolve(envelope("research-session-machine", "completed", {
    result: { session_id: id, max_rounds: session.maxRounds, sub_questions: session.subQuestions.length },
    scope: { requested: "create", completed: ["create"], not_completed: [] },
    sources: [{ kind: "spec", path: "specs/11-调研系统规范.md", section: "6. 三层收敛判定" }],
    gaps: [],
    verification: { checks: ["session-created"], passed: true },
    follow_up: ["action=submit-round with findings (each: statement, state, evidence/issue/gap)"]
  }));
}

function executeSubmitRound(args) {
  const id = args?.session_id;
  const session = typeof id === "string" ? getSession(id) : null;
  if (session === null) {
    return Promise.resolve(rejected("research-session-machine", [`session_id ${JSON.stringify(id)} does not resolve to a live research session`]));
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
    sources: [{ kind: "spec", path: "specs/11-调研系统规范.md", section: "7. 三态证据结构" }],
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
  return Promise.resolve(envelope("research-session-machine", audit.ok ? "completed" : "rejected", {
    result: { ok: audit.ok, issues: audit.issues },
    scope: { requested: "audit-citation", completed: audit.ok ? ["citation loop"] : [], not_completed: audit.ok ? [] : ["citation loop"] },
    sources: [{ kind: "spec", path: "specs/11-调研系统规范.md", section: "8. 引用闭环" }],
    gaps: audit.issues,
    verification: { checks: ["citation-loop-audit"], passed: audit.ok },
    follow_up: audit.ok ? [] : ["fix the cited issues; the report must not be delivered while the audit fails (11 §8.3)"]
  }));
}

function executeCheckDelivery(args) {
  const body = args?.body;
  if (typeof body !== "string" || body.length === 0) {
    return Promise.resolve(invalidRequest("research-session-machine", "body (report markdown) is required for action=check-delivery", "check-delivery"));
  }
  const check = checkDeliveryContract(body);
  return Promise.resolve(envelope("research-session-machine", check.ok ? "completed" : "rejected", {
    result: { ok: check.ok, issues: check.issues },
    scope: { requested: "check-delivery", completed: check.ok ? ["placeholder scan"] : [], not_completed: check.ok ? [] : ["placeholder scan"] },
    sources: [{ kind: "spec", path: "specs/11-调研系统规范.md", section: "10. 交付合同" }],
    gaps: check.issues,
    verification: { checks: ["placeholder-scan"], passed: check.ok },
    follow_up: check.ok ? [] : ["fill the placeholders and re-run; fail loud, no half-finished report (11 §10.3)"]
  }));
}

function executeFinalize(args) {
  const id = args?.session_id;
  const session = typeof id === "string" ? getSession(id) : null;
  if (session === null) {
    return Promise.resolve(rejected("research-session-machine", [`session_id ${JSON.stringify(id)} does not resolve to a live research session`]));
  }
  const bundle = session.finalize();
  if (!bundle.ok) {
    return Promise.resolve(rejected("research-session-machine", [`${bundle.error.code}: ${bundle.error.message}`]));
  }
  return Promise.resolve(envelope("research-session-machine", "completed", {
    result: { session_id: id, ...bundle.value },
    scope: { requested: "finalize", completed: ["evidence bundle"], not_completed: [] },
    sources: [{ kind: "spec", path: "specs/11-调研系统规范.md", section: "6. 三层收敛判定" }],
    gaps: [],
    verification: { checks: ["three-state-invariants", "stopping-consistency", "citation-loop"], passed: true },
    follow_up: ["research-write-object action=create to persist the Research object (specs/24 §13)"]
  }));
}

function executeSessionState(args) {
  const id = args?.session_id;
  const session = typeof id === "string" ? getSession(id) : null;
  if (session === null) {
    return Promise.resolve(rejected("research-session-machine", [`session_id ${JSON.stringify(id)} does not resolve to a live research session`]));
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
// research-read-object / research-write-object (specs/03 §9 + specs/24 §13)
// ---------------------------------------------------------------------------

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
  // Signature unavailability does not block the write (specs/06 attaches the
  // authoritative signature at commit time via the Git Gate); the change_log
  // entry just carries no provider/model then. Reported honestly in gaps.

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
    analysisBodyAfter,
    surveyBodyAfter,
    changeSummary,
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
  if (result?.object_uid !== undefined) lines.push(`object: ${result.object_uid}`);
  if (result?.fingerprint !== undefined) lines.push(`fingerprint: ${String(result.fingerprint).slice(0, 16)}…`);
  if (result?.stop !== undefined) lines.push(`converged: ${result.stop}${result.reason ? ` (${result.reason})` : ""}`);
  if (result?.round_number !== undefined) lines.push(`round: ${result.round_number}/${result.max_rounds ?? "?"}`);
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${change.object_uid}`);
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
          action: { type: "string", enum: ["clarify", "create", "submit-round", "audit-citation", "check-delivery", "finalize", "state"], description: "State-machine entry (specs/11 §5–§8, §10)" },
          question: { type: "string", description: "clarify/create: the research question" },
          purpose: { type: "string", description: "clarify/create: the project judgement this research supports" },
          sub_questions: { type: "array", items: { type: "string" }, description: "create: sub-question keys for sufficient-coverage checks" },
          max_rounds: { type: "number", description: "create: round-cap limit (default 4; small-scope ≤2, large-scope ≤4 per 11 §6.3)" },
          session_id: { type: "string", description: "submit-round/finalize/state: session id from create" },
          findings: { type: "array", items: findingSchema, description: "submit-round: raw findings for this round" },
          body: { type: "string", description: "audit-citation/check-delivery: the report markdown to audit" },
          confirmed: { type: "array", items: { type: "string" }, description: "audit-citation: the confirmed statements array from finalize" }
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
          frontmatter_after: (() => { const { required: _r, ...rest } = researchFrontmatter; return { ...rest, description: "update: the complete target frontmatter (all fields; schema required relaxed here — handler validates completeness via CAS+writer)" }; })(),
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
    "research-write-object": (args, exec) => executeWriteObject(args, exec, deps),
  };
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    disposers.push(ctx.tools.register(toolDescriptorFor(operationKey, operation, handlers[operationKey])));
  }
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* already removed */ }
    }
  };
}

export { OPERATIONS };
