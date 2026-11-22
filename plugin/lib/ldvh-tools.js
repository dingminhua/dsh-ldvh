
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toParameterSpec } from "./parameter-spec-adapter.js";
import { parseSpecDocument, extractHeadings, resolveHeadingPath, contentFingerprint, projectLayer, parseOperationDeclarations as parseDeclarationTable, loadOperationDeclarationsBundle, operationDeclarationSourceLabel } from "./spec-registry.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { evaluateRegistrationEntry, registerProjectFromEntry, unregisterProject } from "./governed-projects.js";
import { bindMembershipEvidence, notApplicableEvidence } from "./membership-evidence.js";
import { currentRouteValues } from "./session-signature.js";
import { probeHostAutomation } from "./host-automation-probe.js";
import { isFrictionPromotionRunning } from "./friction-promotion-lock.js";
import { validateMessage, checkKeyChangesAgainstDiff, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment, newFinding, checkDocsReferences, isSpecOrFactCarrierPath, isFrictionCarrierPath, checkFrictionCommitTargets, checkFactCarrierIdentity, factCarrierType, checkSignatureAgainstRoute } from "./commit-validation.js";
import { detectStaleLibraryModules, detectStaleValidatorModules } from "./module-freshness.js";
import { registerSubagentResultTool } from "./subagent-result.js";
import { REVIEW_ASK_OPERATION, reviewAskParameterSchema, executeReviewAsk } from "./review-ask-tool.js";
import { registerReportTools, OPERATIONS as REPORT_OPERATIONS } from "./report-tools.js";
import { registerResearchConsultTools, OPERATIONS as RESEARCH_CONSULT_OPERATIONS } from "./research-consult-tools.js";
import { OPERATIONS as GOAL_OPERATIONS } from "./goal-tools.js";
import { OPERATIONS as SUBGOAL_OPERATIONS } from "./subgoal-tools.js";
import { OPERATIONS as SPARK_OPERATIONS } from "./spark-tools.js";
import { OPERATIONS as PITFALL_OPERATIONS } from "./pitfall-tools.js";
import { OPERATIONS as NORM_OPERATIONS } from "./norm-tools.js";
import { OPERATIONS as FRICTION_OPERATIONS } from "./friction-tools.js";
import { OPERATIONS as SUBAGENT_RESULT_OPERATIONS } from "./subagent-result.js";
import { registerSparkTools } from "./spark-tools.js";
import { registerPitfallTools } from "./pitfall-tools.js";
import { registerFrictionTools } from "./friction-tools.js";
import { registerNormTools } from "./norm-tools.js";
import { registerGoalTools } from "./goal-tools.js";
import { registerSubGoalTools } from "./subgoal-tools.js";

const execFileAsync = promisify(execFile);

const OPERATIONS = {
  "resolve-governance-scope": {
    toolName: "ldvh_resolve_governance_scope",
    summary: "Resolve the LDVH governance state (governed/not_governed/unavailable) for the current session working directory",
    effect: "read"
  },
  "read-specification-candidates": {
    toolName: "ldvh_read_specification_candidates",
    summary: "Read specification/attachment candidates at L0–L2 disclosure layers by responsibility key or all candidates",
    effect: "read"
  },
  "read-specification-content": {
    toolName: "ldvh_read_specification_content",
    summary: "Read one specification/attachment at L3 (exact heading path) or L4 (full source) with fingerprint and scope disclosure",
    effect: "read"
  },
  "discover-ldvh-capabilities": {
    toolName: "ldvh_discover_capabilities",
    summary: "Discover every LDVH public capability (all registered LDVH tools) with declared/implemented/callable availability. Which operations count as supported is decided only by the packaged public-operation declaration; an operation that is implemented but not declared there is reported as 已实现 or 不可用 with a diagnostic, never as 当次可调用, and discovery does not offer a hand-written contract location for it",
    effect: "read"
  },
  "inspect-loaded-modules": {
    toolName: "ldvh_inspect_loaded_modules",
    summary: "Report which plugin/lib modules on disk are newer than this host process (mtime vs process start). Purely informational: it never gates a write and cannot say which version is actually loaded",
    effect: "read"
  },
  "precheck-git-commit": {
    toolName: "ldvh_precheck_git_commit",
    summary: "Run the read-only mechanical precheck over a controlled-commit candidate message and the current staged Index",
    effect: "read"
  },
  "register-governed-project": {
    toolName: "ldvh_register_governed_project",
    summary: "Register a Git project as LDVH-governed through the AI entry (preconditions checked; atomic write + read-back)",
    effect: "may_change_state",
    awaitsHumanDecision: true
  },
  "unregister-governed-project": {
    toolName: "ldvh_unregister_governed_project",
    summary: "Remove a project's LDVH governance registration through the AI entry (registration preconditions checked)",
    effect: "may_change_state",
    awaitsHumanDecision: true
  },
  "probe-host-automation": {
    toolName: "ldvh_probe_host_automation",
    summary: "Probe whether the host automation capabilities (schedule / sessionController) are available: schedule.create with a `timing: { kind: 'every' }` selector and an explicit `target`, sessionController.create/list, and whether a session title is readable from projections. LDVH no longer depends on periodic tasks for friction discovery, so this probe is diagnostic only. Read-only by default; pass write=true to actually create a session plus one schedule, in which case the result carries the exact cleanup parameters (0.2.2-rc.1 has no schedule.delete — removal is edit({action:'delete'}))",
    effect: "may_change_state"
  }
};

const TOOL_LAYER_CATALOG = Object.freeze([
  { layer: "goal", operations: GOAL_OPERATIONS, spec_key: "goal-fact-type" },
  { layer: "subgoal", operations: SUBGOAL_OPERATIONS, spec_key: "subgoal-fact-type" },
  { layer: "spark", operations: SPARK_OPERATIONS, spec_key: "spark-fact-type" },
  { layer: "norm", operations: NORM_OPERATIONS, spec_key: "norm-fact-type" },
  { layer: "report", operations: REPORT_OPERATIONS, spec_key: "report-fact-type" },
  { layer: "pitfall", operations: PITFALL_OPERATIONS, spec_key: "pitfall-fact-type" },
  { layer: "friction", operations: FRICTION_OPERATIONS, spec_key: "friction-fact-type" },
  { layer: "research-consult", operations: RESEARCH_CONSULT_OPERATIONS, spec_key: "gate-consult-system-foundation" },
  { layer: "subagent-result", operations: SUBAGENT_RESULT_OPERATIONS, spec_key: "check-auxiliary-mechanism-foundation" },
]);

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

const EXCLUDED_NAME_MARKER = /\.(draft|tmp|temp|bak|backup|orig|swp|swo)$|~$|\.draft\.|\.tmp\.|\.temp\.|\.bak\.|\.orig\./;

function isExcludedCarrierName(name) {
  const withoutExtension = name.endsWith(".md") ? name.slice(0, -3) : name;
  return EXCLUDED_NAME_MARKER.test(name) || EXCLUDED_NAME_MARKER.test(withoutExtension);
}

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
    const folded = repoPath.normalize("NFC").toLowerCase();
    addTo(`folded\u0000${folded}`, "approximate_path_collision", member);
  }
  return [...collisions.values()].filter((group) => group.paths.length > 1);
}

const SPEC_ROOT_CARRIER = "00-理念与构成.md";

async function isExistingDirectory(path) {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveSpecSourceRoot(projectRoot, workspaceRoot) {
  const probed = [];
  if (typeof projectRoot === "string" && projectRoot.length > 0) {
    const specsDir = join(projectRoot, "specs");
    probed.push(`governed-project ${specsDir}`);
    if (await isExistingDirectory(specsDir)) return { ok: true, kind: "governed-project", specsDir };
  }
  if (typeof workspaceRoot === "string" && workspaceRoot.length > 0) {
    let packageRoot = workspaceRoot;
    try {
      packageRoot = await realpath(workspaceRoot);
    } catch {
    }
    const devSpecs = join(dirname(packageRoot), "specs");
    probed.push(`dev-checkout ${devSpecs}`);
    if (await pathExists(join(devSpecs, SPEC_ROOT_CARRIER))) {
      return { ok: true, kind: "dev-checkout", specsDir: devSpecs };
    }
    const bundleSpecs = join(packageRoot, "specs");
    probed.push(`plugin-bundle ${bundleSpecs}`);
    if (await isExistingDirectory(bundleSpecs)) return { ok: true, kind: "plugin-bundle", specsDir: bundleSpecs };
  }
  return { ok: false, reason: `specs/ directory not found in the governed project or the plugin corpus (probed: ${probed.join("; ")})` };
}

async function scanSpecCandidates(projectRoot, workspaceRoot) {
  const source = await resolveSpecSourceRoot(projectRoot, workspaceRoot);
  if (!source.ok) return { ok: false, reason: source.reason };
  const specsRoot = source.specsDir;
  const corpusRoot = dirname(specsRoot);
  let entries;
  try {
    entries = await readdir(specsRoot, { withFileTypes: true });
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
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
  }
  const members = [];
  const gaps = [];
  for (const repoPath of files.sort()) {
    let text;
    try {
      text = await readFile(join(corpusRoot, repoPath), "utf8");
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
  const collisions = detectCandidateCollisions(members);
  const withheld = new Set(collisions.flatMap((collision) => collision.paths));
  const admissible = members.filter((member) => !withheld.has(member.repoPath));
  const snapshot = {
    worktree_root: corpusRoot,
    candidate_count: members.length,
    candidate_set_fingerprint: contentFingerprint([...members].map((m) => m.repoPath).sort().join("\n")),
    content_fingerprints: Object.fromEntries(
      [...members].map((m) => [m.repoPath, contentFingerprint(m.markdownText)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    )
  };
  return {
    ok: true,
    source: { kind: source.kind, corpus_root: corpusRoot },
    members: admissible,
    gaps,
    excluded,
    collisions,
    withheld: [...withheld].sort(),
    snapshot
  };
}

function makeExecute(deps) {
  const { dshHomePath, workspaceRoot } = deps;

  async function requestConsent(depsRef, { action, projectId, projectPath, agent, signal }) {
    const gate = depsRef?.hostSeams;
    if (gate === undefined || typeof gate.requestRegistrationConsent !== "function") {
      return { granted: false, reason: "no host seam registry is wired, so the explicit consent this registration requires cannot be obtained" };
    }
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
    const scan = await scanSpecCandidates(governed.project.path, workspaceRoot);
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
        sources: sources({ kind: scan.source.kind, path: scan.source.corpus_root }),
        gaps: [`no candidate carries responsibility_key "${requestedKey}"`],
        verification: { checks: ["key-lookup"], passed: false },
        follow_up: ["read-specification-candidates (no responsibility_key, to enumerate)"]
      });
    }
    const candidates = selected.map((member) => {
      const outline = layer === "L2" ? extractHeadings(member.markdownText).map((h) => ({ level: h.level, text: h.text, line: h.line })) : undefined;
      return projectLayer(member.identity, layer, outline);
    });
    const scanGaps = [
      ...scan.gaps,
      ...scan.excluded.map((entry) => ({ responsibility_key: null, canonical_path: entry.canonical_path, reason: entry.reason })),
      ...scan.collisions.map((collision) => ({
        responsibility_key: null,
        canonical_path: collision.paths.join(", "),
        reason: `${collision.kind}: ${collision.paths.length} candidates collide — all withheld from member reads until resolved`
      }))
    ];
    let evidence = null;
    if (args?.evidence === true) {
      evidence = scan.source.kind === "governed-project"
        ? await bindMembershipEvidence(governed.project.path, selected, {
          bindings: typeof args?.evidence_bindings === "object" && args.evidence_bindings !== null ? args.evidence_bindings : {},
          reviews: Array.isArray(args?.evidence_reviews) ? args.evidence_reviews : [],
          decisions: Array.isArray(args?.evidence_decisions) ? args.evidence_decisions : []
        })
        : notApplicableEvidence(scan.source);
    }
    return envelope("read-specification-candidates", "completed", {
      result: { layer, candidates, ...(evidence !== null ? { membership_evidence: evidence } : {}) },
      scope: { requested: requestedKey ?? "all", completed: selected.map((m) => m.identity.responsibilityKey), not_completed: [] },
      sources: sources({ kind: scan.source.kind, path: scan.source.corpus_root, scan: "specs/", snapshot: scan.snapshot }),
      gaps: [...scanGaps, ...(evidence?.gaps ?? [])],
      verification: {
        checks: ["identity-parse", "layer-projection", "excluded-name-filter", "collision-detection", "snapshot-binding", ...(evidence !== null ? ["membership-evidence-mechanical-subparts"] : [])],
        passed: true
      },
      follow_up: evidence !== null
        ? ["membership_evidence.membership_proven is always false — the semantic remainder requires AI review and the Human decision"]
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
    const scan = await scanSpecCandidates(governed.project.path, workspaceRoot);
    if (!scan.ok) {
      return envelope("read-specification-content", "unavailable", {
        result: null, scope: { requested: key, completed: [], not_completed: [key] }, sources: [], gaps: [scan.reason],
        verification: { checks: ["specs-scan"], passed: false }, follow_up: []
      });
    }
    const member = scan.members.find((m) => m.identity.responsibilityKey === key);
    if (member === undefined) {
      const keyCollision = scan.collisions.find((group) => group.kind === "duplicate_responsibility_key" && group.key === `key\u0000${key}`);
      const nameExcluded = scan.excluded.filter((entry) => entry.canonical_path.includes(key));
      const reason = keyCollision !== undefined
        ? `responsibility_key "${key}" collides across ${keyCollision.paths.length} candidates — all affected candidates withheld until resolved`
        : nameExcluded.length > 0
          ? `"${key}" resolves only to a name-excluded carrier — non-member candidate`
          : `no member candidate carries responsibility_key "${key}"`;
      return envelope("read-specification-content", "rejected", {
        result: null, scope: { requested: key, completed: [], not_completed: [key] },
        sources: sources({ kind: scan.source.kind, path: scan.source.corpus_root, snapshot: scan.snapshot }),
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
      return envelope("read-specification-content", "completed", {
        result: { layer: "L4", responsibility_key: key, canonical_path: member.repoPath, content_fingerprint: fingerprint, content: member.markdownText },
        scope: { requested: key, completed: [key], not_completed: [] },
        sources: sources({ kind: scan.source.kind, path: join(scan.source.corpus_root, member.repoPath), content_fingerprint: fingerprint }),
        gaps: scan.gaps,
        verification: { checks: ["identity-parse", "full-read"], passed: true },
        follow_up: []
      });
    }
    const resolved = resolveHeadingPath(member.markdownText, headingPath);
    if (!resolved.ok) {
      return envelope("read-specification-content", "rejected", {
        result: null, scope: { requested: `${key} ${headingPath}`, completed: [], not_completed: [key] },
        sources: sources({ kind: scan.source.kind, path: join(scan.source.corpus_root, member.repoPath) }),
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
      sources: sources({ kind: scan.source.kind, path: join(scan.source.corpus_root, member.repoPath), lines: [resolved.value.startLine, resolved.value.endLine] }),
      gaps: scan.gaps,
      verification: { checks: ["identity-parse", "heading-uniqueness"], passed: true },
      follow_up: ["read-specification-content without heading_path for L4 full source"]
    });
  }

  async function executeInspectLoadedModules(_args, _exec) {
    const report = detectStaleLibraryModules();
    return envelope("inspect-loaded-modules", "completed", {
      result: {
        process_start_ms: report.start_ms,
        library_dir: report.library_dir,
        checked: report.checked,
        stale: report.stale.map((entry) => ({
          file: entry.file,
          mtime_ms: entry.mtime_ms,
        })),
        unreadable: report.unreadable,
      },
      scope: { requested: null, completed: ["plugin/lib"], not_completed: [] },
      sources: [{ kind: "file-system", path: report.library_dir }],
      gaps: [],
      verification: {
        checks: ["mtime-vs-process-start"],
        passed: true,
      },
      follow_up: report.stale.length === 0 ? [] : ["restart-host-to-load-disk-version"],
      informational: {
        effect: "informational-only",
        caveat:
          "An empty stale list does NOT prove the process matches disk: the mtime rule cannot see edits that preserved mtime. "
          + "This report never gates a write and cannot say which version is actually loaded.",
      },
    });
  }

  async function executeDiscoverCapabilities(args, exec) {
    const requestedOperation = typeof args?.operation_key === "string" && args.operation_key.length > 0 ? args.operation_key : null;
    const governed = await resolveGovernanceScope(dshHomePath, exec?.agent?.session?.header?.cwd);
    const declarationsSource = await resolveOperationDeclarations(governed.state === "governed" ? governed.project.path : null, workspaceRoot);
    const declarations = declarationsSource.declarations;
    const declarationTierLabel = operationDeclarationSourceLabel(declarationsSource.tier);
    const declarationReporter = [];
    const catalog = [
      ...Object.entries(OPERATIONS)
        .map(([key, operation]) => ({ key, operation, implemented: typeof handlers[key] === "function", carrier: null })),
      {
        key: "review-ask",
        operation: { toolName: REVIEW_ASK_OPERATION.toolName, summary: REVIEW_ASK_OPERATION.summary, effect: REVIEW_ASK_OPERATION.effect },
        implemented: true,
        carrier: "gate-consult-system-foundation"
      },
      ...TOOL_LAYER_CATALOG.flatMap((entry) => Object.entries(entry.operations).map(([key, operation]) => ({
        key,
        operation,
        implemented: true,
        carrier: entry.spec_key
      })))
    ];
    const undeclared = [];
    const entries = catalog
      .filter((item) => requestedOperation === null || item.key === requestedOperation)
      .map((item) => {
        const key = item.key;
        const operation = item.operation;
        const declaration = declarations.get(key) ?? null;
        const declared = declaration !== null;
        const implemented = item.implemented;
        const callableHere = governed.state === "governed";
        const anchorsOk = declared && declaration.anchor_errors.length === 0;
        if (!declared) {
          undeclared.push(key);
          declarationReporter.push({
            operation_key: key,
            reason: declarationsSource.reason === "" ? "no declaration table found in the declaring source" : declarationsSource.reason,
            detail: "the packaged public-operation declaration is the only authority on which operations are supported; an operation absent from it must be reported as a diagnostic, not returned as declared",
            ...(typeof item.carrier === "string" ? { declaring_carrier: item.carrier } : {})
          });
        } else if (!anchorsOk) {
          declarationReporter.push({
            operation_key: key,
            reason: `declared contract anchor(s) do not resolve: ${declaration.anchor_errors.join("; ")}`,
            detail: "a contract that cannot be resolved mechanically equals an undeclared operation"
          });
        }
        const availability = !anchorsOk
          ? "不可用"
          : (implemented ? (callableHere ? "当次可调用" : "不可用") : "已声明");
        const availabilityDetail = !anchorsOk
          ? (declarationReporter[declarationReporter.length - 1]?.reason ?? "declaration could not be parsed")
          : (callableHere ? null : `session governance state is ${governed.state}; this operation serves governed sessions`);
        return {
          operation_key: key,
          dsh_tool_name: operation.toolName,
          summary: operation.summary,
          effect: operation.effect,
          availability,
          availability_detail: availabilityDetail,
          declaration: anchorsOk
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
      result: {
        operations: entries,
        declaration_source: {
          tier: declarationsSource.tier,
          label: declarationTierLabel,
          ...(typeof declarationsSource.file === "string" && declarationsSource.file.length > 0 ? { file: declarationsSource.file } : {}),
          ...(declarationsSource.fingerprint === "" ? {} : { fingerprint: declarationsSource.fingerprint }),
          declared_operations: declarations.size
        },
        ...(declarationReporter.length > 0 ? { undeclared_or_unresolvable: declarationReporter } : {})
      },
      scope: { requested: requestedOperation ?? "all", completed: entries.map((e) => e.operation_key), not_completed: [] },
      sources: [
        { kind: "tool-batch", module: "plugin/lib/ldvh-tools.js" },
        { kind: "operation-declaration-source", tier: declarationsSource.tier, label: declarationTierLabel, ...(typeof declarationsSource.file === "string" && declarationsSource.file.length > 0 ? { path: declarationsSource.file } : {}) }
      ],
      gaps: [
        ...(governed.state === "unavailable" ? [`governance registration unavailable: ${governed.detail}`] : []),
        ...declarationReporter.map((entry) => `${entry.operation_key}: ${entry.reason}`),
        ...(undeclared.length > 0
          ? [`${undeclared.length} 项能力未在随包公开操作声明中登记（按 declaration-file-authority 条目，未声明的操作不得视为可调用或受支持；本入口不再给出任何手写契约定位）：${undeclared.join("、")}；声明来源：${declarationTierLabel}`]
          : [])
      ],
      verification: {
        checks: ["declaration-table-parse", "declaration-anchor-resolution", "declaration-source-tier", "governance-scope"],
        passed: declarationReporter.length === 0
      },
      follow_up: declarationReporter.length > 0
        ? [`声明来源：${declarationTierLabel}；未声明的操作不得视为受支持——补齐声明后重建随包声明文件，而不是在代码里补一份契约位置`]
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
    const docsRefs = await checkDocsReferencesForIndex(governed.project.path, correspondence.changedPaths ?? []);
    if (!docsRefs.ok) issues.push(...docsRefs.issues);
    const frictionCommits = await checkFrictionCommitTargetsForIndex(governed.project.path);
    if (!frictionCommits.ok) issues.push(...frictionCommits.issues);
    const factIdentity = await checkFactCarrierIdentityForIndex(governed.project.path);
    if (!factIdentity.ok) issues.push(...factIdentity.issues);
    const route = await currentRouteValues(deps.sessionPersistence?.(), exec?.agent);
    const signatureCheck = checkSignatureAgainstRoute(message, route);
    if (!signatureCheck.ok) issues.push(...signatureCheck.issues);
    const structuralTrailerOk = message.includes("LDVH-Provider:") && message.includes("LDVH-Model:") && validateMessage(message).every((issue) => issue.rule !== "validation/signature_trailer_missing");
    const hasValueMismatch = signatureCheck.issues.length > 0;
    const hasNonSignatureFailure = issues.some(
      (issue) => !issue.rule.startsWith("validation/signature_"),
    );
    const staleness = (deps.detectStaleModules ?? detectStaleValidatorModules)();
    const validatorStale = staleness.stale.length > 0;
    let mechanicalOutcome;
    if (hasNonSignatureFailure || !structuralTrailerOk || hasValueMismatch) mechanicalOutcome = "failed";
    else if (!route.ok) mechanicalOutcome = "unverifiable";
    else mechanicalOutcome = "passed";
    if (validatorStale && mechanicalOutcome === "failed") mechanicalOutcome = "unverifiable";
    const result = {
      mechanical_outcome: mechanicalOutcome,
      issues,
      ...(validatorStale
        ? {
            stale_modules: {
              reason: "the running host process loaded these validator modules BEFORE their on-disk versions — the verdict would be computed from stale code, so a `failed` result is withheld as unverifiable",
              files: staleness.stale.map((entry) => ({ path: entry.file, mtime_ms: entry.mtime_ms })),
              process_start_ms: staleness.start_ms,
              how_to_clear: "restart the host (or reload the plugin), then retry; the Git Gate spawns a fresh process and is unaffected",
            },
          }
        : {}),
      ...(mechanicalOutcome === "passed" ? { snapshot_identity: snapshotIdentity(diff, message), source_fingerprint: SOURCE_FINGERPRINT } : {}),
      signature_source: route.ok ? { provider: route.value.provider, model: route.value.model, event_type: route.value.eventType } : { unavailable_reason: route.reason ?? "session identity unavailable" }
    };
    return envelope("precheck-git-commit", "completed", {
      result,
      scope: { requested: "precheck", completed: ["header", "key-changes", "diff-correspondence", "trailers", "signature-source"], not_completed: [
        ...(route.ok ? [] : ["signature-traceability"]),
        ...(validatorStale ? ["verdict-computed-by-current-validator-code"] : []),
      ] },
      sources: [
        { kind: "governed-project", path: governed.project.path },
        ...(route.ok ? [{ kind: "session-routing-record", event_type: route.value.eventType, provider: route.value.provider, model: route.value.model }] : [])
      ],
      gaps: validatorStale
        ? [
            ...issues.map((issue) => `${issue.rule}: ${issue.message}`),
            `the validator modules below are newer on disk than this host process started, so the verdict above was computed by STALE code and is withheld as unverifiable: ${staleness.stale.map((entry) => entry.file).join(", ")}`,
          ]
        : route.ok ? [] : [`provider/model could not be traced to the authoritative session record: ${route.reason ?? "session identity unavailable"}`],
      verification: { checks: ["header", "key_changes", "diff_correspondence", "trailers", "signature_traceability", "docs_references"], passed: issues.length === 0 },
      follow_up: validatorStale
        ? ["restart the host (or reload the plugin) so the validator loads the on-disk version, then re-run precheck; the Git Gate spawns a fresh process per commit and can be used meanwhile"]
        : mechanicalOutcome === "passed" ? ["commit; then verify the Git Gate stderr snapshot_identity equals this result's snapshot_identity"] : ["fix the reported issues and re-run precheck"]
    });
  }

  async function checkFrictionCommitTargetsForIndex(projectPath) {
    const runGit = async (args) => {
      const result = await execFileAsync("git", ["-C", projectPath, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: cleanGitEnvironment() });
      return result.stdout;
    };
    let staged = [];
    try {
      staged = (await runGit(["ls-files", "--cached", "-z"])).split("\0").filter(Boolean);
    } catch {
      staged = [];
    }
    const carriers = [];
    for (const path of staged) {
      if (!isFrictionCarrierPath(path)) continue;
      try {
        carriers.push({ path, content: await runGit(["show", `:${path}`]) });
      } catch {
        carriers.push({ path, content: "" });
      }
    }
    if (carriers.length === 0) return { ok: true, issues: [] };
    return checkFrictionCommitTargets(carriers, {
      resolves: async (hash) => {
        try {
          await runGit(["cat-file", "-e", `${hash}^{commit}`]);
          return true;
        } catch {
          return false;
        }
      },
    });
  }

  async function checkDocsReferencesForIndex(projectPath, changedPaths) {
    const runGit = async (args) => {
      const result = await execFileAsync("git", ["-C", projectPath, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: cleanGitEnvironment() });
      return result.stdout;
    };
    const statuses = new Map();
    try {
      const fields = (await runGit(["diff", "--cached", "--name-status", "--no-ext-diff", "-z"])).split("\0").filter(Boolean);
      for (let index = 0; index < fields.length; index += 1) {
        const status = fields[index];
        if (!/^[A-Z]/.test(status)) continue;
        const letter = status[0];
        if (letter === "R" || letter === "C") {
          const oldPath = fields[index + 1];
          const newPath = fields[index + 2];
          if (typeof newPath === "string") {
            statuses.set(newPath, { letter, oldPath: typeof oldPath === "string" ? oldPath : null });
          }
          index += 2;
          continue;
        }
        const path = fields[index + 1];
        if (typeof path === "string") statuses.set(path, { letter, oldPath: null });
        index += 1;
      }
    } catch {
      return { ok: false, issues: [newFinding("validation/docs_reference_dangling", "staged statuses unreadable: cannot prove no new docs/ reference was introduced, so it fails closed")] };
    }
    const candidates = new Set();
    try {
      for (const path of (await runGit(["ls-files", "--cached", "-z"])).split("\0")) if (path) candidates.add(path);
      for (const path of (await runGit(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0")) if (path) candidates.add(path);
    } catch {
    }
    const carriers = [];
    for (const path of changedPaths) {
      if (!isSpecOrFactCarrierPath(path)) continue;
      const entry = statuses.get(path);
      const status = entry?.letter;
      if (status !== undefined && !["A", "M", "R", "C", "T"].includes(status)) continue;
      let content;
      try {
        content = await runGit(["show", `:${path}`]);
      } catch {
        continue;
      }
      const baselinePath = entry?.oldPath ?? path;
      let baseline;
      try {
        baseline = await runGit(["show", `HEAD:${baselinePath}`]);
      } catch {
        baseline = status === "A" ? void 0 : null;
      }
      carriers.push({ path, content, baseline });
    }
    return checkDocsReferences(carriers, { exists: (p) => candidates.has(p) });
  }

  async function checkFactCarrierIdentityForIndex(projectPath) {
    const runGit = async (args) => {
      const result = await execFileAsync("git", ["-C", projectPath, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: cleanGitEnvironment() });
      return result.stdout;
    };
    let staged = [];
    try {
      staged = (await runGit(["ls-files", "--cached", "-z"])).split("\0").filter(Boolean);
    } catch {
      staged = [];
    }
    const carriers = [];
    for (const path of staged) {
      if (factCarrierType(path) === null) continue;
      let content = "";
      try {
        content = await runGit(["show", `:${path}`]);
      } catch {
        content = "";
      }
      carriers.push({ path, content });
    }
    if (carriers.length === 0) return { ok: true, issues: [] };
    return checkFactCarrierIdentity(carriers);
  }


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
    const consent = await requestConsent(deps, { action: "register", projectId: args?.id, projectPath: target, agent: exec?.agent, signal: exec?.signal });
    if (consent.granted !== true) {
      return envelope("register-governed-project", "rejected", {
        result: null,
        scope: { requested: target, completed: [], not_completed: ["human-consent", "registration"] },
        sources: [],
        gaps: [`explicit Human intent is required for this registration: ${consent.reason}`],
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
    const consent = await requestConsent(deps, { action: "unregister", projectId: args.id, projectPath: target, agent: exec?.agent, signal: exec?.signal });
    if (consent.granted !== true) {
      return envelope("unregister-governed-project", "rejected", {
        result: null,
        scope: { requested: target, completed: [], not_completed: ["human-consent", "unregistration"] },
        sources: [],
        gaps: [`explicit Human intent is required for this registration: ${consent.reason}`],
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


  async function executeProbeHostAutomation(args, exec) {
    if (args?.reconcile === true) {
      const governedScope = await resolveGovernanceScope(dshHomePath, exec?.agent?.session?.header?.cwd);
      if (governedScope.state !== "governed") {
        return envelope("probe-host-automation", "unavailable", {
          result: null,
          scope: { requested: "reconcile", completed: [], not_completed: ["reconcile"] },
          sources: [],
          gaps: [`governance state is ${governedScope.state}`],
          verification: { checks: ["governance-scope"], passed: false },
          follow_up: [],
        });
      }
      const settingsOf = typeof deps.getIdleSettings === "function" ? deps.getIdleSettings : () => ({});
      const s = settingsOf();
      const state = {
        enabled: s?.enabled === true,
        frictionDiscovery: s?.tasks?.["friction-discovery"] === true,
        experienceAccumulation: s?.tasks?.["experience-accumulation"] === true,
      };
      const running = await isFrictionPromotionRunning(dshHomePath, governedScope.project.id);
      return envelope("probe-host-automation", "completed", {
        result: {
          settings: state,
          trigger: "controller-initiated",
          running: running.busy,
          runningReason: running.reason ?? null,
          verdict: state.enabled === true
            ? (running.busy ? "enabled-and-running" : "enabled-idle")
            : "disabled",
        },
        scope: { requested: "reconcile", completed: ["settings", "trigger", "running"], not_completed: [] },
        sources: sources({ kind: "host-services", path: "getIdleSettings / friction-promotion-lock", fingerprint: null }),
        gaps: state.enabled === true ? [] : ["agent assistance is disabled by settings, so nothing should run — this is not a failure"],
        verification: { checks: ["settings", "trigger", "running"], passed: true },
        follow_up: [],
      });
    }
    const governed = await resolveGovernanceScope(dshHomePath, exec?.agent?.session?.header?.cwd);
    if (governed.state !== "governed") {
      return envelope("probe-host-automation", "unavailable", {
        result: null,
        scope: { requested: "probe", completed: [], not_completed: ["probe"] },
        sources: [],
        gaps: [`governance state is ${governed.state}: the probe creates sessions inside a governed project, so it serves governed sessions only`],
        verification: { checks: ["governance-scope"], passed: false },
        follow_up: []
      });
    }
    const write = args?.write === true;
    const probeCtx = deps.agentCtx ?? null;
    if (probeCtx === null || typeof probeCtx.get !== "function") {
      return envelope("probe-host-automation", "unavailable", {
        result: null,
        scope: { requested: "probe", completed: [], not_completed: ["probe"] },
        sources: [],
        gaps: ["no host ctx is wired into this tool batch, so host services cannot be reached; the probe requires a live agent context"],
        verification: { checks: ["host-ctx"], passed: false },
        follow_up: ["call this tool from a session whose agent context is live (the tool batch registers with agent.ctx)"]
      });
    }
    const result = await probeHostAutomation(probeCtx, {
      projectRoot: governed.project.path,
      title: `LDVH 经验审核 · ${governed.project.id}`,
      dryRun: !write,
    });
    const complete = result.verdict === "dry-run-complete" || result.verdict === "all-probes-passed";
    return envelope("probe-host-automation", complete ? "completed" : "partial", {
      result,
      scope: { requested: "probe", completed: ["services", "list", "title", ...(write ? ["session", "schedule"] : [])], not_completed: [] },
      sources: sources({ kind: "host-services", path: "ctx.get('schedule') / ctx.get('sessionController')", fingerprint: null }),
      gaps: result.steps.filter((step) => !step.ok).map((step) => `${step.name}: ${step.detail ?? ""}`),
      verification: {
        checks: ["host-services", "session-list", "title-projection", ...(write ? ["session-create", "schedule-every"] : [])],
        passed: complete,
      },
      follow_up: result.cleanup.length > 0
        ? [`cleanup is NOT automatic; the exact delete parameters are in result.cleanup: ${JSON.stringify(result.cleanup)}`]
        : [],
    });
  }

  const handlers = {
    "resolve-governance-scope": executeResolveGovernanceScope,
    "read-specification-candidates": executeReadSpecificationCandidates,
    "read-specification-content": executeReadSpecificationContent,
    "discover-ldvh-capabilities": executeDiscoverCapabilities,
    "inspect-loaded-modules": executeInspectLoadedModules,
    "precheck-git-commit": executePrecheckGitCommit,
    "register-governed-project": executeRegisterGovernedProject,
    "unregister-governed-project": executeUnregisterGovernedProject,
    "probe-host-automation": executeProbeHostAutomation
  };

  return { handlers, OPERATIONS };
}

export function toolDescriptor(operationKey, operation, handler) {
  return defineTool({
    name: operation.toolName,
    description: operation.summary,
    parameters: toParameterSpec(parameterSchemaFor(operationKey)),
    ...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 },
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
  });
}

async function declarationsFromSpecCorpus(projectRoot, workspaceRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return null;
  const scan = await scanSpecCandidates(projectRoot, workspaceRoot);
  if (!scan.ok) return null;
  const merged = new Map();
  const reasons = [];
  for (const member of scan.members) {
    const rows = parseDeclarationTable(member.markdownText, (headingPath) => resolveHeadingPath(member.markdownText, headingPath).ok);
    if (rows.size === 0) {
      if (rows.reason !== undefined) reasons.push(`${member.repoPath}: ${rows.reason}`);
      continue;
    }
    const sourceKey = member.identity?.responsibilityKey ?? member.repoPath;
    for (const [operationKey, row] of rows) {
      if (merged.has(operationKey)) {
        merged.get(operationKey).anchor_errors.push(`duplicate declaration also found in ${member.repoPath}`);
        continue;
      }
      merged.set(operationKey, { ...row, source: sourceKey, source_path: member.repoPath });
    }
  }
  const reason = merged.size === 0
    ? (reasons.length > 0 ? reasons.join("; ") : "no operation declaration table found in any candidate carrier")
    : "";
  Object.defineProperty(merged, "reason", { value: reason, enumerable: false });
  return { ok: true, tier: "specs", file: null, fingerprint: "", declarations: merged, reason };
}

async function resolveOperationDeclarations(projectRoot, workspaceRoot) {
  const fromSpecs = await declarationsFromSpecCorpus(projectRoot, workspaceRoot);
  if (fromSpecs !== null) return fromSpecs;
  const bundled = await loadOperationDeclarationsBundle();
  if (bundled.ok === true) return bundled;
  return {
    ok: false,
    tier: bundled.tier,
    file: bundled.file,
    fingerprint: "",
    declarations: bundled.declarations,
    reason: bundled.reason,
  };
}

export function registerLdvhTools(ctx, deps) {
  const { handlers } = makeExecute({ ...deps, agentCtx: ctx });
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    const handler = handlers[operationKey];
    disposers.push(ctx.tools.register(toolDescriptor(operationKey, operation, handler)));
  }
  if (deps.children !== undefined) {
    disposers.push(registerSubagentResultTool(ctx, {
      dshHomePath: deps.dshHomePath,
      children: deps.children,
      listChildren: deps.listChildren,
      resolveChild: deps.resolveChild
    }));
  }
  disposers.push(registerReportTools(ctx, deps));
  disposers.push(registerResearchConsultTools(ctx, deps));
  disposers.push(registerSparkTools(ctx, deps));
  disposers.push(registerPitfallTools(ctx, deps));
  disposers.push(registerFrictionTools(ctx, deps));
  disposers.push(registerNormTools(ctx, deps));
  disposers.push(registerGoalTools(ctx, deps));
  disposers.push(registerSubGoalTools(ctx, deps));
  disposers.push(ctx.tools.register(defineTool({
    name: REVIEW_ASK_OPERATION.toolName,
    description: REVIEW_ASK_OPERATION.summary,
    parameters: toParameterSpec(reviewAskParameterSchema()),
    ...(REVIEW_ASK_OPERATION.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 }),
    async execute(args, exec) {
      try {
        return { envelope: JSON.parse(JSON.stringify(await executeReviewAsk(args, exec, {
          hostSeams: deps.hostSeams,
          getReviewAskSettings: deps.getReviewAskSettings,
          readCurrentTurnText: deps.readCurrentTurnText,
        }))) };
      } catch (error) {
        return {
          envelope: {
            operation_key: "review-ask",
            outcome: "execution_error",
            result: null,
            scope: { requested: args?.point ?? null, completed: [], not_completed: [args?.point ?? "review-ask"] },
            sources: [],
            gaps: [String(error?.message ?? error)],
            verification: { checks: [], passed: false },
            follow_up: []
          }
        };
      }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => renderEnvelope("review-ask", value) }
  })));
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch {   }
    }
  };
}

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
          path: { type: "string", description: "Absolute Git root to register; omit to use the session working directory" },
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
          next_default_project_id: { type: "string", description: "Required when removing the current default project and others remain" }
        },
        required: ["id"],
        additionalProperties: false
      };
    case "read-specification-candidates":
      return {
        type: "object",
        properties: {
          responsibility_key: { type: "string", description: "Target spec_key or attachment_key; omit to enumerate all candidates" },
          layer: { type: "string", enum: ["L0", "L1", "L2"], description: "Disclosure layer; default L0" },
          evidence: { type: "boolean", description: "Conclude the mechanically checkable membership sub-parts (reads git history; default false)" },
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
          responsibility_key: { type: "string", description: "Target spec_key or attachment_key, verbatim" },
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
    case "inspect-loaded-modules":
      return { type: "object", properties: {}, additionalProperties: false };
    case "precheck-git-commit":
      return {
        type: "object",
        properties: {
          message: { type: "string", description: "The full candidate commit message text; the handler refuses an absent or empty message with invalid_request" }
        },
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

function text(body) {
  return [{ type: "text", text: body }];
}

export function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  if (env.result?.mechanical_outcome !== undefined) lines.push(`mechanical_outcome: ${env.result.mechanical_outcome}`);
  if (operationKey === "review-ask" || env.operation_key === "review-ask") {
    const r = env.result ?? {};
    if (r.point !== undefined) lines.push(`point: ${r.point}`);
    if (typeof r.custom_note === "string" && r.custom_note.length > 0) {
      lines.push(`custom_note（Human 自由输入，非答复、不冒充 review/skip，请逐字读）: ${r.custom_note}`);
    }
    if (r.switch_enabled !== undefined) lines.push(`switch_enabled: ${r.switch_enabled}`);
    if (r.asked !== undefined) lines.push(`asked: ${r.asked}`);
    if (r.reused === true) lines.push(`reused: true (同一候选内容已答复过，未重复提问)`);
    if (r.fingerprint !== undefined) lines.push(`fingerprint: ${r.fingerprint}`);
    if (r.decision === "review") {
      lines.push(`decision: review — Human 已同意安排${r.point === "post-work" ? "复核" : "审查"}`);
    } else if (r.decision === "skip") {
      lines.push(`decision: skip — Human 选择不安排独立把关，直接推进（主控自查仍在）`);
    } else if (r.decision === "silent") {
      lines.push(`decision: silent — 静默执行：未询问，按设置直接安排${r.point === "post-work" ? "复核" : "审查"}（不是 Human 的答复，也不是 skip）`);
      if (typeof r.notice === "string" && r.notice.length > 0) {
        lines.push(`notice（须原样写进本次交付说明）: ${r.notice}`);
      }
    } else {
      if (r.asked === false && r.switch_enabled === false) {
        lines.push("decision: null — 开关关闭，本次未发起询问（这是配置的结果，不是未决策）");
      } else if (r.asked === false) {
        lines.push("decision: null — 未发起询问（原因见下方 gap；不得当成 skip）");
      } else {
        lines.push("decision: null — 未取得明确答复（未决策不是答复，下次仍会问；不得当成 skip）");
      }
    }
    const basis = r.candidate_basis;
    if (basis !== undefined && basis !== null && typeof basis === "object") {
      if (basis.available === true) {
        lines.push(`candidate_basis（判断依据，不构成裁决；是否已有候选由你判断）: 本轮正文 ${basis.turn_text_chars} 字${basis.turn_text_empty === true ? "（**一个字都没写**）" : ""}${basis.truncated === true ? "（已截断，只读到前一段）" : ""}`);
        lines.push(`candidate_basis.claims: ${basis.claims_present === true ? `带了 ${basis.claims_count} 条，其中 ${basis.claims_in_turn_text_count} 条出现在本轮正文里` : "未带 claims"}`);
        if (basis.claims_present === true && Array.isArray(basis.claims_in_turn_text)) {
          basis.claims_in_turn_text.forEach((hit, index) => {
            lines.push(`  claim[${index + 1}]: ${hit === true ? "出现在正文" : "**未出现在正文**"}`);
          });
        }
        if (typeof basis.note === "string" && basis.note.length > 0) lines.push(`candidate_basis.note: ${basis.note}`);
      } else {
        lines.push(`candidate_basis: unavailable — ${typeof basis.reason === "string" ? basis.reason : "取不到本轮正文"}`);
      }
    }
    const template = r.review_template;
    if (template !== undefined && template !== null && typeof template === "object") {
      if (typeof template.kind === "string") lines.push(`review_template.kind: ${template.kind}`);
      if (typeof template.prompt === "string" && template.prompt.length > 0) {
        lines.push("review_template.prompt: |");
        for (const line of template.prompt.split("\n")) lines.push(`  ${line}`);
      }
    }
    for (const item of env.scope?.not_completed ?? []) lines.push(`not_completed: ${item}`);
    for (const item of env.follow_up ?? []) lines.push(`follow_up: ${item}`);
    for (const gap of env.gaps ?? []) lines.push(`gap: ${gap}`);
    return [{ type: "text", text: lines.join("\n") }];
  }
  if (operationKey === "precheck-git-commit") {
    if (env.result?.mechanical_outcome === "passed") {
      if (typeof env.result.snapshot_identity === "string") lines.push(`snapshot_identity: ${env.result.snapshot_identity}`);
      if (typeof env.result.source_fingerprint === "string") lines.push(`source_fingerprint: ${env.result.source_fingerprint} (protocol tag, not a source-code fingerprint)`);
    }
    for (const item of env.scope?.not_completed ?? []) lines.push(`not_completed: ${item}`);
    for (const item of env.follow_up ?? []) lines.push(`follow_up: ${item}`);
  }
  if (operationKey === "discover-ldvh-capabilities") {
    const ops = Array.isArray(env.result?.operations) ? env.result.operations : [];
    lines.push(`operations: ${ops.length}`);
    const declarationSource = env.result?.declaration_source;
    if (declarationSource !== undefined && declarationSource !== null) {
      lines.push(`declaration source: ${declarationSource.label ?? declarationSource.tier} [${declarationSource.tier}]${typeof declarationSource.file === "string" ? ` — ${declarationSource.file}` : ""}`);
    }
    for (const op of ops) {
      const decl = op?.declaration;
      const anchor = decl?.source_path ?? decl?.source ?? "(no declaration)";
      lines.push(`- ${op?.operation_key ?? "(?)"} [${op?.availability ?? "?"}] — ${op?.summary ?? ""} (${anchor})`);
      if (op?.availability_detail) lines.push(`    detail: ${op.availability_detail}`);
      if (Array.isArray(op?.pending_inputs) && op.pending_inputs.length > 0) {
        lines.push(`    pending_inputs: ${op.pending_inputs.join(", ")}`);
      }
    }
    for (const diag of env.result?.undeclared_or_unresolvable ?? []) {
      lines.push(`undeclared: ${diag?.operation_key ?? "(?)"} — ${diag?.reason ?? ""}`);
    }
    for (const gap of env.gaps ?? []) lines.push(`gap: ${gap}`);
    for (const item of env.follow_up ?? []) lines.push(`follow_up: ${item}`);
  }
  if (Array.isArray(env.result?.candidates)) {
    lines.push(`${env.result.candidates.length} candidate(s) at ${env.result.layer}`);
    for (const candidate of env.result.candidates) {
      if (candidate === null || typeof candidate !== "object") continue;
      const key = candidate.responsibility_key ?? "(no key)";
      const title = candidate.title ?? "(no title)";
      if (operationKey === "read-specification-candidates" && ["L1", "L2"].includes(env.result?.layer)) {
        lines.push(JSON.stringify(candidate));
      } else {
        const identity = [candidate.carrier_kind, candidate.spec_id, candidate.canonical_path].filter((value) => typeof value === "string" && value.length > 0);
        lines.push(`- ${key} — ${title}${identity.length > 0 ? ` (${identity.join("; ")})` : ""}`);
      }
    }
  }
  if (operationKey === "read-specification-content" && typeof env.result?.content === "string") {
    const { content, ...metadata } = env.result;
    lines.push(`source: ${JSON.stringify(metadata)}`);
    lines.push(content);
  }
  if (operationKey === "read-specification-candidates" || operationKey === "read-specification-content") {
    if (Array.isArray(env.sources) && env.sources.length > 0) lines.push(`sources: ${JSON.stringify(env.sources)}`);
    if (Array.isArray(env.follow_up)) {
      for (const next of env.follow_up) lines.push(`follow_up: ${next}`);
    }
  }
  if (env.result?.state !== undefined) lines.push(`state: ${env.result.state}`);
  for (const issue of env.result?.issues ?? []) {
    const rule = issue?.rule ?? "issue";
    const message = issue?.message ?? (typeof issue === "string" ? issue : JSON.stringify(issue));
    lines.push(`issue: ${rule} — ${message}`);
  }
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  if (env.result !== null && typeof env.result === "object" && Array.isArray(env.result.steps)) {
    for (const step of env.result.steps) {
      lines.push(`${step.ok === true ? "ok" : "FAILED"}: ${step.name}${step.detail ? ` — ${step.detail}` : ""}`);
    }
    lines.push(`verdict: ${env.result.verdict}`);
    for (const item of env.result.cleanup ?? []) {
      lines.push(`cleanup: ${item.kind} ${JSON.stringify(item.request ?? item.sessionId)}`);
    }
  }
  if (env.result !== null && typeof env.result === "object" && env.result.settings !== undefined) {
    const st = env.result.settings ?? {};
    lines.push(`agent assistance enabled: ${st.enabled === true}`);
    lines.push(`friction discovery: ${st.frictionDiscovery === true}`);
    lines.push(`experience accumulation: ${st.experienceAccumulation === true}`);
    lines.push(`trigger: ${env.result.trigger}`);
    lines.push(`running: ${env.result.running === true}${env.result.runningReason ? ` (${env.result.runningReason})` : ""}`);
    lines.push(`verdict: ${env.result.verdict}`);
  }
  if (env.result !== null && typeof env.result === "object" && env.result.checked !== undefined && env.result.library_dir !== undefined) {
    lines.push(`checked: ${env.result.checked} module(s) under ${env.result.library_dir}`);
    lines.push(`process_start_ms: ${env.result.process_start_ms}`);
    const stale = Array.isArray(env.result.stale) ? env.result.stale : [];
    lines.push(`stale: ${stale.length}`);
    for (const entry of stale) {
      const name = String(entry?.file ?? "(unknown)").split("/").pop();
      const when = entry?.mtime_ms === undefined ? "?" : new Date(entry.mtime_ms).toISOString();
      lines.push(`  · ${name} mtime=${when}`);
    }
    const unreadable = Array.isArray(env.result.unreadable) ? env.result.unreadable : [];
    lines.push(`unreadable: ${unreadable.length}`);
    for (const file of unreadable) lines.push(`  ! ${file}`);
    if (env.result.informational?.effect !== undefined) lines.push(`effect: ${env.result.informational.effect}`);
    if (env.result.informational?.caveat !== undefined) lines.push(`caveat: ${env.result.informational.caveat}`);
  }
  return text(lines.join("\n"));
}

export { OPERATIONS, makeExecute, resolveSpecSourceRoot };
