// LDVH pitfall mechanical layer — runtime wiring.
//
// This module connects the Pitfall writer (pitfall-writer.js, specs/23 §13 +
// specs/03 §9) to the governed tool surface so the main controller can
// drive it from a live session:
//
//   - pitfall-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - pitfall-list-objects (effect: read)             — F0/F1 discovery:
//     dedup/precheck-relevant projection (title/scope/status/trigger_signal),
//     active-only by default (23 §12: discarded stays out of ordinary
//     candidates).
//   - pitfall-write-object (effect: may_change_state) — controlled create
//     (after Human-confirmed proposal incl. dedup result) and CAS update
//     with change_log: active→active is errata/supplement-only (scope
//     field-identical, 23 §9.3), active→discarded is terminal.
//
// Authorities: specs/05 §6 (operation declaration + common envelope),
// §9.3 (may_change_state), specs/03 §9 (controlled read/create/update,
// write-back read-back), specs/23 §13 (type-specific mechanical checks).
// Dedup semantic comparison (23 §6.2) is AI work recorded in the creation
// proposal — the list tool only supplies the deterministic inputs.

import {
  createPitfallObject,
  readPitfallObject,
  updatePitfallObject,
  listPitfallObjects,
} from "./pitfall-writer.js";
import { currentRouteValues } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "pitfall-read-object": {
    toolName: "ldvh_pitfall_read",
    summary: "Precise read of one Pitfall fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/03 §9.2, specs/23 §13)",
    effect: "read"
  },
  "pitfall-list-objects": {
    toolName: "ldvh_pitfall_list",
    summary: "Enumerate Pitfall fact objects (F0/F1 discovery): dedup/precheck-relevant projection (title/scope/status/trigger_signal) for the governed project; active-only by default (specs/03 §8, specs/23 §12)",
    effect: "read"
  },
  "pitfall-write-object": {
    toolName: "ldvh_pitfall_write",
    writeShaped: true,
    summary: "Controlled write of Pitfall fact objects: create (after Human-confirmed proposal incl. dedup result) and CAS update with change_log; active→active is errata/supplement-only (scope field-identical, 23 §9.3), active→discarded is terminal (specs/03 §9.4–§9.5, specs/23 §13)",
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
// pitfall-read-object / pitfall-list-objects / pitfall-write-object handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("pitfall-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "pitfall-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("pitfall-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readPitfallObject({ factSourceRoot, objectUid });
  if (!read.ok) {
    // Distinguish "not found / bad uid shape" (rejected) from carrier-level
    // defects (unavailable — the object exists but cannot be consumed).
    const rejectedCodes = new Set(["pitfall/invalid_uid", "pitfall/object_not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("pitfall-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "pitfalls") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;
  return envelope("pitfall-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      scope: typeof fm.scope === "string" ? fm.scope : undefined,
      trigger_signal: typeof fm.trigger_signal === "string" ? fm.trigger_signal : undefined,
      disposition: typeof fm.disposition === "string" ? fm.disposition : undefined,
      body_valid: value.body_valid,
      body_issues: value.body_issues,
      frontmatter: fm,
      body: value.body,
    },
    scope: { requested: objectUid, completed: [objectUid], not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see body_issues)"] },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: value.body_valid ? [] : value.body_issues,
    verification: { checks: ["frontmatter-parse", "body-structure"], passed: value.body_valid },
    follow_up: ["pitfall-write-object action=update with the observed fingerprint when a controlled change is needed"]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("pitfall-list-objects", "unavailable", {
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
  const listed = await listPitfallObjects({ factSourceRoot, includeTerminal, limit });
  if (!listed.ok) {
    return envelope("pitfall-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "pitfalls") }],
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
  return envelope("pitfall-list-objects", value.complete ? "completed" : "partial", {
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
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "pitfalls") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (23 §6.2) is a semantic comparison over title/symptoms/root-cause — performed by the AI on this projection, never by the tool",
      "pitfall-read-object for the F3 full content of any candidate",
    ]
  });
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update") {
    return invalidRequest("pitfall-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("pitfall-write-object", "unavailable", {
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
      return invalidRequest("pitfall-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 症状') are required for action=create", "create");
    }
    const created = await createPitfallObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.ok ? authoritativeSignature(sig.value) : null,
    });
    if (!created.ok) {
      return writeRejected("pitfall-write-object", created, factSourceRoot);
    }
    // 03 §9.4 item 5: precise read-back of the current file after create.
    const readBack = await readPitfallObject({ factSourceRoot, objectUid: created.value.object_uid });
    if (!readBack.ok || readBack.value.fingerprint !== created.value.fingerprint) {
      return envelope("pitfall-write-object", "partial", {
        result: { object_uid: created.value.object_uid, file: created.value.file, fingerprint: created.value.fingerprint, read_back: "failed" },
        scope: { requested: "create", completed: ["create"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
        sources: [{ kind: "fact-object", path: created.value.file }],
        gaps: [`created but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
        verification: { checks: ["create"], passed: false },
        follow_up: ["STOP further writes and success claims (03 §9.4 item 7); re-read and verify the file state before anything else"]
      });
    }
    return envelope("pitfall-write-object", "completed", {
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
      verification: { checks: ["frontmatter-closed-set", "body-structure", "carrier-coherence", "atomic-write", "read-back"], passed: true },
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
    return invalidRequest("pitfall-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("pitfall-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("pitfall-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("pitfall-write-object", "change_summary (one short semantic summary for the change_log) is required for action=update", "update");
  }
  const updated = await updatePitfallObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    bodyMarkdownAfter,
    changeSummary,
    sessionSignature: sig.ok ? sig.value : null,
  });
  if (!updated.ok) {
    return writeRejected("pitfall-write-object", updated, factSourceRoot);
  }
  const readBack = await readPitfallObject({ factSourceRoot, objectUid });
  if (!readBack.ok || readBack.value.fingerprint !== updated.value.fingerprint) {
    return envelope("pitfall-write-object", "partial", {
      result: { object_uid: objectUid, fingerprint: updated.value.fingerprint, read_back: "failed" },
      scope: { requested: "update", completed: ["update"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "pitfalls") }],
      gaps: [`updated but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
      verification: { checks: ["update"], passed: false },
      follow_up: ["STOP further writes and success claims (03 §9.7); re-read the object before anything else"]
    });
  }
  return envelope("pitfall-write-object", "completed", {
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
    verification: { checks: ["cas-baseline", "frontmatter-closed-set", "body-structure", "carrier-coherence", "supplement-boundary", "terminal-state-guard", "atomic-write", "read-back"], passed: true },
    follow_up: ["use the NEW fingerprint from this result for the next update; committing goes through the controlled-commit contract (specs/06)"]
  });
}

function writeRejected(operationKey, failureResult, factSourceRoot) {
  const code = failureResult.error.code;
  // Mechanical rejections (source-defined conditions refusing the write) vs
  // availability failures (carrier/IO-level problems). Both are zero-write.
  const mechanicalCodes = new Set([
    "pitfall/frontmatter_invalid", "pitfall/body_invalid", "pitfall/coherence_invalid",
    "pitfall/initial_state_violation", "pitfall/status_transition_invalid", "pitfall/status_terminal",
    "pitfall/supplement_boundary", "pitfall/cas_conflict", "pitfall/change_summary_required", "pitfall/invalid_uid",
    "invalid_request",
  ]);
  const outcome = mechanicalCodes.has(code) ? "rejected" : "unavailable";
  const issues = Array.isArray(failureResult.error.details?.issues) ? failureResult.error.details.issues : [];
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: "write", completed: [], not_completed: ["write"] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "pitfalls") }],
    gaps: [`${code}: ${failureResult.error.message}`, ...issues],
    verification: { checks: [], passed: false },
    follow_up: code === "pitfall/cas_conflict"
      ? ["re-read the object (pitfall-read-object), reconcile the concurrent change, and retry with the fresh fingerprint"]
      : code === "pitfall/status_terminal"
        ? ["discarded Pitfalls are read-only (23 §9.2); a substantively changed mechanism goes through a NEW Pitfall object"]
        : code === "pitfall/supplement_boundary"
          ? ["scope changed — create a NEW Pitfall object for the different impact range (23 §9.3)"]
          : ["fix the reported mechanical issues and retry; zero write has occurred"]
  });
}

// ---------------------------------------------------------------------------
// Registration (same shape as adr-tools.js — mounted from
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
  if (result?.scope !== undefined) lines.push(`scope: ${result.scope}`);
  if (result?.trigger_signal !== undefined) lines.push(`trigger_signal: ${result.trigger_signal}`);
  if (result?.disposition !== undefined) lines.push(`disposition: ${result.disposition}`);
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
  // with no declared properties — every Pitfall data object declares its
  // shape explicitly (mirrors 23 §8 field contract).
  const pitfallFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 30 characters; failure-mechanism short title (highlight the platform when environment-specific)" },
      status: { type: "string", enum: ["active", "discarded"], description: "create must be active; update may transition active→discarded (terminal, read-only afterwards — 23 §9)" },
      scope: { type: "string", description: "impact & applicability statement; must appear verbatim in the 影响与适用范围 body section" },
      trigger_signal: { type: "string", description: "when to re-examine this experience (dependency version change, environment migration, etc.); omit when no real signal exists (03 §6.1 — no placeholder fabrications)" },
      urls: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, title: { type: "string" }, summary: { type: "string" } }, required: ["ref"], additionalProperties: false }, description: "external evidence supporting the experience; when non-empty the body must carry a 证据 section" },
      disposition: { type: "string", description: "terminal destination & reason; required iff status=discarded, forbidden while active (23 §8)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "scope"],
    additionalProperties: false
  };
  switch (operationKey) {
    case "pitfall-read-object":
      return {
        type: "object",
        properties: {
          object_uid: { type: "string", description: "Canonical object_uid of the Pitfall object to read" }
        },
        required: ["object_uid"],
        additionalProperties: false
      };
    case "pitfall-list-objects":
      return {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "all"], description: "active = default (current experience baseline, 23 §12); all = include discarded for historical tracing" },
          limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
        },
        additionalProperties: false
      };
    case "pitfall-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"] },
          frontmatter_draft: pitfallFrontmatter,
          body_markdown: { type: "string", description: "create: the body markdown starting with '## 症状' (H2 sections 症状/触发条件/根因/解决/规避/验证/影响与适用范围, plus 证据 iff urls non-empty; the H1 is generated from title)" },
          object_uid: { type: "string", description: "update: target object" },
          expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
          frontmatter_after: (() => { const { required: _r, ...rest } = pitfallFrontmatter; return { ...rest, description: "update: the complete target frontmatter (all fields; schema required relaxed here — handler validates completeness via CAS+writer)" }; })(),
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

export function registerPitfallTools(ctx, deps) {
  const handlers = {
    "pitfall-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "pitfall-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "pitfall-write-object": (args, exec) => executeWriteObject(args, exec, deps),
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
