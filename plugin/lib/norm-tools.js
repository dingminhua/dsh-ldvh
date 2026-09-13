// LDVH norm mechanical layer — runtime wiring.
//
// This module connects the Norm writer (norm-writer.js, specs/27 §11 +
// specs/03 §9) to the governed tool surface so the main controller can
// drive it from a live session:
//
//   - norm-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - norm-list-objects (effect: read)             — F0/F1 discovery:
//     dedup-relevant projection (title/direction_key/status), active-only
//     by default (27 §10: retired stays out of ordinary candidates).
//     Also carries uniqueness layer 3 (27 §11 item 3): on a direction
//     collision every colliding active Norm is WITHHELD and reported as
//     `direction_collision` (fail-closed, 01 §9.1) instead of being served.
//   - norm-write-object (effect: may_change_state) — controlled create
//     (after Human-confirmed proposal incl. dedup result) and CAS update
//     with change_log: active→active is 勘误/受控更新 with direction_key
//     held fixed (27 §13.2 mechanically decidable half), active→retired is
//     the terminal transition. Carries uniqueness layer 1 (27 §11 item 1):
//     ERR_DIRECTION_ALREADY_EXISTS before any write.
//
// Authorities: specs/05 §6 (operation declaration + common envelope), §9.3
// (may_change_state), specs/03 §9 (controlled read/create/update, write-back
// read-back), specs/27 §11/§13 (type-specific mechanical checks + the
// uniqueness three-layer contract), specs/27 §15 (Human Gate: creation and
// retirement are Human decisions — this tool is the mechanical carrier, not
// the decision).
//
// UNIQUENESS THREE-LAYER STATUS (27 §11): all three layers are now present —
//   1. pre-write refusal  — norm-writer.js / this module (ERR_DIRECTION_ALREADY_EXISTS)
//   2. Git Gate interception — commit-validation.js checkNormDirectionUniqueness,
//      driven by git-gate-runner.js collectNormCarriers (covers hand-edited and
//      shell-written carriers the writer never sees)
//   3. consumption fail-closed — the list handler withholds every colliding
//      active Norm and reports direction_collision
// The gate's carrier parser normalises CRLF before reading fields; without that
// a CRLF-checked-out carrier was silently skipped and layer 2 failed OPEN.
// Dedup semantic comparison (27 §6.2, 同义异名) remains AI work recorded in the
// creation proposal — the list tool only supplies the deterministic inputs.

import {
  createNormObject,
  readNormObject,
  updateNormObject,
  listNormObjects,
  ERR_DIRECTION_ALREADY_EXISTS,
} from "./norm-writer.js";
import { currentRouteValues } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "norm-read-object": {
    toolName: "ldvh_norm_read",
    summary: "Precise read of one Norm fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/03 §9.2, specs/27 §11)",
    effect: "read"
  },
  "norm-list-objects": {
    toolName: "ldvh_norm_list",
    summary: "Enumerate Norm fact objects (F0/F1 discovery): direction_key/title/status projection for the governed project; active-only by default; a collision on one direction_key withholds every colliding Norm and reports direction_collision (fail-closed, specs/27 §11 item 3 / §10)",
    effect: "read"
  },
  "norm-write-object": {
    toolName: "ldvh_norm_write",
    writeShaped: true,
    summary: "Controlled write of Norm fact objects: create (after Human-confirmed proposal incl. dedup result; requires a direction_key with no existing active Norm, else ERR_DIRECTION_ALREADY_EXISTS) and CAS update with change_log; active→active holds direction_key fixed (27 §13.2), active→retired is terminal (specs/03 §9.4–§9.5, specs/27 §11)",
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
  return { ok: true, value: authoritativeSignature({ provider: route.value.provider, model: route.value.model }) };
}

// ---------------------------------------------------------------------------
// norm-read-object / norm-list-objects / norm-write-object handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("norm-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "norm-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("norm-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readNormObject({ factSourceRoot, objectUid });
  if (!read.ok) {
    // Distinguish "not found / bad uid shape" (rejected) from carrier-level
    // defects (unavailable — the object exists but cannot be consumed).
    const rejectedCodes = new Set(["norm/invalid_uid", "norm/not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("norm-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "norms") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;
  return envelope("norm-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      direction_key: typeof fm.direction_key === "string" ? fm.direction_key : undefined,
      retirement_reason: typeof fm.retirement_reason === "string" ? fm.retirement_reason : undefined,
      retired_at: typeof fm.retired_at === "string" ? fm.retired_at : undefined,
      body_valid: value.body_valid,
      mechanical_issues: value.mechanical_issues,
      frontmatter: fm,
      body: value.body,
    },
    scope: { requested: objectUid, completed: [objectUid], not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see mechanical_issues)"] },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: value.mechanical_issues,
    verification: { checks: ["frontmatter-parse", "body-structure", "closed-set"], passed: value.mechanical_issues.length === 0 },
    follow_up: [
      "27 §6.2 dedup and 27 §13.2 管辖边界 comparison are AI semantic work over this content, not tool output",
      "norm-write-object action=update with the observed fingerprint when a controlled change is needed",
    ]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("norm-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object discovery serves governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const includeTerminal = args?.status === "all";
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listNormObjects({ factSourceRoot, status: includeTerminal ? "all" : "active", limit: args?.limit });
  if (!listed.ok) {
    return envelope("norm-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "norms") }],
      gaps: [`${listed.error.code}: ${listed.error.message}`],
      verification: { checks: ["directory-scan"], passed: false },
      follow_up: []
    });
  }
  const value = listed.value;
  const gaps = value.unreadable.map((entry) => `invalid carrier ${entry.file}: ${entry.reason}`);
  // Uniqueness layer 3 (27 §11 item 3): a direction collision is a DEFECT that
  // must surface, not a filter to hide behind — the colliding objects are
  // withheld from the ordinary result above and reported here.
  for (const collision of value.gaps) {
    gaps.push(`direction_collision on "${collision.direction_key}": ${collision.objects.length} active Norms share this direction_key — all withheld from the served set (27 §11 item 3 fail-closed); resolve by retiring one before consuming either`);
  }
  if (value.truncated) {
    gaps.push(`projection truncated at limit of ${value.items.length} of ${value.total} matching objects — narrow the filter or raise the limit; do not treat this page as the full set (03 §8.1)`);
  }
  return envelope("norm-list-objects", value.gaps.length > 0 ? "partial" : "completed", {
    result: {
      count: value.items.length,
      total: value.total,
      filter: includeTerminal ? "all" : "active",
      withheld_count: value.withheld_count,
      items: value.items,
      direction_collisions: value.gaps,
    },
    scope: {
      requested: "list",
      completed: ["list"],
      not_completed: value.gaps.length > 0 ? [`${value.withheld_count} Norm(s) withheld pending direction-collision resolution`] : [],
    },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "norms") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse", "direction-key-uniqueness"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (27 §6.2) is a semantic comparison over direction_key/title — performed by the AI on this projection, never by the tool",
      "norm-read-object for the F3 full content of any candidate",
    ]
  });
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update") {
    return invalidRequest("norm-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("norm-write-object", "unavailable", {
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
  // 03 §6.1 + 09 机械签名: a change_log entry is signed BY CODE and may not be
  // written unsigned. Without a branded carrier the write is REFUSED and
  // reported, rather than recorded as an unsigned stable fact.
  if (!sig.ok) {
    return envelope("norm-write-object", "unavailable", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`authoritative signature unavailable (${sig.reason}): refusing to write an unsigned change_log entry (specs/09)`],
      verification: { checks: ["session-signature"], passed: false },
      follow_up: ["report to Human: this write cannot be signed, so it must not be recorded as a stable fact"]
    });
  }

  if (action === "create") {
    const draft = args?.frontmatter_draft;
    const bodyMarkdown = args?.body_markdown;
    if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
      return invalidRequest("norm-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 方向定位与适用范围') are required for action=create", "create");
    }
    const created = await createNormObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.value,
    });
    if (!created.ok) {
      return writeRejected("norm-write-object", created, factSourceRoot, "create");
    }
    const readBack = await readNormObject({ factSourceRoot, objectUid: created.value.object_uid });
    return envelope("norm-write-object", "completed", {
      result: {
        action: "create",
        object_uid: created.value.object_uid,
        file: created.value.file,
        fingerprint: created.value.fingerprint,
        read_back: readBack.ok ? "ok" : `failed: ${readBack.error.message}`,
      },
      scope: { requested: "create", completed: ["create", "read-back"], not_completed: [] },
      sources: [{ kind: "fact-object", path: created.value.file, content_fingerprint: created.value.fingerprint }],
      gaps: readBack.ok ? [] : [readBack.error.message],
      verification: { checks: ["frontmatter-closed-set", "direction-key-format", "direction-key-uniqueness-layer-1", "body-skeleton", "write-read-back"], passed: readBack.ok },
      follow_up: [
        "27 §11 items 2–3 (Git Gate assertion, consumption fail-closed) are NOT both present in this build — do not report the direction_key uniqueness constraint as mechanically guaranteed",
        "norm-write-object action=update with the read-back fingerprint for further controlled change",
      ]
    });
  }

  const objectUid = args?.object_uid;
  const expectedFingerprint = args?.expected_fingerprint;
  const frontmatterAfter = args?.frontmatter_after;
  const bodyMarkdownAfter = args?.body_markdown_after;
  const changeSummary = args?.change_summary;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("norm-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("norm-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("norm-write-object", "change_summary is required for action=update (03 §9.5: exactly one change_log entry per actual modification)", "update");
  }
  const updated = await updateNormObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    bodyMarkdownAfter,
    changeSummary,
    sessionSignature: sig.value,
  });
  if (!updated.ok) {
    return writeRejected("norm-write-object", updated, factSourceRoot, "update");
  }
  const readBack = await readNormObject({ factSourceRoot, objectUid });
  return envelope("norm-write-object", "completed", {
    result: {
      action: "update",
      transition: updated.value.transition,
      object_uid: updated.value.object_uid,
      file: updated.value.file,
      fingerprint: updated.value.fingerprint,
      read_back: readBack.ok ? "ok" : `failed: ${readBack.error.message}`,
    },
    scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: updated.value.file, content_fingerprint: updated.value.fingerprint }],
    gaps: readBack.ok ? [] : [readBack.error.message],
    verification: { checks: ["cas-fingerprint", "transition-legality", "closed-set", "body-skeleton", "write-read-back"], passed: readBack.ok },
    follow_up: [
      updated.value.transition === "retire"
        ? "retired is the only terminal state and is read-only afterwards (27 §8.1) — restarting the direction requires a NEW Norm with a new object_uid (direction_key may be reused)"
        : "27 §13.2: the mechanically checked half is direction_key stability; whether the 方向定位与适用范围 管辖边界 changed materially is AI/Human semantic scope and is NOT mechanically enforced here",
    ]
  });
}

/**
 * Map a writer failure onto the 05 §8 envelope. The uniqueness refusal has its
 * own spec-mandated code (27 §11 item 1) and is a REJECTION of the request, not
 * an unavailable capability — the tool works, the direction is already taken.
 */
function writeRejected(operationKey, result, factSourceRoot, action) {
  const code = result.error.code;
  const isRejection = code === ERR_DIRECTION_ALREADY_EXISTS
    || code.startsWith("norm/frontmatter")
    || code.startsWith("norm/body")
    || code.startsWith("norm/coherence")
    || code.startsWith("norm/relations")
    || code.startsWith("norm/fingerprint")
    || code === "norm/transition_invalid"
    || code === "norm/terminal_readonly"
    || code === "norm/direction_key_immutable"
    || code === "norm/initial_state_violation"
    || code === "norm/superseded_unresolvable"
    || code === "norm/invalid_uid"
    || code === "norm/not_found"
    || code === "invalid_request"
    || code === "norm/change_summary_required";
  const outcome = isRejection ? "rejected" : "unavailable";
  const details = result.error.details?.issues ?? result.error.details ?? {};
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: action, completed: [], not_completed: [action] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "norms") }],
    gaps: [`${code}: ${result.error.message}`, ...(Array.isArray(details) ? details : [])],
    verification: { checks: ["mechanical-checks"], passed: false },
    follow_up: code === ERR_DIRECTION_ALREADY_EXISTS
      ? ["the direction is already carried by another active Norm — take the controlled-update path on that object, or retire it and create a new one (27 §11)"]
      : []
  });
}

// ---------------------------------------------------------------------------
// Rendering (05 §8 human-readable envelope)
// ---------------------------------------------------------------------------

/**
 * The single choke point for tool output (the `text()` idiom ldvh-tools.js
 * uses for all of its tools).
 *
 * output.render MUST return an ARRAY of content blocks. dsh-tools feeds the
 * return through `result.content.some((block) => block.type === "image")`, so
 * a bare string throws `content.some is not a function` and the result never
 * reaches the model — a silent total failure of every Norm tool call that no
 * handler-level test can catch.
 */
function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? value ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  if (env.result) lines.push(JSON.stringify(env.result, null, 2));
  if (Array.isArray(env.gaps) && env.gaps.length > 0) {
    // Gaps may be structured records (05 §8 traceability), so stringify them
    // rather than interpolating them as [object Object].
    lines.push("gaps:", ...env.gaps.map((gap) => `  - ${typeof gap === "string" ? gap : JSON.stringify(gap)}`));
  }
  if (Array.isArray(env.follow_up) && env.follow_up.length > 0) {
    lines.push("follow-up:", ...env.follow_up.map((item) => `  - ${typeof item === "string" ? item : JSON.stringify(item)}`));
  }
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  // Every Norm data object declares its shape explicitly (mirrors 27 §8 field
  // contract) — models mis-shape objects when additionalProperties:true is
  // shown with no declared properties.
  const normFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/retired_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 40 characters; direction-spec short title for locating and Human scanning (27 §8)" },
      status: { type: "string", enum: ["active", "retired"], description: "create must be active (27 §8.1 — the only legal initial state); update may transition active→retired (terminal, read-only afterwards)" },
      direction_key: { type: "string", description: "lowercase kebab-case direction key matching ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$ (01.Att.02 §2 identifier format); at most one ACTIVE Norm per direction_key (27 §11). Immutable across updates — direction drift is a retire+create path, not an update" },
      retirement_reason: { type: "string", enum: ["superseded", "outdated", "out-of-scope"], description: "required iff status=retired, forbidden while active (27 §8/§8.1)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "direction_key"],
    additionalProperties: false
  };
  const normFrontmatterAfter = (() => {
    const { required: _r, ...rest } = normFrontmatter;
    return { ...rest, description: "update: the complete target frontmatter (all fields; schema required relaxed here — handler validates completeness via CAS+writer)" };
  })();

  if (operationKey === "norm-read-object") {
    return {
      type: "object",
      properties: { object_uid: { type: "string", description: "Canonical object_uid of the Norm object to read" } },
      required: ["object_uid"],
      additionalProperties: false
    };
  }
  if (operationKey === "norm-list-objects") {
    return {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "all"], description: "active = default (current effective rule set, 27 §10); all = include retired for historical tracing" },
        limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
      },
      additionalProperties: false
    };
  }
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "update"], description: "create: new Norm in status=active (Human decision required, 27 §15); update: CAS write against an existing object" },
      frontmatter_draft: normFrontmatter,
      body_markdown: { type: "string", description: "create: the body markdown starting with '## 方向定位与适用范围' (H2 sections 方向定位与适用范围/核心规则体系/约束与反模式/验证与遵从性检查, all four required and non-empty; the H1 is generated from title)" },
      object_uid: { type: "string", description: "update: target object" },
      expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
      frontmatter_after: normFrontmatterAfter,
      body_markdown_after: { type: "string", description: "update: the complete target body markdown (same shape as body_markdown, INCLUDING the H1 line — pass back what a precise read returned)" },
      change_summary: { type: "string", description: "update: one short semantic summary for the change_log entry" }
    },
    required: ["action"],
    additionalProperties: false
  };
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

export function registerNormTools(ctx, deps) {
  const handlers = {
    "norm-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "norm-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "norm-write-object": (args, exec) => executeWriteObject(args, exec, deps),
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
