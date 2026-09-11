// LDVH adr mechanical layer — runtime wiring.
//
// This module connects the ADR writer (adr-writer.js, specs/22 §13 +
// specs/03 §9) to the governed tool surface so the main controller can
// drive it from a live session:
//
//   - adr-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - adr-list-objects (effect: read)             — F0/F1 discovery:
//     dedup-relevant projection (title/decision/status/trigger_signal),
//     active-only by default (22 §12: retired stays out of ordinary
//     candidates).
//   - adr-write-object (effect: may_change_state) — controlled create
//     (after Human-confirmed proposal incl. dedup result) and CAS update
//     with change_log: active→active is errata-only (mechanically gated,
//     22 §9.3), active→retired is the terminal transition.
//
// Authorities: specs/05 §6 (operation declaration + common envelope),
// §9.3 (may_change_state), specs/03 §9 (controlled read/create/update,
// write-back read-back), specs/22 §13 (type-specific mechanical checks).
// Dedup semantic comparison (22 §6.2) is AI work recorded in the creation
// proposal — the list tool only supplies the deterministic inputs.

import {
  createAdrObject,
  readAdrObject,
  updateAdrObject,
  listAdrObjects,
} from "./adr-writer.js";
import { currentRouteValues } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";

const OPERATIONS = {
  "adr-read-object": {
    toolName: "ldvh_adr_read",
    summary: "Precise read of one ADR fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/03 §9.2, specs/22 §13)",
    effect: "read"
  },
  "adr-list-objects": {
    toolName: "ldvh_adr_list",
    summary: "Enumerate ADR fact objects (F0/F1 discovery): dedup-relevant projection (title/decision/status/trigger_signal) for the governed project; active-only by default (specs/03 §8, specs/22 §12)",
    effect: "read"
  },
  "adr-write-object": {
    toolName: "ldvh_adr_write",
    summary: "Controlled write of ADR fact objects: create (after Human-confirmed proposal incl. dedup result) and CAS update with change_log; active→active is errata-only (decision/scope field-identical, 22 §9.3), active→retired is terminal (specs/03 §9.4–§9.5, specs/22 §13)",
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
  return { ok: true, value: { provider: route.value.provider, model: route.value.model } };
}

// ---------------------------------------------------------------------------
// adr-read-object / adr-list-objects / adr-write-object handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("adr-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "adr-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("adr-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readAdrObject({ factSourceRoot, objectUid });
  if (!read.ok) {
    // Distinguish "not found / bad uid shape" (rejected) from carrier-level
    // defects (unavailable — the object exists but cannot be consumed).
    const rejectedCodes = new Set(["adr/invalid_uid", "adr/object_not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("adr-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;
  return envelope("adr-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      decision: typeof fm.decision === "string" ? fm.decision : undefined,
      scope: typeof fm.scope === "string" ? fm.scope : undefined,
      trigger_signal: typeof fm.trigger_signal === "string" ? fm.trigger_signal : undefined,
      retirement_reason: typeof fm.retirement_reason === "string" ? fm.retirement_reason : undefined,
      body_valid: value.body_valid,
      body_issues: value.body_issues,
      frontmatter: fm,
      body: value.body,
    },
    scope: { requested: objectUid, completed: [objectUid], not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see body_issues)"] },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: value.body_valid ? [] : value.body_issues,
    verification: { checks: ["frontmatter-parse", "body-structure"], passed: value.body_valid },
    follow_up: ["adr-write-object action=update with the observed fingerprint when a controlled change is needed"]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("adr-list-objects", "unavailable", {
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
  const listed = await listAdrObjects({ factSourceRoot, includeTerminal, limit });
  if (!listed.ok) {
    return envelope("adr-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
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
  return envelope("adr-list-objects", value.complete ? "completed" : "partial", {
    result: {
      count: value.items.length,
      total: value.complete ? value.items.length : value.total,
      filter: includeTerminal ? "all" : "active",
      items: value.items,
    },
    scope: {
      requested: "list",
      completed: value.complete ? ["list"] : [`first ${value.items.length} of ${value.total}`],
      not_completed: value.complete ? [] : [`${value.total - value.items.length} objects beyond the limit`],
    },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (22 §6.2) is a semantic comparison over title/decision — performed by the AI on this projection, never by the tool",
      "adr-read-object for the F3 full content of any candidate",
    ]
  });
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update") {
    return invalidRequest("adr-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("adr-write-object", "unavailable", {
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
    const bodyMarkdown = args?.body_markdown;
    if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
      return invalidRequest("adr-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 决策背景') are required for action=create", "create");
    }
    const created = await createAdrObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.ok ? authoritativeSignature(sig.value) : null,
    });
    if (!created.ok) {
      return writeRejected("adr-write-object", created, factSourceRoot);
    }
    // 03 §9.4 item 5: precise read-back of the current file after create.
    const readBack = await readAdrObject({ factSourceRoot, objectUid: created.value.object_uid });
    if (!readBack.ok || readBack.value.fingerprint !== created.value.fingerprint) {
      return envelope("adr-write-object", "partial", {
        result: { object_uid: created.value.object_uid, file: created.value.file, fingerprint: created.value.fingerprint, read_back: "failed" },
        scope: { requested: "create", completed: ["create"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
        sources: [{ kind: "fact-object", path: created.value.file }],
        gaps: [`created but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
        verification: { checks: ["create"], passed: false },
        follow_up: ["STOP further writes and success claims (03 §9.4 item 7); re-read and verify the file state before anything else"]
      });
    }
    return envelope("adr-write-object", "completed", {
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
      verification: { checks: ["frontmatter-closed-set", "decision-single-sentence", "body-structure", "carrier-coherence", "atomic-write", "read-back"], passed: true },
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
    return invalidRequest("adr-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("adr-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("adr-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("adr-write-object", "change_summary (one short semantic summary for the change_log) is required for action=update", "update");
  }
  const updated = await updateAdrObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    bodyMarkdownAfter,
    changeSummary,
    sessionSignature: sig.ok ? sig.value : null,
  });
  if (!updated.ok) {
    return writeRejected("adr-write-object", updated, factSourceRoot);
  }
  const readBack = await readAdrObject({ factSourceRoot, objectUid });
  if (!readBack.ok || readBack.value.fingerprint !== updated.value.fingerprint) {
    return envelope("adr-write-object", "partial", {
      result: { object_uid: objectUid, fingerprint: updated.value.fingerprint, read_back: "failed" },
      scope: { requested: "update", completed: ["update"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
      gaps: [`updated but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
      verification: { checks: ["update"], passed: false },
      follow_up: ["STOP further writes and success claims (03 §9.7); re-read the object before anything else"]
    });
  }
  return envelope("adr-write-object", "completed", {
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
    verification: { checks: ["cas-baseline", "frontmatter-closed-set", "decision-single-sentence", "errata-boundary", "body-structure", "carrier-coherence", "relations-contract", "terminal-state-guard", "atomic-write", "read-back"], passed: true },
    follow_up: ["use the NEW fingerprint from this result for the next update; committing goes through the controlled-commit contract (specs/06)"]
  });
}

function writeRejected(operationKey, failureResult, factSourceRoot) {
  const code = failureResult.error.code;
  // Mechanical rejections (source-defined conditions refusing the write) vs
  // availability failures (carrier/IO-level problems). Both are zero-write.
  const mechanicalCodes = new Set([
    "adr/frontmatter_invalid", "adr/body_invalid", "adr/coherence_invalid",
    "adr/relations_invalid", "adr/relation_target_unresolvable",
    "adr/initial_state_violation", "adr/status_transition_invalid", "adr/status_terminal",
    "adr/errata_boundary", "adr/cas_conflict", "adr/change_summary_required", "adr/invalid_uid",
    "invalid_request",
  ]);
  const outcome = mechanicalCodes.has(code) ? "rejected" : "unavailable";
  const issues = Array.isArray(failureResult.error.details?.issues) ? failureResult.error.details.issues : [];
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: "write", completed: [], not_completed: ["write"] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
    gaps: [`${code}: ${failureResult.error.message}`, ...issues],
    verification: { checks: [], passed: false },
    follow_up: code === "adr/cas_conflict"
      ? ["re-read the object (adr-read-object), reconcile the concurrent change, and retry with the fresh fingerprint"]
      : code === "adr/status_terminal"
        ? ["retired ADRs are read-only (22 §9.2); decision changes go through a NEW ADR + superseded-by"]
        : code === "adr/errata_boundary"
          ? ["decision/scope semantics changed — create a NEW ADR carrying the revision and retire this one via superseded-by (22 §9.3)"]
          : ["fix the reported mechanical issues and retry; zero write has occurred"]
  });
}

// ---------------------------------------------------------------------------
// Registration (same shape as spark-tools.js — mounted from
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
  if (result?.decision !== undefined) lines.push(`decision: ${result.decision}`);
  if (result?.scope !== undefined) lines.push(`scope: ${result.scope}`);
  if (result?.trigger_signal !== undefined) lines.push(`trigger_signal: ${result.trigger_signal}`);
  if (result?.retirement_reason !== undefined) lines.push(`retirement_reason: ${result.retirement_reason}`);
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
      lines.push(`- ${item.object_uid} [${item.status}] ${item.title}${item.trigger_signal ? ` (信号: ${item.trigger_signal})` : ""}`);
    }
  }
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${change.object_uid}`);
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  // Models mis-shape open objects when they see additionalProperties:true
  // with no declared properties — every ADR data object declares its
  // shape explicitly (mirrors 22 §8 field contract).
  const relationEntry = {
    type: "object",
    properties: {
      relation_key: { type: "string", enum: ["superseded-by"] },
      target: { type: "object", properties: { object_uid: { type: "string" } }, required: ["object_uid"], additionalProperties: false }
    },
    required: ["relation_key", "target"],
    additionalProperties: false
  };
  const adrFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 30 characters; decision-direction title for locating and Human scanning" },
      status: { type: "string", enum: ["active", "retired"], description: "create must be active; update may transition active→retired (terminal, read-only afterwards — 22 §9)" },
      decision: { type: "string", description: "single readable sentence (at most one terminal 。？！ ending the string); must appear verbatim in the 决定 body section" },
      scope: { type: "string", description: "applicability statement; must appear verbatim in the 适用范围 body section" },
      trigger_signal: { type: "string", description: "when to revisit this decision (e.g. 「当 X 出现时重审」); omit when no real signal exists (03 §6.1 — no placeholder fabrications)" },
      urls: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, title: { type: "string" }, summary: { type: "string" } }, required: ["ref"], additionalProperties: false }, description: "external evidence supporting the decision; when non-empty the body must carry a 证据 section" },
      relations: { type: "array", items: relationEntry, description: "superseded-by (cardinality 1); only on retired + retirement_reason=superseded, target must resolve to an existing ADR (22 §11)" },
      retirement_reason: { type: "string", enum: ["superseded", "outdated", "out-of-scope"], description: "required iff status=retired, forbidden while active (22 §9.2)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "decision", "scope"],
    additionalProperties: false
  };
  switch (operationKey) {
    case "adr-read-object":
      return {
        type: "object",
        properties: {
          object_uid: { type: "string", description: "Canonical object_uid of the ADR object to read" }
        },
        required: ["object_uid"],
        additionalProperties: false
      };
    case "adr-list-objects":
      return {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "all"], description: "active = default (current decision baseline, 22 §12); all = include retired for historical tracing" },
          limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
        },
        additionalProperties: false
      };
    case "adr-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"] },
          frontmatter_draft: adrFrontmatter,
          body_markdown: { type: "string", description: "create: the body markdown starting with '## 决策背景' (H2 sections 决策背景/决定/备选与理由/后果/适用范围, plus 证据 iff urls non-empty; the H1 is generated from title)" },
          object_uid: { type: "string", description: "update: target object" },
          expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
          frontmatter_after: (() => { const { required: _r, ...rest } = adrFrontmatter; return { ...rest, description: "update: the complete target frontmatter (all fields; schema required relaxed here — handler validates completeness via CAS+writer)" }; })(),
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

export function toolDescriptorFor(operationKey, operation, handler) {
  return {
    name: operation.toolName,
    description: operation.summary,
    parameters: parameterSchemaFor(operationKey),
    timeoutMs: 30000,
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

export function registerAdrTools(ctx, deps) {
  const handlers = {
    "adr-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "adr-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "adr-write-object": (args, exec) => executeWriteObject(args, exec, deps),
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
