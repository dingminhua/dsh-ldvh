// LDVH subgoal mechanical layer — runtime wiring.
//
// This module connects the SubGoal writer (subgoal-writer.js, specs/28 §13 +
// specs/02 §10) to the governed tool surface so the main controller can drive
// it from a live session:
//
//   - subgoal-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - subgoal-list-objects (effect: read)             — F0/F1 discovery:
//     order/title/status/criterion projection, active-only by default
//     (28 §12.4: achieved/retired stay out of ordinary candidates).
//   - subgoal-write-object (effect: may_change_state) — controlled create
//     (after Human-confirmed proposal incl. dedup result) and CAS update with
//     change_log: active→active is 补充级更新 with `object_uid` held fixed
//     (28 §9.2 锚点冻结), active→achieved and active→retired are the two
//     terminal transitions. Carries identity uniqueness (28 §17 第 5 项) and
//     `parent_goal` resolution (28 §14.1) before any write.
//
// Authorities: specs/05 §6 (operation declaration + common envelope), §9.3
// (may_change_state), specs/02 §10 (controlled read/create/update, write-back
// read-back), specs/28 §13/§14.1 (type-specific mechanical checks), specs/28
// §16 (Human Gate: creation, substantive revision and BOTH terminal
// transitions are Human decisions — this tool is the mechanical carrier, not
// the decision).
//
// WHAT THIS LAYER DOES NOT DO (28 §18 red line 9, specs/00 §5.6): it does not
// judge whether a sub-goal actually serves the goal statement. That is a
// semantic judgement. The tool guarantees only that the `alignment` statement
// EXISTS and that the reference resolves — never that it is true.

import {
  createSubGoalObject,
  precheckSubGoalCreate,
  readSubGoalObject,
  updateSubGoalObject,
  listSubGoalObjects,
} from "./subgoal-writer.js";
import { objectRefOf } from "./object-reference.js";
import { currentRouteValues } from "./session-signature.js";
import { FRONTMATTER_AFTER_DESCRIPTION, FRONTMATTER_REMOVALS_DESCRIPTION } from "./after-integrity.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "subgoal-read-object": {
    toolName: "ldvh_subgoal_read",
    summary: "Precise read of one SubGoal fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/02 §9.2, specs/28 §13)",
    effect: "read"
  },
  "subgoal-list-objects": {
    toolName: "ldvh_subgoal_list",
    summary: "Enumerate SubGoal fact objects (F0/F1 discovery): order/title/status/criterion projection for the governed project; active-only by default; ordered by the optional `order` field, then created_at — never by identifier (specs/28 §12.4)",
    effect: "read"
  },
  "subgoal-precheck-create": {
    toolName: "ldvh_subgoal_precheck_create",
    summary: "只读机械预检一份 SubGoal 创建候选：对候选 frontmatter_draft 与 body_markdown 跑**与受控创建完全相同的校验器**，返回 passed/failed/unverifiable、逐条 issues 与候选内容指纹；不落盘、不分配标识（specs/28 §13 提请前机械预检；与 workcase-precheck-create 同形——同一 validator 的两个入口）",
    effect: "read"
  },
  "subgoal-write-object": {
    toolName: "ldvh_subgoal_write",
    writeShaped: true,
    summary: "Controlled write of SubGoal fact objects: create (after Human-confirmed proposal incl. dedup result; requires a resolvable parent goal) and CAS update with change_log; `order` is freely adjustable, `object_uid` is not (28 §8), active→achieved and active→retired are terminal (specs/02 §10, specs/28 §13)",
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
// Handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("subgoal-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "subgoal-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("subgoal-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readSubGoalObject({ factSourceRoot, objectUid, currentProjectId: governed.project.id });
  if (!read.ok) {
    const rejectedCodes = new Set(["subgoal/invalid_uid", "subgoal/not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("subgoal-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "subgoals") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;

  // 28 §8.1: 拆解与落实情况一律由 `serves` 反查派生，不在本对象上存储副本。
  // 空集既可能是「还没拆解」也可能是「拆了但下游没声明」——机械层不可区分，
  // 故如实标注，不以 0% 之类的类推定替代。
  const servesLookup = await deriveServingObjects(factSourceRoot, value.object_uid);

  return envelope("subgoal-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      order: typeof fm.order === "number" ? fm.order : undefined,
      parent_goal: fm.parent_goal,
      status: fm.status,
      criterion: fm.criterion,
      criterion_kind: fm.criterion_kind,
      alignment: fm.alignment,
      disposition: typeof fm.disposition === "string" ? fm.disposition : undefined,
      body_valid: value.body_valid,
      mechanical_issues: value.mechanical_issues,
      frontmatter: fm,
      body: value.body,
      serving_objects: servesLookup.items,
      serving_objects_unresolved: servesLookup.items.length === 0,
    },
    scope: {
      requested: objectUid,
      completed: [objectUid],
      not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see mechanical_issues)"]
    },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: [
      ...value.mechanical_issues,
      ...servesLookup.gaps,
      ...(servesLookup.items.length === 0
        ? ["serving-empty: 该子目标名下暂无 serves 引用——既可能未拆解，也可能下游未声明，两种情形机械层不可区分（28 §8.1）"]
        : []),
    ],
    verification: { checks: ["frontmatter-parse", "body-structure", "closed-set", "serves-reverse-lookup"], passed: value.mechanical_issues.length === 0 },
    follow_up: [
      "whether the criterion is really decidable and whether alignment really tracks the goal statement are AI/Human semantic judgements — NOT mechanical results (28 §15)",
      "subgoal-write-object action=update with the observed fingerprint when a controlled change is needed",
    ]
  });
}

/**
 * Reverse lookup for 28 §8.1: which objects declare `serves: <object_uid>`.
 *
 * This is a DERIVATION, not stored state. A failure to scan is reported as a
 * gap rather than presented as "no work serves this sub-goal" — the two are
 * different claims and conflating them would turn an unread fact source into
 * a false statement of fact.
 */
async function deriveServingObjects(factSourceRoot, objectUid) {
  if (typeof objectUid !== "string" || objectUid.length === 0) return { items: [], gaps: [] };
  try {
    // Use each type's OWN list projection (their fields and status filters are
    // type authority, 20 §13 / 21 §13) rather than a bespoke directory scan:
    // a second reader here would drift from those writers.
    const { listSparkObjects } = await import("./spark-writer.js");
    const { listWorkcaseObjects } = await import("./workcase-writer.js");
    const items = [];
    const gaps = [];

    const workcases = await listWorkcaseObjects({ factSourceRoot, includeClosed: true, limit: 2000 });
    if (!workcases.ok) {
      gaps.push(`serves-lookup(workcase): ${workcases.error?.code ?? "unknown"}: ${workcases.error?.message ?? ""}`);
    } else {
      for (const item of workcases.value.items ?? []) {
        if (item?.serves === objectUid) {
          items.push({ fact_type_key: "workcase", object_uid: item.object_uid, title: item.title, status: item.status });
        }
      }
      if (workcases.value.total > (workcases.value.items ?? []).length) {
        gaps.push(`serves-lookup(workcase) truncated: ${(workcases.value.items ?? []).length} of ${workcases.value.total} — the derived list may be incomplete`);
      }
    }

    const sparks = await listSparkObjects({ factSourceRoot, includeTerminal: true, limit: 2000 });
    if (!sparks.ok) {
      gaps.push(`serves-lookup(spark): ${sparks.error?.code ?? "unknown"}: ${sparks.error?.message ?? ""}`);
    } else {
      for (const item of sparks.value.items ?? []) {
        if (item?.serves === objectUid) {
          items.push({ fact_type_key: "spark", object_uid: item.object_uid, title: item.title, status: item.status });
        }
      }
      if (sparks.value.total > (sparks.value.items ?? []).length) {
        gaps.push(`serves-lookup(spark) truncated: ${(sparks.value.items ?? []).length} of ${sparks.value.total} — the derived list may be incomplete`);
      }
    }
    return { items, gaps };
  } catch (error) {
    return { items: [], gaps: [`serves-lookup failed: ${String(error?.message ?? error)} — the empty result above is NOT evidence that nothing serves this sub-goal`] };
  }
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("subgoal-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object discovery serves governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const wantAll = args?.status === "all";
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listSubGoalObjects({ factSourceRoot, status: wantAll ? "all" : "active", limit: args?.limit });
  if (!listed.ok) {
    return envelope("subgoal-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "subgoals") }],
      gaps: [`${listed.error.code}: ${listed.error.message}`],
      verification: { checks: ["directory-scan"], passed: false },
      follow_up: []
    });
  }
  const value = listed.value;
  const gaps = value.unreadable.map((entry) => `invalid carrier ${entry.file}: ${entry.reason}`);
  if (value.total > value.items.length) {
    gaps.push(`projection truncated at limit of ${value.items.length} of ${value.total} matching objects — narrow the filter or raise the limit; do not treat this page as the full set (02 §9.1)`);
  }
  return envelope("subgoal-list-objects", gaps.length > 0 ? "partial" : "completed", {
    result: {
      count: value.items.length,
      total: value.total,
      filter: wantAll ? "all" : "active",
      items: value.items,
    },
    scope: { requested: "list", completed: ["list"], not_completed: [] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "subgoals") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (28 §6.2) is a semantic comparison over the criterion text — performed by the AI on this projection, never by the tool",
      "subgoal-read-object for the F3 full content of any candidate",
    ]
  });
}

async function executePrecheckCreate(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("subgoal-precheck-create", "unavailable", {
      result: { mechanical_outcome: "unverifiable" },
      scope: { requested: "precheck", completed: [], not_completed: ["precheck"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: the precheck contract serves governed projects only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const draft = args?.frontmatter_draft;
  const bodyMarkdown = args?.body_markdown;
  if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return invalidRequest("subgoal-precheck-create", "frontmatter_draft (object) and body_markdown are required for a create precheck", "precheck");
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const evaluated = await precheckSubGoalCreate({ factSourceRoot, frontmatterDraft: draft, bodyMarkdown });
  if (!evaluated.ok) {
    return envelope("subgoal-precheck-create", "unavailable", {
      result: { mechanical_outcome: "unverifiable" },
      scope: { requested: "precheck", completed: [], not_completed: ["precheck"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "subgoals") }],
      gaps: [`${evaluated.error.code}: ${evaluated.error.message}`],
      verification: { checks: ["precheck"], passed: false },
      follow_up: []
    });
  }
  const value = evaluated.value;
  return envelope(
    "subgoal-precheck-create",
    // 05 §8: a mechanically FAILED candidate is a completed execution that
    // reports a verdict — not a rejected request. `rejected` would tell the
    // caller the tool refused to run it, which is a different fact.
    value.mechanical_outcome === "unverifiable" ? "partial" : "completed",
    {
      result: value,
      scope: {
        requested: "precheck",
        completed: ["precheck"],
        not_completed: value.mechanical_outcome === "passed" ? [] : ["candidate has not passed the mechanical checks"],
      },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "subgoals") }],
      gaps: [
        ...(value.error_code ? [`${value.error_code}: ${value.error_message}`] : []),
        ...(value.issues ?? []),
      ],
      verification: { checks: ["precheck", "candidate-fingerprint"], passed: value.mechanical_outcome === "passed" },
      follow_up: value.mechanical_outcome === "passed"
        ? ["pass the returned candidate_fingerprint to ldvh_subgoal_write(action=create) as expected_candidate_fingerprint — the write refuses when the content changes in between"]
        : ["fix the reported issues and re-run the precheck; do not retry the write hoping for a different verdict (02 §10.1)"],
    },
  );
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update") {
    return invalidRequest("subgoal-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("subgoal-write-object", "unavailable", {
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
  // 02 §7.1 + 09 机械签名: a change_log entry is signed BY CODE and may not be
  // written unsigned.
  if (!sig.ok) {
    return envelope("subgoal-write-object", "unavailable", {
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
      return invalidRequest("subgoal-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 达成条件') are required for action=create", "create");
    }
    // 02 §10.1: this channel HAS a read-only precheck entry, so a create ought to
    // arrive carrying the fingerprint that precheck produced. A create without it
    // is still executed (the write must not invent a verification it never ran),
    // but the fact that no precheck covers it is disclosed as unfulfilled scope —
    // an unregistered gap here would read as "prechecked" afterwards.
    const expectedFingerprint = typeof args?.expected_candidate_fingerprint === "string"
      && args.expected_candidate_fingerprint.length > 0
      ? args.expected_candidate_fingerprint
      : null;
    const created = await createSubGoalObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.value,
      expectedCandidateFingerprint: expectedFingerprint,
    });
    if (!created.ok) {
      return writeRejected("subgoal-write-object", created, factSourceRoot, "create");
    }
    const readBack = await readSubGoalObject({ factSourceRoot, objectUid: created.value.object_uid });
    return envelope("subgoal-write-object", "completed", {
      result: {
        action: "create",
        object_uid: created.value.object_uid,
        file: created.value.file,
        fingerprint: created.value.fingerprint,
        precheck_fingerprint_bound: expectedFingerprint !== null,
        read_back: readBack.ok ? "ok" : `failed: ${readBack.error.message}`,
      },
      scope: {
        requested: "create",
        completed: ["create", "read-back"],
        not_completed: expectedFingerprint === null
          ? ["precheck (no candidate fingerprint supplied — this create was NOT covered by ldvh_subgoal_precheck_create, 02 §10.1)"]
          : [],
      },
      sources: [{ kind: "fact-object", path: created.value.file, content_fingerprint: created.value.fingerprint }],
      gaps: [
        ...(readBack.ok ? [] : [readBack.error.message]),
        ...(expectedFingerprint === null
          ? ["precheck-not-run: 本次创建未携带候选指纹，因此没有经受控预检覆盖——入参仍按类型规范核对，但预检这一环未兑现（02 §10.1）；该事实不得在事后被读作「已预检」"]
          : []),
      ],
      verification: { checks: ["frontmatter-closed-set", "identity-uniqueness", "parent-goal-resolvable", "body-skeleton", "write-read-back"], passed: readBack.ok },
      follow_up: [
        "whether this sub-goal really serves the goal statement, and whether the criterion is truly decidable, are AI/Human semantic judgements (28 §15) — this write only proves the shape",
        "subgoal-write-object action=update with the read-back fingerprint for further controlled change",
      ]
    });
  }

  const objectUid = args?.object_uid;
  const expectedFingerprint = args?.expected_fingerprint;
  const frontmatterAfter = args?.frontmatter_after;
  const frontmatterRemovals = Array.isArray(args?.frontmatter_removals) ? args.frontmatter_removals : null;
  const bodyMarkdownAfter = args?.body_markdown_after;
  const changeSummary = args?.change_summary;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("subgoal-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("subgoal-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("subgoal-write-object", "change_summary is required for action=update (02 §10.5: exactly one change_log entry per actual modification)", "update");
  }
  const updated = await updateSubGoalObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    frontmatterRemovals,
    bodyMarkdownAfter,
    changeSummary,
    sessionSignature: sig.value,
  });
  if (!updated.ok) {
    return writeRejected("subgoal-write-object", updated, factSourceRoot, "update");
  }
  const readBack = await readSubGoalObject({ factSourceRoot, objectUid });
  return envelope("subgoal-write-object", "completed", {
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
    verification: { checks: ["cas-fingerprint", "transition-legality", "identity-frozen", "closed-set", "body-skeleton", "write-read-back"], passed: readBack.ok },
    follow_up: updated.value.transition === "achieve"
      ? "achieved is terminal (28 §9.2): the file is read-only afterwards; if the criterion later proves wrong, create a NEW sub-goal rather than reopening this one"
      : updated.value.transition === "retire"
        ? "retired is terminal (28 §9.2): existing serves references keep their value and go through the local re-batch path (21 §10.3); a new sub-goal is a new object, never a revival of this one"
        : "28 §8: `order` is display-only and may be changed freely; `object_uid` is the identity and cannot change",
  });
}

/**
 * Map a writer failure onto the 05 §8 envelope.
 *
 * Identity duplication carries a STRUCTURED payload (`{conflicts}`); the
 * occupants must be RENDERED rather than dropped, otherwise the caller learns
 * only that the uid is duplicated but not where.
 *
 * 2026-11-01: this used to render "anchor already taken" conflicts. Anchors are
 * gone; the only identity invariant left is one `object_uid` ↔ one carrier, and
 * a violation means the fact source itself is inconsistent (28 §17 第 5 项).
 */
export function renderIdentityConflictGaps(details) {
  const conflicts = Array.isArray(details?.conflicts) ? details.conflicts : [];
  if (conflicts.length === 0) return [];
  return [
    `同一对象身份出现在 ${conflicts.length} 条载体上（28 §17 第 5 项：两处权威）——先消除重复载体再继续写入`,
    ...conflicts.map((entry) => `占用者：${entry?.title ?? "(无标题)"}｜文件=${entry?.file ?? "(未知)"}｜status=${entry?.status ?? "(未知)"}`)
  ];
}

export function writeRejected(operationKey, result, factSourceRoot, action) {
  const code = result.error.code;
  const isRejection = code.startsWith("subgoal/frontmatter")
    || code.startsWith("subgoal/body")
    || code.startsWith("subgoal/coherence")
    || code.startsWith("subgoal/fingerprint")
    || code.startsWith("subgoal/identity_")
    || code.startsWith("subgoal/parent_goal")
    || code.startsWith("subgoal/serves_")
    || code === "subgoal/transition_invalid"
    || code === "subgoal/terminal_readonly"
    || code === "subgoal/initial_state_violation"
    || code === "subgoal/disposition_required"
    || code === "subgoal/evidence_basis_required"
    || code === "subgoal/invalid_uid"
    || code === "subgoal/not_found"
    || code === "subgoal/change_summary_required"
    || code === "invalid_request";
  const outcome = isRejection ? "rejected" : "unavailable";
  const details = result.error.details?.issues ?? result.error.details ?? {};
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: action, completed: [], not_completed: [action] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "subgoals") }],
    gaps: [
      `${code}: ${result.error.message}`,
      ...(Array.isArray(details) ? details : []),
      ...renderIdentityConflictGaps(result.error.details),
    ],
    verification: { checks: ["mechanical-checks"], passed: false },
    follow_up: code === "subgoal/identity_duplicated"
      ? ["two carriers claim the same object_uid — resolve the duplication by hand; the writer will not guess which one is authoritative (28 §17 第 5 项)"]
      : code === "subgoal/parent_goal_unresolvable"
        ? ["the project goal carrier must exist and carry goal_key=project-goal before any sub-goal can be written (28 §14.1)"]
        : [],
  });
}

// ---------------------------------------------------------------------------
// Rendering (05 §8 human-readable envelope)
// ---------------------------------------------------------------------------

function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? value ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  if (env.result) {
    lines.push(JSON.stringify(projectResultRefs(env.result, envelopeFactTypeKey(env)), null, 2));
  }
  if (Array.isArray(env.gaps) && env.gaps.length > 0) {
    lines.push("gaps:", ...env.gaps.map((gap) => `  - ${typeof gap === "string" ? gap : JSON.stringify(gap)}`));
  }
  if (Array.isArray(env.follow_up) && env.follow_up.length > 0) {
    lines.push("follow-up:", ...env.follow_up.map((item) => `  - ${typeof item === "string" ? item : JSON.stringify(item)}`));
  }
  return text(lines.join("\n"));
}

function envelopeFactTypeKey(env) {
  const operationKey = typeof env.operation_key === "string" ? env.operation_key : "";
  const factType = operationKey.split("-")[0];
  return factType === "subgoal" ? factType : "";
}

function projectResultRefs(value, factTypeKey) {
  if (Array.isArray(value)) return value.map((entry) => projectResultRefs(entry, factTypeKey));
  if (!value || typeof value !== "object") return value;
  const ownType = typeof value.fact_type_key === "string" && value.fact_type_key !== "" ? value.fact_type_key : factTypeKey;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === "object_uid" && typeof raw === "string" && raw !== "") {
      out[key] = objectRefOf(raw, ownType ?? "") || raw;
      continue;
    }
    out[key] = projectResultRefs(raw, ownType);
  }
  return out;
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  const subgoalFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 40 characters; sub-goal short title for locating and Human scanning (28 §8)" },
      order: { type: "integer", description: "optional display order (28 §8): positive integer, may be omitted, need not be unique or contiguous; it carries NO reference duty, so it may be changed freely at any time" },
      parent_goal: { type: "string", enum: ["project-goal"], description: "the goal key this sub-goal serves; must match the goal carrier's goal_key (28 §8)" },
      status: { type: "string", enum: ["active", "achieved", "retired"], description: "create must be active (28 §9.2 — the only legal initial state); update may transition active→achieved or active→retired, both terminal and read-only afterwards" },
      criterion: { type: "string", description: "the decidable achievement condition — one sentence stating WHAT MATERIAL must appear for this sub-goal to count as achieved (28 §8/§10.2). This statement must appear VERBATIM in the 达成条件 body section (carrier coherence, 28 §8 字段间不变量 1; frontmatter is the single authoritative text — the body only expands it). 'Complete workcase X' / 'close N workcases' is NOT a criterion (28 §6.3)" },
      criterion_kind: { type: "string", enum: ["metric", "closure-records", "executable-check"], description: "how the criterion is proven (28 §10.2): metric = an observable value reaches a threshold; closure-records = a chain of closing records constitutes the material; executable-check = a reproducible check passes. This makes 'how would we prove it' a required answer at creation — it does NOT make the criterion decidable by itself" },
      alignment: { type: "string", description: "why this sub-goal serves the goal statement — must point at specific content of the goal statement, not a generic phrase (28 §8; red line 7). Non-empty is mechanically checkable; whether it is TRUE is a semantic judgement (28 §15)" },
      disposition: { type: "string", description: "terminal destination & reason; required iff status=retired, forbidden otherwise (28 §8)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "parent_goal", "criterion", "criterion_kind", "alignment"],
    additionalProperties: false
  };
  const subgoalFrontmatterAfter = (() => {
    const { required: _r, ...rest } = subgoalFrontmatter;
    return { ...rest, description: FRONTMATTER_AFTER_DESCRIPTION };
  })();

  if (operationKey === "subgoal-read-object") {
    return {
      type: "object",
      properties: { object_uid: { type: "string", description: "Canonical object_uid of the SubGoal object to read — accepts five written forms and normalizes them to the canonical id: (1) bare canonical UUIDv4; (2) `<type>-<uuid>`; (3) `<type>-<8hex>` (02 §9.3 指称形态) 或裸 `<8hex>`（第五种：无类型前缀，反查时跨类型目录，命中即回填真实类型）; (4) `<projectId>@<any of those>` (what the Web 「复制对象引用」 button produces). A type prefix must match the entry being called; a short id is resolved against this project's carriers and rejected if it matches more than one (02 §9.3 第 4 条). Cross-project prefixes are rejected." } },
      required: ["object_uid"],
      additionalProperties: false
    };
  }
  if (operationKey === "subgoal-precheck-create") {
    return {
      type: "object",
      properties: {
        frontmatter_draft: { ...subgoalFrontmatter, description: "the candidate's AI-supplied type fields (exactly what create would receive)" },
        body_markdown: { type: "string", description: "the candidate's body markdown starting with '## 达成条件' (exactly what create would receive)" },
      },
      required: ["frontmatter_draft", "body_markdown"],
      additionalProperties: false
    };
  }
  if (operationKey === "subgoal-list-objects") {
    return {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "all"], description: "active = default (ordinary unresolved candidates, 28 §12.4); all = include achieved/retired for historical tracing" },
        limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 02 §9.1)" }
      },
      additionalProperties: false
    };
  }
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "update"], description: "create: new SubGoal in status=active (Human decision required, 28 §16); update: CAS write against an existing object" },
      frontmatter_draft: subgoalFrontmatter,
      body_markdown: { type: "string", description: "create: the body markdown starting with '## 达成条件' (H2 sections 达成条件/对齐说明, both required and non-empty; criterion and alignment must appear VERBATIM inside them; the H1 is generated from title)" },
      object_uid: { type: "string", description: "update: target object" },
      expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
      frontmatter_after: subgoalFrontmatterAfter,
      frontmatter_removals: { type: "array", items: { type: "string" }, description: FRONTMATTER_REMOVALS_DESCRIPTION },
      body_markdown_after: { type: "string", description: "update: the complete target body markdown (same shape as body_markdown, INCLUDING the H1 line — pass back what a precise read returned)" },
      change_summary: { type: "string", description: "update: one short semantic summary for the change_log entry; for active→achieved it must state the evidence basis (28 §9.2)" },
      expected_candidate_fingerprint: { type: "string", description: "create: the candidate_fingerprint returned by ldvh_subgoal_precheck_create for THIS candidate content. When supplied, the write refuses if the content changed in between — so a precheck verdict never silently carries over to a different candidate (28 §13). Omit only when the candidate was not prechecked, and record that as an unfulfilled scope (02 §10.1)" }
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

/**
 * The handler map, exposed so tests can drive the real handlers (same shape as
 * goal-tools.js `makeExecute`): a test that re-implemented the envelope would
 * stop measuring the tool plane.
 */
export function makeExecute(deps) {
  const handlers = {
    "subgoal-precheck-create": (args, exec) => executePrecheckCreate(args, exec, deps),
    "subgoal-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "subgoal-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "subgoal-write-object": (args, exec) => executeWriteObject(args, exec, deps),
  };
  return { handlers };
}

export function registerSubGoalTools(ctx, deps) {
  const { handlers } = makeExecute(deps);
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
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
