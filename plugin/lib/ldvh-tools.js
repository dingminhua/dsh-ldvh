// LDVH first DSH-native tool batch (P0).
//
// Authorities: specs/05 (operation declaration shape, common request/response
// semantics, availability discovery), specs/01 §10.3–10.4 (specification
// reading entry points and minimal guidance anchors), specs/06 §6.2
// (precheck-git-commit), specs/07 (governance three-state). Every tool
// embeds its 05 §6.1 operation declaration for discover-ldvh-capabilities;
// every response follows the 05 §8 common envelope (operation_key, result,
// scope, sources, gaps, verification, follow_up) with a distinguishable
// outcome (partial/unavailable/rejected/invalid_request vs execution error).
//
// Tool names carry an ldvh_ prefix to live in the DSH tool namespace;
// operation_keys stay prefix-free (05 semantic identity — the DSH tool name
// and the operation_key are deliberately different names, 05 §5.2 item 1).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseSpecDocument, extractHeadings, resolveHeadingPath, contentFingerprint, projectLayer } from "./spec-registry.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { currentRouteValues } from "./session-signature.js";
import { validateMessage, checkKeyChangesAgainstDiff, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment, newFinding } from "./commit-validation.js";
import { registerSubagentResultTool } from "./subagent-result.js";
import { registerResearchTools } from "./research-tools.js";
import { registerSparkTools } from "./spark-tools.js";
import { registerAdrTools } from "./adr-tools.js";

const execFileAsync = promisify(execFile);

const OPERATIONS = {
  "resolve-governance-scope": {
    toolName: "ldvh_resolve_governance_scope",
    summary: "Resolve the LDVH governance state (governed/not_governed/unavailable) for the current session working directory",
    effect: "read"
  },
  "read-specification-candidates": {
    toolName: "ldvh_read_specification_candidates",
    summary: "Read specification/attachment candidates at L0–L2 disclosure layers by responsibility key or all candidates (specs/01 §10.3)",
    effect: "read"
  },
  "read-specification-content": {
    toolName: "ldvh_read_specification_content",
    summary: "Read one specification/attachment at L3 (exact heading path) or L4 (full source) with fingerprint and scope disclosure",
    effect: "read"
  },
  "discover-ldvh-capabilities": {
    toolName: "ldvh_discover_capabilities",
    summary: "Discover LDVH public operations with declared/implemented/callable availability (specs/05 §6.2)",
    effect: "read"
  },
  "precheck-git-commit": {
    toolName: "ldvh_precheck_git_commit",
    summary: "Run the read-only mechanical precheck over a controlled-commit candidate message and the current staged Index (specs/06 §6.2)",
    effect: "read"
  }
};

function envelope(operationKey, outcome, fields) {
  return {
    operation_key: operationKey,
    outcome,
    ...fields
  };
}

function sources(entry) {
  return [entry];
}

/** Scan the specs/ tree of a governed project root for candidate carriers. */
async function scanSpecCandidates(projectRoot) {
  const specsRoot = join(projectRoot, "specs");
  let entries;
  try {
    entries = await readdir(specsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, reason: "specs/ directory not found in the governed project" };
    return { ok: false, reason: String(error?.message ?? error) };
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (/^[0-9]{2,}-[^/]+\.md$/.test(entry.name)) files.push(`specs/${entry.name}`);
  }
  const attachmentsRoot = join(specsRoot, "attachments");
  try {
    const attachments = await readdir(attachmentsRoot, { withFileTypes: true });
    for (const entry of attachments) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      if (/^[0-9]{2,}\.Att\.[0-9]{2,}-[^/]+\.md$/.test(entry.name)) files.push(`specs/attachments/${entry.name}`);
    }
  } catch {
    /* no attachments directory — not an error */
  }
  const members = [];
  const gaps = [];
  for (const repoPath of files.sort()) {
    let text;
    try {
      text = await readFile(join(projectRoot, repoPath), "utf8");
    } catch (error) {
      gaps.push({ responsibility_key: null, canonical_path: repoPath, reason: `unreadable: ${String(error?.message ?? error)}` });
      continue;
    }
    const parsed = parseSpecDocument(text, repoPath);
    if (!parsed.ok) {
      gaps.push({ responsibility_key: null, canonical_path: repoPath, reason: `${parsed.error.code}: ${parsed.error.message}` });
      continue;
    }
    members.push({ identity: parsed.value.identity, markdownText: text, repoPath });
  }
  return { ok: true, members, gaps };
}

function makeExecute(deps) {
  const { dshHomePath } = deps;

  async function executeResolveGovernanceScope(args, exec) {
    const cwd = exec?.agent?.session?.header?.cwd;
    const scope = await resolveGovernanceScope(dshHomePath, cwd);
    return envelope("resolve-governance-scope", "completed", {
      result: { state: scope.state, ...(scope.project !== undefined ? { project: scope.project } : {}), ...(scope.detail !== undefined ? { detail: scope.detail } : {}) },
      scope: { requested: cwd ?? null, completed: cwd !== undefined, not_completed: cwd === undefined ? ["session working directory"] : [] },
      sources: sources({ kind: "registration", path: "ldvh/governed-projects.yaml", fingerprint: scope.registrationFingerprint ?? null }),
      gaps: [],
      verification: { checks: ["registration-read", "cwd-realpath", "root-containment"], passed: true },
      follow_up: scope.state === "governed" ? ["read-specification-candidates", "discover-ldvh-capabilities"] : []
    });
  }

  async function executeReadSpecificationCandidates(args, exec) {
    const layer = args?.layer === "L1" || args?.layer === "L2" ? args.layer : "L0";
    const requestedKey = typeof args?.responsibility_key === "string" && args.responsibility_key.length > 0 ? args.responsibility_key : null;
    const governed = await resolveGovernanceScope(dshHomePath, exec?.agent?.session?.header?.cwd);
    if (governed.state !== "governed") {
      return envelope("read-specification-candidates", "unavailable", {
        result: null,
        scope: { requested: requestedKey ?? "all", completed: [], not_completed: [requestedKey ?? "all"] },
        sources: [],
        gaps: [`governance state is ${governed.state}: specification reading serves governed sessions only`],
        verification: { checks: ["governance-scope"], passed: false },
        follow_up: []
      });
    }
    const scan = await scanSpecCandidates(governed.project.path);
    if (!scan.ok) {
      return envelope("read-specification-candidates", "unavailable", {
        result: null,
        scope: { requested: requestedKey ?? "all", completed: [], not_completed: [requestedKey ?? "all"] },
        sources: [],
        gaps: [scan.reason],
        verification: { checks: ["specs-scan"], passed: false },
        follow_up: []
      });
    }
    const selected = requestedKey === null ? scan.members : scan.members.filter((member) => member.identity.responsibilityKey === requestedKey);
    if (requestedKey !== null && selected.length === 0) {
      return envelope("read-specification-candidates", "rejected", {
        result: null,
        scope: { requested: requestedKey, completed: [], not_completed: [requestedKey] },
        sources: sources({ kind: "governed-project", path: governed.project.path }),
        gaps: [`no candidate carries responsibility_key "${requestedKey}"`],
        verification: { checks: ["key-lookup"], passed: false },
        follow_up: ["read-specification-candidates (no responsibility_key, to enumerate)"]
      });
    }
    const candidates = selected.map((member) => {
      const outline = layer === "L2" ? extractHeadings(member.markdownText).map((h) => ({ level: h.level, text: h.text, line: h.line })) : undefined;
      return projectLayer(member.identity, layer, outline);
    });
    return envelope("read-specification-candidates", "completed", {
      result: { layer, candidates },
      scope: { requested: requestedKey ?? "all", completed: selected.map((m) => m.identity.responsibilityKey), not_completed: [] },
      sources: sources({ kind: "governed-project", path: governed.project.path, scan: "specs/" }),
      gaps: scan.gaps,
      verification: { checks: ["identity-parse", "layer-projection"], passed: true },
      follow_up: ["read-specification-content for L3/L4 of any candidate"]
    });
  }

  async function executeReadSpecificationContent(args, exec) {
    const key = args?.responsibility_key;
    if (typeof key !== "string" || key.length === 0) {
      return envelope("read-specification-content", "invalid_request", {
        result: null, scope: { requested: null, completed: [], not_completed: ["responsibility_key"] }, sources: [],
        gaps: ["responsibility_key is required (the target spec_key or attachment_key, verbatim)"],
        verification: { checks: [], passed: false }, follow_up: []
      });
    }
    const headingPath = typeof args?.heading_path === "string" && args.heading_path.length > 0 ? args.heading_path : null;
    const governed = await resolveGovernanceScope(dshHomePath, exec?.agent?.session?.header?.cwd);
    if (governed.state !== "governed") {
      return envelope("read-specification-content", "unavailable", {
        result: null, scope: { requested: key, completed: [], not_completed: [key] }, sources: [],
        gaps: [`governance state is ${governed.state}`],
        verification: { checks: ["governance-scope"], passed: false }, follow_up: []
      });
    }
    const scan = await scanSpecCandidates(governed.project.path);
    if (!scan.ok) {
      return envelope("read-specification-content", "unavailable", {
        result: null, scope: { requested: key, completed: [], not_completed: [key] }, sources: [], gaps: [scan.reason],
        verification: { checks: ["specs-scan"], passed: false }, follow_up: []
      });
    }
    const member = scan.members.find((m) => m.identity.responsibilityKey === key);
    if (member === undefined) {
      return envelope("read-specification-content", "rejected", {
        result: null, scope: { requested: key, completed: [], not_completed: [key] },
        sources: sources({ kind: "governed-project", path: governed.project.path }),
        gaps: [`no member candidate carries responsibility_key "${key}"`],
        verification: { checks: ["key-lookup"], passed: false },
        follow_up: ["read-specification-candidates to enumerate keys"]
      });
    }
    const fingerprint = contentFingerprint(member.markdownText);
    if (headingPath === null) {
      // L4: full source.
      return envelope("read-specification-content", "completed", {
        result: { layer: "L4", responsibility_key: key, canonical_path: member.repoPath, content_fingerprint: fingerprint, content: member.markdownText },
        scope: { requested: key, completed: [key], not_completed: [] },
        sources: sources({ kind: "governed-project", path: join(governed.project.path, member.repoPath), content_fingerprint: fingerprint }),
        gaps: scan.gaps,
        verification: { checks: ["identity-parse", "full-read"], passed: true },
        follow_up: []
      });
    }
    const resolved = resolveHeadingPath(member.markdownText, headingPath);
    if (!resolved.ok) {
      return envelope("read-specification-content", "rejected", {
        result: null, scope: { requested: `${key} ${headingPath}`, completed: [], not_completed: [key] },
        sources: sources({ kind: "governed-project", path: join(governed.project.path, member.repoPath) }),
        gaps: [`${resolved.error.code}: ${resolved.error.message}`],
        verification: { checks: ["heading-path-resolution"], passed: false },
        follow_up: ["read-specification-candidates at L2 for the section outline"]
      });
    }
    const lines = member.markdownText.split("\n");
    const slice = lines.slice(resolved.value.startLine - 1, resolved.value.endLine).join("\n");
    return envelope("read-specification-content", "completed", {
      result: {
        layer: "L3",
        responsibility_key: key,
        heading_path: headingPath,
        start_line: resolved.value.startLine,
        end_line: resolved.value.endLine,
        canonical_path: member.repoPath,
        content_fingerprint: contentFingerprint(member.markdownText),
        section_fingerprint: contentFingerprint(slice),
        content: slice
      },
      scope: { requested: `${key} ${headingPath}`, completed: [`${key} ${headingPath}`], not_completed: [] },
      sources: sources({ kind: "governed-project", path: join(governed.project.path, member.repoPath), lines: [resolved.value.startLine, resolved.value.endLine] }),
      gaps: scan.gaps,
      verification: { checks: ["identity-parse", "heading-uniqueness"], passed: true },
      follow_up: ["read-specification-content without heading_path for L4 full source"]
    });
  }

  async function executeDiscoverCapabilities(args, exec) {
    const requestedOperation = typeof args?.operation_key === "string" && args.operation_key.length > 0 ? args.operation_key : null;
    const governed = await resolveGovernanceScope(dshHomePath, exec?.agent?.session?.header?.cwd);
    const entries = Object.entries(OPERATIONS)
      .filter(([key]) => requestedOperation === null || key === requestedOperation)
      .map(([key, operation]) => {
        const declared = true; // declared in this tool batch per 05 §6.1 shape
        const implemented = true; // an implementation is locatable in this plugin
        // discover itself is only registered for governed sessions (index.js
        // gate), so `governed.state` is "governed" whenever this runs. A
        // `|| key === "resolve-governance-scope"` branch used to sit here but
        // was unreachable dead code: under the not_governed-default model
        // (unavailable is a not_governed special case), NO operation is
        // callable outside governed sessions — including the scope resolver.
        const callableHere = governed.state === "governed";
        return {
          operation_key: key,
          dsh_tool_name: operation.toolName,
          summary: operation.summary,
          effect: operation.effect,
          availability: declared && implemented ? (callableHere ? "当次可调用" : "不可用") : "已声明",
          availability_detail: callableHere ? null : `session governance state is ${governed.state}; this operation serves governed sessions`
        };
      });
    if (requestedOperation !== null && entries.length === 0) {
      return envelope("discover-ldvh-capabilities", "rejected", {
        result: null,
        scope: { requested: requestedOperation, completed: [], not_completed: [requestedOperation] },
        sources: [],
        gaps: [`no public operation declares operation_key "${requestedOperation}"`],
        verification: { checks: ["declaration-lookup"], passed: false },
        follow_up: ["discover-ldvh-capabilities without operation_key to enumerate"]
      });
    }
    return envelope("discover-ldvh-capabilities", "completed", {
      result: { operations: entries },
      scope: { requested: requestedOperation ?? "all", completed: entries.map((e) => e.operation_key), not_completed: [] },
      sources: sources({ kind: "tool-batch", module: "plugin/lib/ldvh-tools.js" }),
      gaps: governed.state === "unavailable" ? [`governance registration unavailable: ${governed.detail}`] : [],
      verification: { checks: ["declaration-table", "governance-scope"], passed: true },
      follow_up: []
    });
  }

  async function executePrecheckGitCommit(args, exec) {
    const message = args?.message;
    if (typeof message !== "string" || message.length === 0) {
      return envelope("precheck-git-commit", "invalid_request", {
        result: null,
        scope: { requested: "precheck", completed: [], not_completed: ["message"] },
        sources: [],
        gaps: ["message (the full candidate commit message text) is required"],
        verification: { checks: [], passed: false },
        follow_up: []
      });
    }
    const governed = await resolveGovernanceScope(dshHomePath, exec?.agent?.session?.header?.cwd);
    if (governed.state !== "governed") {
      return envelope("precheck-git-commit", "unavailable", {
        result: { mechanical_outcome: "unverifiable" },
        scope: { requested: "precheck", completed: [], not_completed: ["precheck"] },
        sources: [],
        gaps: [`governance state is ${governed.state}: the controlled-commit contract serves governed repositories`],
        verification: { checks: ["governance-scope"], passed: false },
        follow_up: []
      });
    }
    // Staged diff over the governed project root.
    let diff;
    try {
      const result = await execFileAsync("git", ["-C", governed.project.path, "diff", "--cached", "--binary", "--no-ext-diff"], { encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: cleanGitEnvironment() });
      diff = result.stdout;
    } catch (error) {
      return envelope("precheck-git-commit", "unavailable", {
        result: { mechanical_outcome: "unverifiable" },
        scope: { requested: "precheck", completed: [], not_completed: ["staged-diff"] },
        sources: [],
        gaps: [`staged Index unreadable: ${String(error?.message ?? error)}`],
        verification: { checks: ["staged-diff"], passed: false },
        follow_up: []
      });
    }
    const issues = [...validateMessage(message)];
    if (diff.length === 0) issues.push(newFinding("git/index_empty", "candidate Index is empty"));
    const correspondence = checkKeyChangesAgainstDiff(message, diff);
    if (!correspondence.ok) issues.push(...correspondence.issues);
    // Signature values must trace back to the authoritative session record.
    const route = await currentRouteValues(deps.sessionPersistence?.(), exec?.agent);
    const signatureCheck = checkSignatureAgainstRoute(message, route);
    if (!signatureCheck.ok) issues.push(...signatureCheck.issues);
    // 06 §6.2 item 4 has two sub-conditions: (a) both trailer lines are
    // structurally complete — decidable without any routing source; (b) the
    // values trace back to the authoritative session record — decidable
    // only when the routing source is available. Outcome classification:
    //   passed        — every check passed, including (a) AND (b);
    //   failed        — positive failure evidence exists: any non-signature
    //                   issue, a structural trailer defect, or a value
    //                   MISMATCH against an available authoritative source;
    //   unverifiable  — no positive failure, but the signature values cannot
    //                   be traced (routing source unavailable): the check is
    //                   incomplete, not failed.
    const structuralTrailerOk = message.includes("LDVH-Provider:") && message.includes("LDVH-Model:") && validateMessage(message).every((issue) => issue.rule !== "validation/signature_trailer_missing");
    const hasValueMismatch = signatureCheck.issues.length > 0;
    const hasNonSignatureFailure = issues.some((issue) => !issue.rule.startsWith("validation/signature_"));
    let mechanicalOutcome;
    if (hasNonSignatureFailure || !structuralTrailerOk || hasValueMismatch) mechanicalOutcome = "failed";
    else if (!route.ok) mechanicalOutcome = "unverifiable";
    else mechanicalOutcome = "passed";
    const result = {
      mechanical_outcome: mechanicalOutcome,
      issues,
      ...(mechanicalOutcome === "passed" ? { snapshot_identity: snapshotIdentity(diff, message), source_fingerprint: SOURCE_FINGERPRINT } : {}),
      signature_source: route.ok ? { provider: route.value.provider, model: route.value.model, event_type: route.value.eventType } : { unavailable_reason: route.reason ?? "session identity unavailable" }
    };
    return envelope("precheck-git-commit", "completed", {
      result,
      scope: { requested: "precheck", completed: ["header", "key-changes", "diff-correspondence", "trailers", "signature-source"], not_completed: route.ok ? [] : ["signature-traceability"] },
      sources: [
        { kind: "governed-project", path: governed.project.path },
        ...(route.ok ? [{ kind: "session-routing-record", event_type: route.value.eventType, provider: route.value.provider, model: route.value.model }] : [])
      ],
      gaps: route.ok ? [] : [`provider/model could not be traced to the authoritative session record: ${route.reason ?? "session identity unavailable"}`],
      verification: { checks: ["header", "key_changes", "diff_correspondence", "trailers", "signature_traceability"], passed: issues.length === 0 },
      follow_up: mechanicalOutcome === "passed" ? ["commit; then verify the Git Gate stderr snapshot_identity equals this result's snapshot_identity"] : ["fix the reported issues and re-run precheck"]
    });
  }

  function checkSignatureAgainstRoute(message, route) {
    const lines = message.replace(/\r\n/g, "\n").split("\n");
    const providerLine = lines.find((line) => line.startsWith("LDVH-Provider:"));
    const modelLine = lines.find((line) => line.startsWith("LDVH-Model:"));
    if (!route.ok) {
      // No authoritative record: the trailer can exist, but traceability is
      // unverifiable — mechanical outcome is unverifiable, not failed.
      return { ok: false, hardFail: false, issues: [] };
    }
    const issues = [];
    if (providerLine !== undefined && providerLine.slice("LDVH-Provider:".length).trim() !== route.value.provider) {
      issues.push(newFinding("validation/signature_provider_mismatch", `trailer LDVH-Provider does not match the authoritative session record (${route.value.provider})`));
    }
    if (modelLine !== undefined && modelLine.slice("LDVH-Model:".length).trim() !== route.value.model) {
      issues.push(newFinding("validation/signature_model_mismatch", `trailer LDVH-Model does not match the authoritative session record (${route.value.model})`));
    }
    return { ok: issues.length === 0, hardFail: issues.length > 0, issues };
  }

  const handlers = {
    "resolve-governance-scope": executeResolveGovernanceScope,
    "read-specification-candidates": executeReadSpecificationCandidates,
    "read-specification-content": executeReadSpecificationContent,
    "discover-ldvh-capabilities": executeDiscoverCapabilities,
    "precheck-git-commit": executePrecheckGitCommit
  };

  return { handlers, OPERATIONS };
}

/**
 * Register the LDVH tool batch onto ctx.tools. Only called for governed
 * sessions (the caller owns the three-state gate — not_governed and
 * unavailable sessions register nothing, 08 §5.2). Returns the disposers.
 */
/**
 * Build the registration descriptor for one operation. Exported so the output
 * contract (open schema + array-rendering render) is assertable without a live
 * ctx.tools registry — the registration call itself was never the failure
 * point; result delivery was.
 */
export function toolDescriptor(operationKey, operation, handler) {
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
        // Execution error: report the actual side effects (none — every
        // operation here is read-only) and the residual scope honestly.
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

export function registerLdvhTools(ctx, deps) {
  const { handlers } = makeExecute(deps);
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    const handler = handlers[operationKey];
    disposers.push(ctx.tools.register(toolDescriptor(operationKey, operation, handler)));
  }
  // Append subagent result collection tool (root-session only, governed only).
  if (deps.children !== undefined) {
    disposers.push(registerSubagentResultTool(ctx, {
      dshHomePath: deps.dshHomePath,
      children: deps.children
    }));
  }
  // Research mechanical layer (specs/11 state machine + specs/24 writer),
  // same registration surface: governed sessions only.
  disposers.push(registerResearchTools(ctx, deps));
  // Spark mechanical layer (specs/20 writer), same registration surface.
  disposers.push(registerSparkTools(ctx, deps));
  // ADR mechanical layer (specs/22 writer), same registration surface.
  disposers.push(registerAdrTools(ctx, deps));
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* already removed */ }
    }
  };
}

// Deliberately open (same shape dsh-mnemon uses for every tool output).
//
// This schema constrains OUR OWN handler return value, not a model emission —
// model output is constrained by `parameters`, which stays strict. A
// field-by-field output schema only creates self-inflicted failures: the
// `gaps` field was originally declared `items: { type: "string" }` and every
// structured scan gap ({ responsibility_key, canonical_path, reason }) was
// rejected by it. The 05 §8 envelope semantics are guaranteed by the
// handlers, not by this schema.
const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  switch (operationKey) {
    case "resolve-governance-scope":
      return { type: "object", properties: {}, additionalProperties: false };
    case "read-specification-candidates":
      return {
        type: "object",
        properties: {
          responsibility_key: { type: "string", description: "Target spec_key or attachment_key; omit to enumerate all candidates" },
          layer: { type: "string", enum: ["L0", "L1", "L2"], description: "Disclosure layer (specs/01 §10.2); default L0" }
        },
        additionalProperties: false
      };
    case "read-specification-content":
      return {
        type: "object",
        properties: {
          responsibility_key: { type: "string", description: "Target spec_key or attachment_key, verbatim (01 §10.3)" },
          heading_path: { type: "string", description: "Exact H2 or H2/H3 path for L3; omit for L4 full source" }
        },
        required: ["responsibility_key"],
        additionalProperties: false
      };
    case "discover-ldvh-capabilities":
      return {
        type: "object",
        properties: {
          operation_key: { type: "string", description: "Check a single operation; omit to enumerate all" }
        },
        additionalProperties: false
      };
    case "precheck-git-commit":
      return {
        type: "object",
        properties: {
          message: { type: "string", description: "The full candidate commit message text" }
        },
        required: ["message"],
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

/**
 * The single choke point for tool output (the `text()` idiom dsh-mnemon uses
 * for all of its tools).
 *
 * Contract (verified against dsh-tools and the MCP spec): output.render must
 * return an ARRAY of content blocks, never a bare string. dsh-tools feeds the
 * return through `result.content.some((block) => block.type === "image")`, so
 * a string return throws `content.some is not a function` and the tool result
 * never reaches the model — a silent total failure of the whole batch.
 * Routing every tool's text through here makes that mistake structurally
 * impossible rather than merely absent.
 */
function text(body) {
  return [{ type: "text", text: body }];
}

/**
 * Human-readable projection of one 05 §8 envelope. Pure and exported so the
 * array contract is testable without a live ctx.tools registry.
 */
export function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  if (env.result?.mechanical_outcome !== undefined) lines.push(`mechanical_outcome: ${env.result.mechanical_outcome}`);
  if (Array.isArray(env.result?.candidates)) lines.push(`${env.result.candidates.length} candidate(s) at ${env.result.layer}`);
  if (env.result?.state !== undefined) lines.push(`state: ${env.result.state}`);
  // Gaps may be structured records (05 §8 traceability), so stringify them
  // rather than interpolating them as [object Object].
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  return text(lines.join("\n"));
}

export { OPERATIONS, makeExecute };
