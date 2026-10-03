// LDVH spark mechanical layer — runtime wiring.
//
// This module connects the Spark writer (spark-writer.js, specs/20 §13 +
// specs/03 §9) to the governed tool surface so the main controller can
// drive it from a live session:
//
//   - spark-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - spark-list-objects (effect: read)             — F0/F1 discovery:
//     dedup-relevant projection (title/question/status/serves/refs),
//     open-only by default.
//   - spark-write-object (effect: may_change_state) — controlled create
//     (C1 proposal confirmed by Human) and CAS update with change_log,
//     against the governed project's fact source.
//
// Authorities: specs/05 §6 (operation declaration + common envelope),
// §9.3 (may_change_state), specs/03 §9 (controlled read/create/update,
// write-back read-back), specs/20 §13 (type-specific mechanical checks).
// Dedup semantic comparison (20 §6.2) is AI work recorded in the creation
// proposal — the list tool only supplies the deterministic inputs.

import {
  createSparkObject,
  readSparkObject,
  updateSparkObject,
  listSparkObjects,
} from "./spark-writer.js";
import { currentRouteValues } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "spark-read-object": {
    toolName: "ldvh_spark_read",
    summary: "Precise read of one Spark fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/03 §9.2, specs/20 §13)",
    effect: "read"
  },
  "spark-list-objects": {
    toolName: "ldvh_spark_list",
    summary: "Enumerate Spark fact objects (F0/F1 discovery): dedup-relevant projection (title/question/status/serves/refs) for the governed project; open-only by default (specs/03 §8, specs/20 §12)",
    effect: "read"
  },
  "spark-write-object": {
    toolName: "ldvh_spark_write",
    writeShaped: true,
    // `create` and a terminal transition (implemented/discarded) are the two
    // 20 §16 Human Gates carried by a host question (requestSparkConsent), so
    // this tool can block on a person. The timeout budget is PER TOOL, not per
    // action, so the whole tool must declare no wall-clock deadline — otherwise
    // every CAS update silently pays for the Human wait and a late answer is
    // DISCARDED by a 30s timeout, leaving the gate unenforced in real
    // compositions. See `workcase-tools.js` for the identical discipline and
    // the descriptor factory for how the flag is consumed.
    //
    // Note the third 20 §16 Gate (问题/边界大改) deliberately does NOT route
    // through an ask: it is a `09 §6` weak constraint — the implementation
    // returns the before/after comparison and must not judge it. That return
    // happens inside an already-running tool call, so it introduces no wait.
    awaitsHumanDecision: true,
    summary: "Controlled write of Spark fact objects: create (after Human-confirmed C1 proposal incl. dedup result) and CAS update with change_log, against the governed project's fact source (specs/03 §9.4–§9.5, specs/20 §13)",
    effect: "may_change_state"
  }
};

const FACT_SOURCE_ROOT_DIR = "ldvh-base";

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
// spark-read-object / spark-write-object handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("spark-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "spark-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("spark-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readSparkObject({ factSourceRoot, objectUid });
  if (!read.ok) {
    // Distinguish "not found / bad uid shape" (rejected) from carrier-level
    // defects (unavailable — the object exists but cannot be consumed).
    const rejectedCodes = new Set(["spark/invalid_uid", "spark/object_not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("spark-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "sparks") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;
  return envelope("spark-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      question: typeof fm.question === "string" ? fm.question : undefined,
      serves: typeof fm.serves === "string" ? fm.serves : undefined,
      refs: Array.isArray(fm.refs) && fm.refs.length > 0 ? fm.refs : undefined,
      body_valid: value.body_valid,
      body_issues: value.body_issues,
      frontmatter: fm,
      body: value.body,
    },
    scope: { requested: objectUid, completed: [objectUid], not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see body_issues)"] },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: value.body_valid ? [] : value.body_issues,
    verification: { checks: ["frontmatter-parse", "body-structure"], passed: value.body_valid },
    follow_up: ["spark-write-object action=update with the observed fingerprint when a controlled change is needed"]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("spark-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object discovery serves governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const includeTerminal = args?.status === "all";
  const limit = typeof args?.limit === "number" && Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 200;
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listSparkObjects({ factSourceRoot, includeTerminal, limit });
  if (!listed.ok) {
    return envelope("spark-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "sparks") }],
      gaps: [`${listed.error.code}: ${listed.error.message}`],
      verification: { checks: ["directory-scan"], passed: false },
      follow_up: []
    });
  }
  const value = listed.value;
  const gaps = value.invalid.map((entry) => `invalid carrier ${entry.file}: ${entry.reason}`);
  if (!value.complete) {
    gaps.push(`projection truncated at limit=${limit} of ${value.total} matching objects — narrow the filter or raise the limit; do not treat this page as the full set (03 §8.1)`);
  }
  return envelope("spark-list-objects", value.complete ? "completed" : "partial", {
    result: {
      count: value.items.length,
      total: value.complete ? value.items.length : value.total,
      filter: includeTerminal ? "all" : "open",
      items: value.items,
    },
    scope: {
      requested: "list",
      completed: value.complete ? ["list"] : [`first ${value.items.length} of ${value.total}`],
      not_completed: value.complete ? [] : [`${value.total - value.items.length} objects beyond the limit`],
    },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "sparks") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (20 §6.2) is a semantic comparison over title/question — performed by the AI on this projection, never by the tool",
      "spark-read-object for the F3 full content of any candidate",
    ]
  });
}

/**
 * Present the 20 §16 呈报内容 for a Spark creation and obtain the Human's
 * confirmation through the host answerer. Returns `null` when confirmation was
 * granted, or the rejection envelope to return instead.
 *
 * 20 §16 requires the Human to receive the elements they are judging. The
 * report below carries the dedup conclusion (20 §6.2), question, scope_boundary
 * and serves — the same set the type source names. It is built from the draft
 * the caller supplied, so it cannot diverge from what will be written.
 */
function sparkCreateReport(draft, dedupResult) {
  const lines = [];
  lines.push(`查重结论：${String(dedupResult).trim()}`);
  if (typeof draft.question === "string" && draft.question.trim().length > 0) lines.push(`调查问题：${draft.question.trim()}`);
  if (typeof draft.scope_boundary === "string" && draft.scope_boundary.trim().length > 0) lines.push(`调查边界：${draft.scope_boundary.trim()}`);
  lines.push(`serves：${typeof draft.serves === "string" && draft.serves.trim().length > 0 ? draft.serves.trim() : "（未声明）"}`);
  return lines.join("\n");
}

/** 20 §16 呈报内容 for a terminal transition: target status, the full
 * disposition, and (for a merge/split) every relation target. */
function sparkTerminalReport(frontmatterAfter) {
  const lines = [];
  lines.push(`拟转状态：${String(frontmatterAfter?.status ?? "").trim() || "（缺失）"}`);
  const disposition = typeof frontmatterAfter?.disposition === "string" ? frontmatterAfter.disposition.trim() : "";
  lines.push(`disposition：${disposition.length > 0 ? disposition : "（缺失）"}`);
  const relations = Array.isArray(frontmatterAfter?.relations) ? frontmatterAfter.relations : [];
  if (relations.length > 0) {
    const targets = relations
      .map((r) => `${String(r?.relation_key ?? "?")} → ${String(r?.target?.object_uid ?? "?")}`)
      .join("；");
    lines.push(`关系目标：${targets}`);
  }
  return lines.join("\n");
}

/**
 * Route one of the two mechanically-carried 20 §16 Gates through the host
 * question entry. Fail-closed on every path that is not an explicit
 * affirmative: no answerer, a failed ask, or a declined/unchosen answer.
 *
 * The THIRD 20 §16 Gate (问题/边界大改) deliberately does not appear here — it
 * is a 09 §6 weak constraint whose judgement stays with the Human; the
 * implementation only returns the before/after comparison (see the update
 * path) and must not claim that gate is mechanically guaranteed.
 */
async function requestSparkGate(deps, exec, { action, objectTitle, summary }) {
  const gate = deps?.hostSeams;
  if (gate === undefined || typeof gate.requestSparkConsent !== "function") {
    return {
      ok: false,
      envelope: envelope("spark-write-object", "unavailable", {
        result: null,
        scope: { requested: action, completed: [], not_completed: [action] },
        sources: [],
        gaps: ["ctx.userQuestions.ask is not wired into this composition, so the 20 §16 Human Gate "
          + "cannot be obtained. 20 §13/§16 require an explicit Human confirmation before this action; "
          + "REPORT TO HUMAN — an unconfirmed write must not silently become a stable fact."],
        verification: { checks: ["governance-scope", "human-confirmation"], passed: false },
        follow_up: ["human must confirm this Spark action through a session that provides an answerer, then retry"]
      })
    };
  }
  const consent = await gate.requestSparkConsent({
    action,
    objectTitle,
    summary,
    // The host forwarder reaches the browser answerer only when the request
    // carries the live agent — without it the waterfall exhausts to NO_PROVIDER.
    agent: exec?.agent,
    // This ask has no wall-clock deadline (`awaitsHumanDecision` in OPERATIONS):
    // the caller's signal is the only release for an abandoned prompt, and
    // forwarding it makes the ask abort (ASK_ABORTED) rather than hang.
    signal: exec?.signal,
  });
  if (consent?.granted === true) return { ok: true };
  return {
    ok: false,
    envelope: envelope("spark-write-object", "rejected", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`20 §16 requires an explicit Human confirmation for this action: ${consent?.reason ?? "no confirmation obtained"}`],
      verification: { checks: ["governance-scope", "human-confirmation"], passed: false },
      follow_up: ["obtain the Human's explicit confirmation, then retry — do not proceed on an assumed consent"]
    })
  };
}

/**
 * Compute the 20 §13/§16 大改 judgement material: the before/after comparison
 * for `question` and `scope_boundary`.
 *
 * This is the mechanically-forceable part of a 09 §6 weak constraint. The
 * implementation RETURNS the evidence the Human needs and does not judge
 * whether a change is 大改 — `09 §5` finds that undecidable in form. Two
 * consequences the caller must not misread:
 *
 *  - A returned delta means the comparison was SUPPLIED, not that the change
 *    was confirmed. 20 §16 says this Gate is not mechanically verifiable, so
 *    this field is not evidence that the Gate was satisfied.
 *  - A `null` return means the fields did not change (nothing to judge), not
 *    that the Gate was passed.
 */
async function sparkBoundaryDelta({ factSourceRoot, objectUid, frontmatterAfter }) {
  const before = await readSparkObject({ factSourceRoot, objectUid });
  if (!before.ok) return null;
  const prev = before.value.frontmatter;
  const pick = (fm, key) => (typeof fm?.[key] === "string" ? fm[key] : null);
  const changed = [];
  for (const field of ["question", "scope_boundary"]) {
    const from = pick(prev, field);
    const to = pick(frontmatterAfter, field);
    if (from !== to) changed.push({ field, before: from, after: to });
  }
  return changed.length === 0 ? null : changed;
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update") {
    return invalidRequest("spark-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("spark-write-object", "unavailable", {
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
    return envelope("spark-write-object", "unavailable", {
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
    const bodyMarkdown = args?.body_markdown;
    if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
      return invalidRequest("spark-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 当前理解') are required for action=create", "create");
    }
    // 20 §6.2/§17.7: dedup MUST be executed before creation and its conclusion
    // recorded. The comparison is semantic (03 §8.2 forbids a mechanical
    // similarity verdict), so the AI supplies the conclusion — but it must
    // supply ONE, and it is then presented to the Human below rather than
    // staying an unrecorded assertion.
    const dedupResult = args?.dedup_result;
    if (typeof dedupResult !== "string" || dedupResult.trim().length === 0) {
      return invalidRequest("spark-write-object", "dedup_result is required for action=create (20 §6.2/§17.7): state the semantic dedup conclusion against existing open and terminal Sparks (e.g. \"no same-topic Spark found\" / \"overlaps <uid> but is a distinct direction\"). Dedup is not mechanically decidable — the conclusion stays with you, but an unrecorded one is a Stop Condition.", "create");
    }
    // Every mechanical check runs FIRST, on a dry run that allocates nothing.
    // 20 §16 requires an explicit Human confirmation; asking for a candidate
    // the writer is already certain to refuse would spend the Human's attention
    // on an action that can never land.
    const dry = await createSparkObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.ok ? sig.value : null,
      dryRun: true,
      fsPort: deps.fsPort,
    });
    if (!dry.ok) {
      return writeRejected("spark-write-object", dry, factSourceRoot);
    }
    // 20 §16 Gate 1/2: creation requires an explicit Human confirmation through
    // the host answerer. Fail closed when the ask entry is absent — silence is
    // not consent, and an unconfirmed candidate must not silently become an
    // object (00 §4.4: without a scope-clear response the matter stays paused).
    const consent = await requestSparkGate(deps, exec, {
      action: "create",
      objectTitle: typeof draft.title === "string" ? draft.title : null,
      summary: sparkCreateReport(draft, dedupResult),
    });
    if (!consent.ok) return consent.envelope;
    const created = await createSparkObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.ok ? sig.value : null,
      fsPort: deps.fsPort,
    });
    if (!created.ok) {
      return writeRejected("spark-write-object", created, factSourceRoot);
    }
    // 03 §9.4 item 5: precise read-back of the current file after create.
    const readBack = await readSparkObject({ factSourceRoot, objectUid: created.value.object_uid });
    if (!readBack.ok || readBack.value.fingerprint !== created.value.fingerprint) {
      return envelope("spark-write-object", "partial", {
        result: { object_uid: created.value.object_uid, file: created.value.file, fingerprint: created.value.fingerprint, read_back: "failed" },
        scope: { requested: "create", completed: ["create"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
        sources: [{ kind: "fact-object", path: created.value.file }],
        gaps: [`created but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
        verification: { checks: ["create"], passed: false },
        follow_up: ["STOP further writes and success claims (03 §9.4 item 7); re-read and verify the file state before anything else"]
      });
    }
    return envelope("spark-write-object", "completed", {
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
      verification: { checks: ["frontmatter-closed-set", "question-single-sentence", "body-structure", "carrier-coherence", "serves-resolution", "refs-resolution", "atomic-write", "read-back"], passed: true },
      follow_up: ["the object is created and read back; committing it to Git goes through the controlled-commit contract (specs/06)"]
    });
  }

  // action === "update"
  const objectUid = args?.object_uid;
  const expectedFingerprint = args?.expected_fingerprint;
  const frontmatterAfter = args?.frontmatter_after;
  const bodyMarkdownAfter = args?.body_markdown_after;
  const changeSummary = args?.change_summary;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("spark-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("spark-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("spark-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("spark-write-object", "change_summary (one short semantic summary for the change_log) is required for action=update", "update");
  }

  // 20 §16 Gate: a transition INTO a terminal state (implemented/discarded,
  // including merge/split) requires an explicit Human confirmation. Read the
  // current object first so the request can compare before/after and so the
  // terminal-before check below is not bypassed by an unreadable target.
  const requestedStatus = frontmatterAfter.status;
  const isTerminalTransition = requestedStatus === "implemented" || requestedStatus === "discarded";
  if (isTerminalTransition) {
    const before = await readSparkObject({ factSourceRoot, objectUid });
    if (!before.ok) return writeRejected("spark-write-object", before, factSourceRoot);
    // Ask the Human ONLY after the write is known to be mechanically possible.
    // Confirming a request that the CAS baseline or the writer's own checks
    // would refuse spends the Human's attention on an action that can never
    // land — and a stale fingerprint is the common case, since a Gate answer
    // takes real time while the object may move underneath it. Every cheap
    // refusal must therefore precede the ask.
    if (before.value.fingerprint !== expectedFingerprint) {
      return writeRejected("spark-write-object", {
        ok: false,
        error: {
          code: "spark/cas_conflict",
          message: `fingerprint mismatch: expected ${expectedFingerprint}, actual ${before.value.fingerprint}`,
          details: {},
        },
      }, factSourceRoot);
    }
    // …and the writer's REMAINING checks too, not just the CAS baseline.
    //
    // P1 of the independent review of 26be321 (2026-09-26): this comment claimed
    // "every cheap refusal must precede the ask", but only the CAS comparison
    // did. A doomed terminal update (illegal relation key / over-long disposition
    // / unresolvable serves) still consumed one Human question before the writer
    // rejected it — measured: three such cases each burned exactly one question,
    // and a question cannot be un-asked. The create path already ran a dry run
    // before asking; this makes the update path symmetric.
    const updateDry = await updateSparkObject({
      factSourceRoot,
      objectUid,
      expectedFingerprint,
      frontmatterAfter,
      bodyMarkdownAfter,
      changeSummary,
      sessionSignature: sig.ok ? sig.value : null,
      dryRun: true,
      fsPort: deps.fsPort,
    });
    if (!updateDry.ok) {
      return writeRejected("spark-write-object", updateDry, factSourceRoot);
    }
    const wasTerminal = before.value.frontmatter.status !== "open";
    // A correction of an ALREADY terminal object (20 §9.2: content stays
    // correctable, status must not change) is not a terminal transition — it
    // re-states the same status. Requiring a fresh Gate for it would convert
    // every typo fix into a Human Gate, which 20 §9.2 does not ask for.
    if (!wasTerminal) {
      const consent = await requestSparkGate(deps, exec, {
        action: "terminal",
        objectTitle: before.value.frontmatter.title ?? null,
        summary: sparkTerminalReport(frontmatterAfter),
      });
      if (!consent.ok) return consent.envelope;
    }
  }

  // 20 §13 (问题/边界大改): a change to question or scope_boundary must be
  // confirmed first. 09 §5 finds this judgement formally undecidable, so it is
  // a 09 §6 WEAK constraint — the implementation returns the before/after
  // comparison that the Human needs to decide, and must NOT decide it itself.
  // Not blocking is deliberate and is not a substitute for the Human's
  // judgement; this envelope field must not be read as "大改 already checked".
  const boundaryDelta = await sparkBoundaryDelta({ factSourceRoot, objectUid, frontmatterAfter });

  const updated = await updateSparkObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    bodyMarkdownAfter,
    changeSummary,
    // Update path MUST brand the carrier exactly like the create path: a plain
    // {provider,model} object is rejected by resolveAuthoritativeSignature(), so
    // passing sig.value here silently wrote an unsigned change_log entry while
    // the envelope still reported sig.ok === true (no gap). Found 2026-09-12.
    sessionSignature: sig.ok ? sig.value : null,
    fsPort: deps.fsPort,
  });
  if (!updated.ok) {
    return writeRejected("spark-write-object", updated, factSourceRoot);
  }
  const readBack = await readSparkObject({ factSourceRoot, objectUid });
  if (!readBack.ok || readBack.value.fingerprint !== updated.value.fingerprint) {
    return envelope("spark-write-object", "partial", {
      result: { object_uid: objectUid, fingerprint: updated.value.fingerprint, read_back: "failed" },
      scope: { requested: "update", completed: ["update"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "sparks") }],
      gaps: [`updated but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
      verification: { checks: ["update"], passed: false },
      follow_up: ["STOP further writes and success claims (03 §9.7); re-read the object before anything else"]
    });
  }
  return envelope("spark-write-object", "completed", {
    result: {
      action: "update",
      object_uid: objectUid,
      fingerprint: updated.value.fingerprint,
      read_back: { ok: true, fingerprint: readBack.value.fingerprint, body_valid: readBack.value.body_valid },
      changes: [{ object_uid: objectUid, change: "updated", summary: changeSummary }]
    },
    scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: readBack.value.file, content_fingerprint: updated.value.fingerprint }],
    // 20 §13 大改项（09 §6 弱约束）：the before/after comparison is RETURNED for
    // the Human to judge. Its presence means the evidence was supplied — NOT
    // that the change was confirmed, and not that the Gate is mechanically
    // guaranteed (20 §16 says this Gate is not mechanically verifiable).
    ...boundaryDelta === null
      ? {}
      : {
          boundary_delta: boundaryDelta,
          boundary_delta_note: "20 §13/§16 大改项为 09 §6 弱约束：本字段交还 question/scope_boundary 的现值与拟改值对照供 Human 判断，不构成该 Human Gate 已取得的证据，也不由机械验证。"
        },
    gaps: sig.ok ? [] : [`change_log entry carries no provider/model: ${sig.reason}`],
    verification: { checks: ["cas-baseline", "frontmatter-closed-set", "question-single-sentence", "body-structure", "carrier-coherence", "serves-resolution", "refs-resolution", "relations-contract", "terminal-state-guard", "atomic-write", "read-back"], passed: true },
    follow_up: ["use the NEW fingerprint from this result for the next update; committing goes through the controlled-commit contract (specs/06)"]
  });
}

function writeRejected(operationKey, failureResult, factSourceRoot) {
  const code = failureResult.error.code;
  // Mechanical rejections (source-defined conditions refusing the write) vs
  // availability failures (carrier/IO-level problems). Both are zero-write.
  const mechanicalCodes = new Set([
    "spark/frontmatter_invalid", "spark/body_invalid", "spark/coherence_invalid",
    "spark/relations_invalid", "spark/relation_target_unresolvable", "spark/serves_unresolvable", "spark/refs_unresolvable",
    "spark/initial_state_violation", "spark/status_transition_invalid", "spark/status_terminal",
    "spark/cas_conflict", "spark/change_summary_required", "spark/invalid_uid",
    "invalid_request",
  ]);
  const outcome = mechanicalCodes.has(code) ? "rejected" : "unavailable";
  const issues = Array.isArray(failureResult.error.details?.issues) ? failureResult.error.details.issues : [];
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: "write", completed: [], not_completed: ["write"] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "sparks") }],
    gaps: [`${code}: ${failureResult.error.message}`, ...issues],
    verification: { checks: [], passed: false },
    follow_up: code === "spark/cas_conflict"
      ? ["re-read the object (spark-read-object), reconcile the concurrent change, and retry with the fresh fingerprint"]
      : code === "spark/status_terminal"
        ? ["terminal sparks do NOT change status (20 §9.2: 终态不可重开), but their content stays correctable — fix a wrong or over-long terminal record in place with a correction; for later unresolved info create a NEW open Spark and reference the old uid in its summary/change_log"]
        : ["fix the reported mechanical issues and retry; zero write has occurred"]
  });
}

// ---------------------------------------------------------------------------
// Registration (same shape as research-tools.js — mounted from
// registerLdvhTools, so tools land only in governed sessions)
// ---------------------------------------------------------------------------

function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  const result = env.result;
  if (result?.object_uid !== undefined) lines.push(`object: ${result.object_uid}`);
  if (result?.title !== undefined) lines.push(`title: ${result.title}`);
  if (result?.status !== undefined) lines.push(`status: ${result.status}`);
  if (result?.serves !== undefined) lines.push(`serves: ${result.serves}`);
  // refs (20 §8): verbose on the single-object read (uid + resolved title when
  // available) so the model can see associations without a second call.
  if (Array.isArray(result?.refs) && result.refs.length > 0) {
    lines.push(`refs: ${result.refs.map((r) => r?.title ? `${r.object_uid} (${r.title})` : r?.object_uid ?? JSON.stringify(r)).join(", ")}`);
  }
  if (result?.question !== undefined) lines.push(`question: ${result.question}`);
  // Full fingerprint, never truncated (03 §9.5): the render output is the
  // model's only window on the tool result — a truncated fingerprint makes
  // the CAS baseline unobtainable and blocks every controlled update.
  if (result?.fingerprint !== undefined) lines.push(`fingerprint: ${result.fingerprint}`);
  if (result?.body_valid !== undefined) lines.push(`body_valid: ${result.body_valid}`);
  if (result?.read_back?.ok !== undefined) lines.push(`read_back: ${result.read_back.ok ? "ok" : "FAILED"}`);
  if (result?.actual_ref !== undefined) lines.push(`file: ${result.actual_ref}`);
  if (result?.count !== undefined) lines.push(`count: ${result.count}${result.total !== undefined && result.total !== result.count ? ` (of ${result.total})` : ""}`);
  if (Array.isArray(result?.items)) {
    for (const item of result.items) {
      // F1 projection must render title + status + priority + serves + refs
      // (20 §12). priority was carried by the writer projection but never
      // printed here, so the model could not see the ordering tier the spec
      // promises; missing priority is legal (未分档) and renders as no tag.
      lines.push(`- ${item.object_uid} [${item.status}]${item.priority ? ` ${item.priority}` : ""} ${item.title}${item.serves ? ` (${item.serves})` : ""}${Array.isArray(item.refs) && item.refs.length > 0 ? ` → ${item.refs.map((r) => r?.object_uid ?? r).join(", ")}` : ""}`);
    }
  }
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${change.object_uid}`);
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  // Models mis-shape open objects when they see additionalProperties:true
  // with no declared properties — every Spark data object declares its
  // shape explicitly (mirrors 20 §8 field contract).
  const evolutionEntry = {
    type: "object",
    properties: {
      at: { type: "string", description: "when the pivot happened" },
      summary: { type: "string", description: "what changed and its impact" }
    },
    required: ["at", "summary"],
    additionalProperties: false
  };
  const relationEntry = {
    type: "object",
    properties: {
      relation_key: { type: "string", enum: ["merged-into", "split-into"] },
      target: { type: "object", properties: { object_uid: { type: "string" } }, required: ["object_uid"], additionalProperties: false }
    },
    required: ["relation_key", "target"],
    additionalProperties: false
  };
  /** refs target (03 §7.2 minimal shape: object_uid only, no title copies). */
  const refsEntry = {
    type: "object",
    properties: { object_uid: { type: "string", description: "canonical object_uid of an existing same-project fact object" } },
    required: ["object_uid"],
    additionalProperties: false
  };
  const sparkFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 30 characters; candidate locating and Human scanning" },
      status: { type: "string", enum: ["open", "implemented", "discarded"], description: "create must be open; update may transition open→implemented/discarded. A terminal status does NOT change again (20 §9.2: 终态不可重开, 终态不可重开但内容可更正) — content correction is still allowed" },
      question: { type: "string", description: "single readable sentence (at most one terminal 。？！ ending the string); must appear verbatim in the 调查问题 body section" },
      scope_boundary: { type: "string", description: "when to stop (boundary, not goal achievement); must appear verbatim in the 调查边界 body section" },
      intent: { type: "string", description: "why this is worth keeping + the follow-up direction" },
      summary: { type: "string", description: "complete current semantic snapshot; must appear verbatim in the 当前理解 body section" },
      evolution: { type: "array", items: evolutionEntry, description: "substantive-pivot log (cap 20); when non-empty the body must carry a 演变 H2 section" },
      serves: { type: "string", description: "e.g. SG-4; must match an SG-n in goal.md 子目标; omit when not applicable" },
      refs: { type: "array", items: refsEntry, description: "related fact objects (03 §7.2 关联引用型, 20 §8): any type; target status is NOT checked (an association survives the target closing); every target must resolve to an existing, readable, same-project object_uid or the write is rejected; cap 10; state-neutral; omit when none. Surfaced on the F1 list card for Human scanning." },
      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "suspension ordering tier (20 §8): closed set P0–P3, may appear only while status=open, terminal must omit it; optional — an untiered Spark is equally valid" },
      disposition: { type: "string", description: "terminal destination and scope; required iff status is implemented/discarded, forbidden while open" },
      relations: { type: "array", items: relationEntry, description: "merged-into (cardinality 1) / split-into (1..n); only on discarded, targets must be existing open sparks (20 §11)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "question", "scope_boundary", "intent", "summary"],
    additionalProperties: false
  };
  switch (operationKey) {
    case "spark-read-object":
      return {
        type: "object",
        properties: {
          object_uid: { type: "string", description: "Canonical object_uid of the Spark object to read" }
        },
        required: ["object_uid"],
        additionalProperties: false
      };
    case "spark-list-objects":
      return {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "all"], description: "open = default (ordinary unresolved candidates only, 20 §12); all = include implemented/discarded for historical tracing" },
          limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
        },
        additionalProperties: false
      };
    case "spark-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"] },
          dedup_result: { type: "string", description: "create (required): the semantic dedup conclusion against existing open and terminal Sparks (20 §6.2/§17.7 — 03 §8.2 forbids a mechanical similarity verdict, so the conclusion stays with you, but it is required and is presented to the Human at the 20 §16 Gate). An unrecorded dedup is a Stop Condition." },
          frontmatter_draft: sparkFrontmatter,
          body_markdown: { type: "string", description: "create: the body markdown starting with '## 当前理解' (H2 sections 当前理解/调查问题/调查边界, plus 演变 iff evolution non-empty; the H1 is generated from title)" },
          object_uid: { type: "string", description: "update: target object" },
          expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
          frontmatter_after: (() => { const { required: _r, ...rest } = sparkFrontmatter; return { ...rest, description: "update: the complete target frontmatter (all fields; schema required relaxed here — handler validates completeness via CAS+writer)" }; })(),
          body_markdown_after: { type: "string", description: "update: the complete target body markdown (same shape as body_markdown)" },
          change_summary: { type: "string", description: "update: one short semantic summary for the change_log entry" }
        },
        required: ["action"],
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

/**
 * `timeoutMs` is omitted for operations that block on a Human answer
 * (`awaitsHumanDecision`) — see the identical note in `ldvh-tools.js` and
 * `workcase-tools.js`. The host's per-tool deadline would otherwise discard a
 * late answer, which does not make the gate slower but WRONG: the write would
 * be refused while the Human's confirmation arrives too late to be recorded.
 *
 * This is the consumption point for the flag. Declaring `awaitsHumanDecision`
 * without this line has ZERO effect — the flag would be inert while the
 * envelope kept reporting success (the regression the 09 §5 mutation test
 * guards against).
 */
export function toolDescriptorFor(operationKey, operation, handler) {
  return {
    name: operation.toolName,
    description: operation.summary,
    parameters: parameterSchemaFor(operationKey),
    ...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 },
    async execute(args, exec) {
      try {
        const result = await handler(args, exec);
        // Prune undefined values (JSON round-trip): the harness lossless-JSON
        // validation rejects them, and conditional fields legitimately produce
        // undefined on objects where they are absent.
        return { envelope: JSON.parse(JSON.stringify(result)) };
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

export function registerSparkTools(ctx, deps) {
  // 宿主 fs 端口（2026-10-03）：把**写盘通道**接到宿主的 fs 链路，使 LDVH 的写入
  // 参与宿主的观察状态机（emit fs/observed）并受其写前门禁（fs/write-intent）约束。
  // 缺入口时整个端口为 null，写入回退为自建原子写——**不因此失去写入能力**。
  //
  // 只换通道，不动 CAS 基准：content_fingerprint 仍由 spark-writer 自算（specs/03:143
  // 要求绑定完整内容；宿主的 FsVersion 是 opaque 过期令牌，不能冒充内容指纹）。
  //
  // 依据与实测：docs/experiment-a1-fs-feasibility-2026-10-03.md。
  const fsService = typeof ctx?.get === "function" ? ctx.get("fs") : undefined;
  const fsPort = fsService === undefined || fsService === null ? null : {
    resolve: (path) => fsService.resolve(path),
    // 单槽判定：门禁给出 createIfAbsent / replaceIfVersion；无策略时 undefined（无条件写）。
    writeIntent: (target) => ctx.waterfall("fs/write-intent", target, undefined, () => undefined),
    writeText: async (target, content, intent) => {
      const outcome = await fsService.writeText(target, content, intent);
      // 与宿主工具同序：写入方负责把结果版本记入观察面（写序第 4 步）。
      try { ctx.emit("fs/observed", target, { kind: "present", version: outcome.version }, undefined); }
      catch { /* 观察面不可用不得使写入失败 */ }
      return outcome;
    },
  };
  const handlers = {
    "spark-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "spark-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "spark-write-object": (args, exec) => executeWriteObject(args, exec, { ...deps, fsPort }),
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
