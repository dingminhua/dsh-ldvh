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
import { parseSpecDocument, extractHeadings, resolveHeadingPath, contentFingerprint, projectLayer, parseOperationDeclarations as parseDeclarationTable } from "./spec-registry.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { evaluateRegistrationEntry, registerProjectFromEntry, unregisterProject } from "./governed-projects.js";
import { bindMembershipEvidence } from "./membership-evidence.js";
import { currentRouteValues } from "./session-signature.js";
import { validateMessage, checkKeyChangesAgainstDiff, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment, newFinding } from "./commit-validation.js";
import { registerSubagentResultTool } from "./subagent-result.js";
import { registerResearchTools } from "./research-tools.js";
import { registerSparkTools } from "./spark-tools.js";
import { registerAdrTools } from "./adr-tools.js";
import { registerPitfallTools } from "./pitfall-tools.js";
import { registerWorkcaseTools } from "./workcase-tools.js";
import { registerFrictionTools } from "./friction-tools.js";
import { registerNormTools } from "./norm-tools.js";
import { registerGoalTools } from "./goal-tools.js";

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
  },
  "register-governed-project": {
    toolName: "ldvh_register_governed_project",
    summary: "Register a Git project as LDVH-governed through the 07 §5.4 AI entry (preconditions checked; atomic write + read-back)",
    effect: "may_change_state",
    awaitsHumanDecision: true
  },
  "unregister-governed-project": {
    toolName: "ldvh_unregister_governed_project",
    summary: "Remove a project's LDVH governance registration through the 07 §5.7 AI entry (07 §5.4 preconditions checked)",
    effect: "may_change_state",
    awaitsHumanDecision: true
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

/**
 * Defense 1 of specs/01 §9.1: a carrier whose name carries a draft, temp or
 * backup marker never becomes a candidate, even when the rest of the name
 * matches the canonical pattern. The excluded markers are matched on the
 * whole name so `20-X.draft.md` (marker before the extension) and
 * `20-X.md.draft` (marker after it) are both rejected.
 */
const EXCLUDED_NAME_MARKER = /\.(draft|tmp|temp|bak|backup|orig|swp|swo)$|~$|\.draft\.|\.tmp\.|\.temp\.|\.bak\.|\.orig\./;

function isExcludedCarrierName(name) {
  const withoutExtension = name.endsWith(".md") ? name.slice(0, -3) : name;
  return EXCLUDED_NAME_MARKER.test(name) || EXCLUDED_NAME_MARKER.test(withoutExtension);
}

/**
 * Defense 2 of specs/01 §9.1. Git paths compare as exact UTF-8 byte sequences
 * (no case folding, no Unicode normalization); but two distinct paths that
 * collide *after* NFC normalization or case folding are a cross-platform
 * ambiguity and must reject every affected candidate. The same applies when
 * two candidates claim one spec_id, responsibility_key or canonical_path.
 * Returns one entry per collision group; an empty array means no collision.
 */
function detectCandidateCollisions(members) {
  const collisions = new Map();
  const addTo = (key, kind, member) => {
    if (!collisions.has(key)) collisions.set(key, { kind, key, paths: [] });
    const group = collisions.get(key);
    if (!group.paths.includes(member.repoPath)) group.paths.push(member.repoPath);
  };
  for (const member of members) {
    const { repoPath, identity } = member;
    addTo(`spec_id\u0000${identity?.specId ?? ""}`, "duplicate_spec_id", member);
    addTo(`key\u0000${identity?.responsibilityKey ?? ""}`, "duplicate_responsibility_key", member);
    addTo(`path\u0000${identity?.canonicalPath ?? ""}`, "duplicate_canonical_path", member);
    // Approximate-path ambiguity: normalize then case-fold the repo path.
    const folded = repoPath.normalize("NFC").toLowerCase();
    addTo(`folded\u0000${folded}`, "approximate_path_collision", member);
  }
  return [...collisions.values()].filter((group) => group.paths.length > 1);
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
  // Defense 1 (specs/01 §9.1): excluded carriers are reported as diagnostics
  // with a precise reason rather than silently dropped.
  const excluded = [];
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (!/^[0-9]{2,}-[^/]+\.md$/.test(entry.name)) continue;
    const repoPath = `specs/${entry.name}`;
    if (isExcludedCarrierName(entry.name)) {
      excluded.push({ canonical_path: repoPath, reason: "excluded_name_marker: draft/temp/backup marker in file name" });
      continue;
    }
    files.push(repoPath);
  }
  const attachmentsRoot = join(specsRoot, "attachments");
  try {
    const attachments = await readdir(attachmentsRoot, { withFileTypes: true });
    for (const entry of attachments) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      if (!/^[0-9]{2,}\.Att\.[0-9]{2,}-[^/]+\.md$/.test(entry.name)) continue;
      const repoPath = `specs/attachments/${entry.name}`;
      if (isExcludedCarrierName(entry.name)) {
        excluded.push({ canonical_path: repoPath, reason: "excluded_name_marker: draft/temp/backup marker in file name" });
        continue;
      }
      files.push(repoPath);
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
  // Defense 2 (specs/01 §9.1): when several candidates share a spec_id,
  // responsibility_key or canonical_path — or collide once NFC-normalized or
  // case-folded — every affected candidate is withheld from member reads
  // until the collision is resolved. No candidate is chosen as the winner.
  const collisions = detectCandidateCollisions(members, projectRoot);
  const withheld = new Set(collisions.flatMap((collision) => collision.paths));
  const admissible = members.filter((member) => !withheld.has(member.repoPath));
  // Defense 3 (specs/01 §9.1): one scan yields one snapshot; the member set,
  // the diagnostics and the fingerprint all describe that same snapshot.
  const snapshot = {
    worktree_root: projectRoot,
    candidate_count: members.length,
    candidate_set_fingerprint: contentFingerprint([...members].map((m) => m.repoPath).sort().join("\n")),
    content_fingerprints: Object.fromEntries(
      [...members].map((m) => [m.repoPath, contentFingerprint(m.markdownText)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    )
  };
  return {
    ok: true,
    members: admissible,
    gaps,
    excluded,
    collisions,
    withheld: [...withheld].sort(),
    snapshot
  };
}

function makeExecute(deps) {
  const { dshHomePath } = deps;

  /**
   * 07 §5.6 Human Gate: obtain explicit intent before a registration write.
   *
   * Routed through `ctx.userQuestions.ask` (08 §6). When the composition has no
   * seam registry or no answerer, consent CANNOT be obtained — and 07 §5.6's
   * "仅由 Human 明确意图触发" means the operation must fail closed rather than
   * proceed on the caller's say-so.
   */
  async function requestConsent(depsRef, { action, projectId, projectPath, agent, signal }) {
    const gate = depsRef?.hostSeams;
    if (gate === undefined || typeof gate.requestRegistrationConsent !== "function") {
      return { granted: false, reason: "no host seam registry is wired, so 07 §5.6 consent cannot be obtained" };
    }
    // `agent` is required by the host forwarder (see installUserQuestions): the
    // browser answerer is reached through `api-remotes`, which drops a request
    // carrying no agent (dsh-api-remotes/lib/index.js:115-119).
    //
    // `signal` is likewise required, for a different reason: the operations
    // carrying this ask declare NO wall-clock deadline (see
    // `awaitsHumanDecision` in OPERATIONS). Without the caller's signal an
    // abandoned session leaves the prompt pending forever; with it the ask
    // aborts (ASK_ABORTED) and the operation fails closed.
    return gate.requestRegistrationConsent({ action, projectId, projectPath, agent, signal });
  }

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
    // Defenses 1 and 2 of specs/01 §9.1 surface in `gaps` so an excluded or
    // withheld carrier is visible as a diagnostic instead of vanishing.
    const scanGaps = [
      ...scan.gaps,
      ...scan.excluded.map((entry) => ({ responsibility_key: null, canonical_path: entry.canonical_path, reason: entry.reason })),
      ...scan.collisions.map((collision) => ({
        responsibility_key: null,
        canonical_path: collision.paths.join(", "),
        reason: `${collision.kind}: ${collision.paths.length} candidates collide — all withheld from member reads until resolved`
      }))
    ];
    // specs/01 §9.2 items 8/9/11/12: the mechanically checkable sub-parts are
    // concluded only when the caller asks for them (`evidence: true`), because
    // item 11 shells out to git per carrier. The semantic remainder is always
    // reported alongside, so an item table can never be read as a membership
    // verdict.
    let evidence = null;
    if (args?.evidence === true) {
      evidence = await bindMembershipEvidence(governed.project.path, selected, {
        bindings: typeof args?.evidence_bindings === "object" && args.evidence_bindings !== null ? args.evidence_bindings : {},
        reviews: Array.isArray(args?.evidence_reviews) ? args.evidence_reviews : [],
        decisions: Array.isArray(args?.evidence_decisions) ? args.evidence_decisions : []
      });
    }
    return envelope("read-specification-candidates", "completed", {
      result: { layer, candidates, ...(evidence !== null ? { membership_evidence: evidence } : {}) },
      scope: { requested: requestedKey ?? "all", completed: selected.map((m) => m.identity.responsibilityKey), not_completed: [] },
      sources: sources({ kind: "governed-project", path: governed.project.path, scan: "specs/", snapshot: scan.snapshot }),
      gaps: [...scanGaps, ...(evidence?.gaps ?? [])],
      verification: {
        checks: ["identity-parse", "layer-projection", "excluded-name-filter", "collision-detection", "snapshot-binding", ...(evidence !== null ? ["membership-evidence-mechanical-subparts"] : [])],
        passed: true
      },
      follow_up: evidence !== null
        ? ["membership_evidence.membership_proven is always false — the semantic remainder requires AI review and the Human decision (01 §9.2)"]
        : ["read-specification-content for L3/L4 of any candidate"]
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
      // specs/01 §9.1: a withheld (colliding) or name-excluded carrier must be
      // reported as a non-member candidate with its precise reason, never
      // silently reported as absent and never served as current rules.
      const keyCollision = scan.collisions.find((group) => group.kind === "duplicate_responsibility_key" && group.key === `key\u0000${key}`);
      const nameExcluded = scan.excluded.filter((entry) => entry.canonical_path.includes(key));
      const reason = keyCollision !== undefined
        ? `responsibility_key "${key}" collides across ${keyCollision.paths.length} candidates — all affected candidates withheld until resolved (specs/01 §9.1)`
        : nameExcluded.length > 0
          ? `"${key}" resolves only to a name-excluded carrier — non-member candidate (specs/01 §9.1)`
          : `no member candidate carries responsibility_key "${key}"`;
      return envelope("read-specification-content", "rejected", {
        result: null, scope: { requested: key, completed: [], not_completed: [key] },
        sources: sources({ kind: "governed-project", path: governed.project.path, snapshot: scan.snapshot }),
        gaps: [
          reason,
          ...(keyCollision === undefined ? [] : keyCollision.paths),
          ...nameExcluded.map((entry) => `${entry.canonical_path}: ${entry.reason}`)
        ],
        verification: { checks: ["key-lookup", "collision-detection"], passed: false },
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
    // 05 §6.1「发现的机械义务」: the discovery entry MUST actually parse the
    // source declaration and fill the classification from the parse result —
    // "不得以常量或假设值代替解析结果". So `declared` and `implemented` below
    // come from real parsing of the declaring spec carrier, not from a
    // hardcoded `true`. An unparsable/missing declaration yields a precise
    // reason and the operation is reported as a diagnostic, never as declared.
    const declarations = await parseOperationDeclarations(governed.state === "governed" ? governed.project.path : null);
    const declarationReporter = [];
    const entries = Object.entries(OPERATIONS)
      .filter(([key]) => requestedOperation === null || key === requestedOperation)
      .map(([key, operation]) => {
        const declaration = declarations.get(key) ?? null;
        const declared = declaration !== null;
        // An implementation is locatable when the registered DSH tool has a
        // handler in this batch (the operation table is built from handlers).
        const implemented = typeof handlers[key] === "function";
        // discover itself is only registered for governed sessions (index.js
        // gate), so `governed.state` is "governed" whenever this runs. A
        // `|| key === "resolve-governance-scope"` branch used to sit here but
        // was unreachable dead code: under the not_governed-default model
        // (unavailable is a not_governed special case), NO operation is
        // callable outside governed sessions — including the scope resolver.
        const callableHere = governed.state === "governed";
        const anchorsOk = declared && declaration.anchor_errors.length === 0;
        if (!declared) {
          declarationReporter.push({
            operation_key: key,
            reason: declarations.reason ?? "no declaration table found in the declaring source",
            detail: "per 05 §6.1 an operation with an unparsable or missing declaration must be reported as a diagnostic, not returned as declared"
          });
        } else if (!anchorsOk) {
          declarationReporter.push({
            operation_key: key,
            reason: `declared contract anchor(s) do not resolve: ${declaration.anchor_errors.join("; ")}`,
            detail: "05 §6.1: a contract that cannot be resolved mechanically equals an undeclared operation"
          });
        }
        // 05 §5 结果分类闭集: 已声明 / 已实现 / 当次可调用 / 不可用.
        // The classification must FOLLOW the parse result, never fall back to a
        // positive label when parsing failed: an unresolved declaration is
        // reported as `不可用` with the precise reason in `declaration_errors`,
        // NOT as `已声明` (which would assert a declaration that was not found).
        const availability = !anchorsOk
          ? "不可用"
          : (implemented ? (callableHere ? "当次可调用" : "不可用") : "已声明");
        return {
          operation_key: key,
          dsh_tool_name: operation.toolName,
          summary: operation.summary,
          effect: operation.effect,
          availability,
          availability_detail: !anchorsOk
            ? (declarationReporter[declarationReporter.length - 1]?.reason ?? "declaration could not be parsed")
            : (callableHere ? null : `session governance state is ${governed.state}; this operation serves governed sessions`),
          declaration: declared && anchorsOk
            ? { source: declaration.source, source_path: declaration.source_path, arguments_contract: declaration.arguments_contract, result_contract: declaration.result_contract }
            : null
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
      result: { operations: entries, ...(declarationReporter.length > 0 ? { undeclared_or_unresolvable: declarationReporter } : {}) },
      scope: { requested: requestedOperation ?? "all", completed: entries.map((e) => e.operation_key), not_completed: [] },
      sources: sources({ kind: "tool-batch", module: "plugin/lib/ldvh-tools.js" }),
      // 05 §6.1: an operation whose declaration could not be parsed is reported
      // HERE as a diagnostic with a precise reason — never silently classified
      // as declared and never dropped.
      gaps: [
        ...(governed.state === "unavailable" ? [`governance registration unavailable: ${governed.detail}`] : []),
        ...declarationReporter.map((entry) => `${entry.operation_key}: ${entry.reason}`)
      ],
      verification: {
        checks: ["declaration-table-parse", "declaration-anchor-resolution", "governance-scope"],
        passed: declarationReporter.length === 0
      },
      follow_up: declarationReporter.length > 0
        ? ["add or fix the 05 §6.1 declaration table in the declaring source; an undeclared operation must not be treated as available"]
        : []
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

  /**
   * 07 §5.4 AI entry. Every precondition is checked before any write; an
   * unmet precondition is `unavailable` with the precise reason code, never a
   * success-shaped partial. The session cwd is the project under registration
   * when the caller omits `path` (the spec's "用户 … 表达把当前项目设为管辖"
   * wording), otherwise the explicit path is used.
   */
  async function executeRegisterGovernedProject(args, exec) {
    const cwd = exec?.agent?.session?.header?.cwd;
    const target = typeof args?.path === "string" && args.path.length > 0 ? args.path : cwd;
    if (typeof target !== "string" || target.length === 0) {
      return envelope("register-governed-project", "invalid_request", {
        result: null,
        scope: { requested: null, completed: [], not_completed: ["project path"] },
        sources: [],
        gaps: ["no project path available: supply `path` or run inside the project directory"],
        verification: { checks: [], passed: false },
        follow_up: []
      });
    }
    // 07 §5.6: "登记或取消仅由 Human 明确意图触发". The consent is requested
    // through ctx.userQuestions.ask before ANY write, and a non-affirmative
    // answer (or an unavailable answerer) fails closed — silence is not intent.
    const consent = await requestConsent(deps, { action: "register", projectId: args?.id, projectPath: target, agent: exec?.agent, signal: exec?.signal });
    if (consent.granted !== true) {
      return envelope("register-governed-project", "rejected", {
        result: null,
        scope: { requested: target, completed: [], not_completed: ["human-consent", "registration"] },
        sources: [],
        gaps: [`07 §5.6 requires explicit Human intent: ${consent.reason}`],
        verification: { checks: ["human-gate"], passed: false },
        follow_up: ["obtain explicit Human intent, then retry"]
      });
    }
    const result = await registerProjectFromEntry(dshHomePath, {
      id: args?.id,
      path: target,
      name: typeof args?.name === "string" && args.name.length > 0 ? args.name : void 0,
      description: typeof args?.description === "string" && args.description.length > 0 ? args.description : void 0
    });
    if (!result.ok) {
      const outcome = result.unavailable === true ? "unavailable" : "rejected";
      return envelope("register-governed-project", outcome, {
        result: null,
        scope: { requested: target, completed: [], not_completed: ["registration"] },
        sources: [],
        gaps: [`${result.error.code}: ${result.error.message}`],
        verification: { checks: ["preconditions"], passed: false },
        follow_up: ["resolve the reported precondition, then retry; do not claim the project is governed"]
      });
    }
    return envelope("register-governed-project", "completed", {
      result: result.value,
      scope: { requested: target, completed: result.value.changed ? ["registration", "read-back"] : ["registration-check"], not_completed: [] },
      sources: sources({ kind: "registration", path: result.value.registration.path, fingerprint: result.value.registration.fingerprint }),
      gaps: [],
      verification: { checks: ["preconditions", "git-root", "atomic-write", "read-back"], passed: true },
      follow_up: result.value.changed ? ["resolve-governance-scope"] : []
    });
  }

  /** 07 §5.7 AI entry: the same precondition gate, then removal + read-back. */
  async function executeUnregisterGovernedProject(args, exec) {
    const cwd = exec?.agent?.session?.header?.cwd;
    const target = typeof args?.path === "string" && args.path.length > 0 ? args.path : cwd;
    if (typeof args?.id !== "string" || args.id.length === 0 || typeof target !== "string" || target.length === 0) {
      return envelope("unregister-governed-project", "invalid_request", {
        result: null,
        scope: { requested: target ?? null, completed: [], not_completed: ["id", "project path"] },
        sources: [],
        gaps: ["unregister requires both `id` and a resolvable project path"],
        verification: { checks: [], passed: false },
        follow_up: []
      });
    }
    const preconditions = await evaluateRegistrationEntry(dshHomePath);
    if (!preconditions.ok) {
      return envelope("unregister-governed-project", "unavailable", {
        result: null,
        scope: { requested: target, completed: [], not_completed: ["unregistration"] },
        sources: [],
        gaps: [`${preconditions.error.code}: ${preconditions.error.message}`],
        verification: { checks: ["preconditions"], passed: false },
        follow_up: ["resolve the reported precondition, then retry"]
      });
    }
    // 07 §5.6: cancellation likewise requires explicit Human intent.
    const consent = await requestConsent(deps, { action: "unregister", projectId: args.id, projectPath: target, agent: exec?.agent, signal: exec?.signal });
    if (consent.granted !== true) {
      return envelope("unregister-governed-project", "rejected", {
        result: null,
        scope: { requested: target, completed: [], not_completed: ["human-consent", "unregistration"] },
        sources: [],
        gaps: [`07 §5.6 requires explicit Human intent: ${consent.reason}`],
        verification: { checks: ["human-gate"], passed: false },
        follow_up: ["obtain explicit Human intent, then retry"]
      });
    }
    const result = await unregisterProject(dshHomePath, {
      id: args.id,
      path: target,
      nextDefaultProjectId: typeof args?.next_default_project_id === "string" ? args.next_default_project_id : void 0
    });
    if (!result.ok) {
      return envelope("unregister-governed-project", "rejected", {
        result: null,
        scope: { requested: target, completed: [], not_completed: ["unregistration"] },
        sources: [],
        gaps: [`${result.error.code}: ${result.error.message}`],
        verification: { checks: ["preconditions", "git-root"], passed: false },
        follow_up: ["confirm the id and path, then retry"]
      });
    }
    return envelope("unregister-governed-project", "completed", {
      result: { removed: args.id, hook: result.value.hook?.state ?? null, fact_source_preserved: result.value.factSourcePreserved },
      scope: { requested: target, completed: ["hook-removal", "unregistration", "read-back"], not_completed: [] },
      sources: sources({ kind: "registration", path: "ldvh/governed-projects.yaml", fingerprint: result.value.registration?.fingerprint ?? null }),
      gaps: [],
      verification: { checks: ["preconditions", "git-root", "atomic-write", "read-back"], passed: true },
      follow_up: []
    });
  }

  const handlers = {
    "resolve-governance-scope": executeResolveGovernanceScope,
    "read-specification-candidates": executeReadSpecificationCandidates,
    "read-specification-content": executeReadSpecificationContent,
    "discover-ldvh-capabilities": executeDiscoverCapabilities,
    "precheck-git-commit": executePrecheckGitCommit,
    "register-governed-project": executeRegisterGovernedProject,
    "unregister-governed-project": executeUnregisterGovernedProject
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
 *
 * `timeoutMs` is omitted for operations that block on a Human answer
 * (`awaitsHumanDecision`). The host's timeout policy arms a wall-clock
 * deadline from this field and substitutes `TOOL_TIMEOUT` for the real result
 * once it has elapsed — so a declaration here would guarantee a wrong answer:
 * a person cannot reply within the budget, and the replacement happens AFTER
 * the true answer arrives (`dsh-tool-call-timeout-policy` awaits the tool,
 * then reports the expiry). Omitting the field is the host-sanctioned way to
 * declare "no deadline": `defineTool` skips the key entirely when it is
 * `undefined`, and the policy wrapper returns `next()` unarmed. The official
 * `ask_user_question` tool does exactly this.
 *
 * These operations are still cancellable — that is what `exec.signal` is for,
 * and they now forward it to the ask seam.
 */
export function toolDescriptor(operationKey, operation, handler) {
  return {
    name: operation.toolName,
    description: operation.summary,
    parameters: parameterSchemaFor(operationKey),
    ...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 },
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

/**
 * Parse the 05 §6.1 operation declarations out of the declaring spec carriers
 * of a governed project. This is the mechanical obligation of 05 §6.1: the
 * discovery entry must actually parse the sources, not substitute constants.
 *
 * It reads each candidate carrier's TEXT, parses its declaration table, and
 * resolves each contract anchor through the shared heading-path resolver. A
 * row whose anchors do not resolve stays in the map carrying `anchor_errors`,
 * so the caller reports it instead of silently treating it as declared.
 *
 * NOTE the two-argument contract: this wrapper takes the PROJECT ROOT and does
 * the file reading; `parseDeclarationTable` takes the carrier TEXT. Passing a
 * path straight to the latter parses nothing (a path has no newlines and no
 * header row), which is a silent total failure — hence the split is explicit.
 */
async function parseOperationDeclarations(projectRoot) {
  const merged = new Map();
  const setReason = (reason) => Object.defineProperty(merged, "reason", { value: reason, enumerable: false });
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    setReason("no governed project root available to parse declarations from");
    return merged;
  }
  const scan = await scanSpecCandidates(projectRoot);
  if (!scan.ok) {
    setReason(`declaration sources are unscannable: ${scan.reason}`);
    return merged;
  }
  const reasons = [];
  for (const member of scan.members) {
    const rows = parseDeclarationTable(member.markdownText, (headingPath) => resolveHeadingPath(member.markdownText, headingPath).ok);
    if (rows.size === 0) {
      if (rows.reason !== undefined) reasons.push(`${member.repoPath}: ${rows.reason}`);
      continue;
    }
    const sourceKey = member.identity?.responsibilityKey ?? member.repoPath;
    for (const [operationKey, row] of rows) {
      // First declaring source wins; a duplicate declaration is itself a
      // defect (05 §6.1: operation_key is globally unique) — report, keep first.
      if (merged.has(operationKey)) {
        merged.get(operationKey).anchor_errors.push(`duplicate declaration also found in ${member.repoPath}`);
        continue;
      }
      merged.set(operationKey, { ...row, source: sourceKey, source_path: member.repoPath });
    }
  }
  if (merged.size === 0) {
    setReason(reasons.length > 0 ? reasons.join("; ") : "no operation declaration table found in any candidate carrier");
  }
  return merged;
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
  // Research mechanical layer (specs/30 state machine + specs/24 writer),
  // same registration surface: governed sessions only.
  disposers.push(registerResearchTools(ctx, deps));
  // Spark mechanical layer (specs/20 writer), same registration surface.
  disposers.push(registerSparkTools(ctx, deps));
  // ADR mechanical layer (specs/22 writer), same registration surface.
  disposers.push(registerAdrTools(ctx, deps));
  // Pitfall mechanical layer (specs/23 writer), same registration surface.
  disposers.push(registerPitfallTools(ctx, deps));
  // WorkCase mechanical layer (specs/21 writer) — the 工单 lifecycle:
  // create/approve(Gate 1)/execute/close(Gate 2)/rebatch/cancel/revise
  // with C2 authorization pinning and monotonic attempt tokens.
  disposers.push(registerWorkcaseTools(ctx, deps));
  // Friction mechanical layer (specs/26 writer), same registration surface.
  disposers.push(registerFrictionTools(ctx, deps));
  // Norm mechanical layer (specs/27 writer) — carries uniqueness layer 1
  // (direction_key pre-write refusal) and layer 3 (consumption fail-closed);
  // layer 2 (Git Gate) lives in git-gate-runner.js.
  disposers.push(registerNormTools(ctx, deps));
  // Goal mechanical layer (specs/25 writer) — singleton type, same surface.
  disposers.push(registerGoalTools(ctx, deps));
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
    case "register-governed-project":
      return {
        type: "object",
        properties: {
          id: { type: "string", description: "Project id to register under (required; unique among registered projects)" },
          path: { type: "string", description: "Absolute Git root to register; omit to use the session working directory (07 §5.4)" },
          name: { type: "string", description: "Optional display name" },
          description: { type: "string", description: "Optional purpose description" }
        },
        required: ["id"],
        additionalProperties: false
      };
    case "unregister-governed-project":
      return {
        type: "object",
        properties: {
          id: { type: "string", description: "Registered project id to remove" },
          path: { type: "string", description: "Absolute Git root of the project; omit to use the session working directory" },
          next_default_project_id: { type: "string", description: "Required when removing the current default project and others remain (07 §5.7)" }
        },
        required: ["id"],
        additionalProperties: false
      };
    case "read-specification-candidates":
      return {
        type: "object",
        properties: {
          responsibility_key: { type: "string", description: "Target spec_key or attachment_key; omit to enumerate all candidates" },
          layer: { type: "string", enum: ["L0", "L1", "L2"], description: "Disclosure layer (specs/01 §10.2); default L0" },
          evidence: { type: "boolean", description: "Conclude the mechanically checkable sub-parts of specs/01 §9.2 items 8/9/11/12 (reads git history; default false)" },
          evidence_bindings: { type: "object", description: "Recorded fingerprint bindings per canonical_path (item 12); carriers without one are reported as gaps, never as passes", additionalProperties: true },
          evidence_reviews: { type: "array", description: "Review records [{ref, date?, carriers?}] — item 8 concludes existence only", items: { type: "object", additionalProperties: true } },
          evidence_decisions: { type: "array", description: "Human decision records [{ref, date?, carriers?}] — item 9 concludes existence only", items: { type: "object", additionalProperties: true } }
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
