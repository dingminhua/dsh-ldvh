
import {
  createSparkObject,
  precheckSparkCreate,
  computeSparkCreateCandidateFingerprint,
  readSparkObject,
  updateSparkObject,
  listSparkObjects,
  resolveRefsTargets,
  SPARK_DIRECTORY,
  SPARK_REMOVABLE_FIELDS,
} from "./spark-writer.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toParameterSpec } from "./parameter-spec-adapter.js";
import { currentRouteValues } from "./session-signature.js";
import { FRONTMATTER_AFTER_DESCRIPTION } from "./after-integrity.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";
import { objectRef, objectRefOf, shortUid } from "./object-reference.js";

const OPERATIONS = {
  "spark-read-object": {
    toolName: "ldvh_spark_read",
    summary: "Precise read of one Spark fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/03 §9.2, specs/20 §13)",
    effect: "read"
  },
  "spark-list-objects": {
    toolName: "ldvh_spark_list",
    summary: "Enumerate Spark fact objects (F0/F1 discovery): dedup-relevant projection (title/question/status/serves/refs/priority) for the governed project; open-only by default; narrow with keyword / priorities / serves (specs/03 §8, specs/20 §12 — 主动查询是方向线的主要取回路径，见 specs/31 §10；按 object_uid 取单条仍用 ldvh_spark_read)",
    effect: "read"
  },
  "spark-precheck-create": {
    toolName: "ldvh_spark_precheck_create",
    summary: "只读机械预检一份 Spark 创建候选：对候选 frontmatter_draft 与 body_markdown 跑**与受控创建完全相同的求值器**，并计入 create 入口对 dedup_result 的必填检查，返回 passed/failed/unverifiable、逐条 issues 与候选内容指纹；不落盘、不分配标识（specs/20 §13 须设的只读预检入口、写入前机械预检）",
    effect: "read"
  },
  "spark-write-object": {
    toolName: "ldvh_spark_write",
    writeShaped: true,
    awaitsHumanDecision: true,
    summary: "Controlled write of Spark fact objects: create (after Human-confirmed C1 proposal incl. dedup result) and CAS update with change_log, against the governed project's fact source (specs/03 §9.4–§9.5, specs/20 §13)",
    effect: "may_change_state"
  }
};

const FACT_SOURCE_ROOT_DIR = "ldvh-base";


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

async function signatureFor(deps, exec) {
  const route = await currentRouteValues(deps.sessionPersistence?.(), exec?.agent);
  if (!route.ok) return { ok: false, reason: route.reason };
  return { ok: true, value: authoritativeSignature({ provider: route.value.provider, model: route.value.model }) };
}


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
  const read = await readSparkObject({ factSourceRoot, objectUid, currentProjectId: governed.project.id });
  if (!read.ok) {
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
  const refsLookup = Array.isArray(fm.refs) && fm.refs.length > 0
    ? await resolveRefsTargets(factSourceRoot, fm.refs)
    : null;
  const resolvedRefs = refsLookup === null
    ? undefined
    : fm.refs.map((entry) => {
      const uid = typeof entry === "string" ? entry : entry?.object_uid;
      const hit = refsLookup.resolved?.get(uid);
      return hit ? { object_uid: uid, fact_type_key: hit.type, title: hit.title } : { object_uid: uid };
    });
  return envelope("spark-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      question: typeof fm.question === "string" ? fm.question : undefined,
      serves: typeof fm.serves === "string" ? fm.serves : undefined,
      refs: resolvedRefs,
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
  const keyword = args?.keyword === undefined ? null : args.keyword;
  const priorities = args?.priorities === undefined ? null : args.priorities;
  const serves = args?.serves === undefined ? null : args.serves;
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listSparkObjects({ factSourceRoot, includeTerminal, limit, keyword, priorities, serves });
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
  const appliedFilters = [];
  if (value.filters.keyword !== null) appliedFilters.push(`keyword=${JSON.stringify(value.filters.keyword)}`);
  if (value.filters.priorities !== null) appliedFilters.push(`priorities=${value.filters.priorities.join("/")}`);
  if (value.filters.serves !== null) appliedFilters.push(`serves=${value.filters.serves}`);
  if (appliedFilters.length > 0) {
    gaps.push(
      `result is narrowed by ${appliedFilters.join(" · ")} — this is the filtered hit set, not the whole Spark collection; ` +
        `a zero or short list does not mean no such direction exists elsewhere (re-run without the narrowing to compare)`,
    );
  }
  return envelope("spark-list-objects", value.complete ? "completed" : "partial", {
    result: {
      count: value.items.length,
      total: value.complete ? value.items.length : value.total,
      filter: includeTerminal ? "all" : "open",
      filters: {
        keyword: value.filters.keyword,
        priorities: value.filters.priorities,
        serves: value.filters.serves,
      },
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

function sparkCreateReport(draft, dedupResult) {
  const lines = [];
  lines.push(`查重结论：${String(dedupResult).trim()}`);
  if (typeof draft.question === "string" && draft.question.trim().length > 0) lines.push(`调查问题：${draft.question.trim()}`);
  if (typeof draft.scope_boundary === "string" && draft.scope_boundary.trim().length > 0) lines.push(`调查边界：${draft.scope_boundary.trim()}`);
  lines.push(`serves：${typeof draft.serves === "string" && draft.serves.trim().length > 0 ? draft.serves.trim() : "（未声明）"}`);
  return lines.join("\n\n");
}

function sparkTerminalReport(frontmatterAfter, resolveTargetType) {
  const lines = [];
  lines.push(`拟转状态：${String(frontmatterAfter?.status ?? "").trim() || "（缺失）"}`);
  const disposition = typeof frontmatterAfter?.disposition === "string" ? frontmatterAfter.disposition.trim() : "";
  lines.push(`disposition：${disposition.length > 0 ? disposition : "（缺失）"}`);
  const relations = Array.isArray(frontmatterAfter?.relations) ? frontmatterAfter.relations : [];
  if (relations.length > 0) {
    const targets = relations
      .map((r) => {
        const uid = typeof r?.target?.object_uid === "string" ? r.target.object_uid : "";
        const type = typeof uid === "string" && uid.length > 0 && typeof resolveTargetType === "function"
          ? resolveTargetType(uid)
          : undefined;
        const ref = objectRef({ object_uid: uid, fact_type_key: type });
        return `${String(r?.relation_key ?? "?")} → ${ref || (uid.length > 0 ? shortUid(uid) : "?")}`;
      })
      .join("；");
    lines.push(`关系目标：${targets}`);
  }
  return lines.join("\n\n");
}

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
    agent: exec?.agent,
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

async function executePrecheckCreate(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("spark-precheck-create", "unavailable", {
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
    return invalidRequest("spark-precheck-create", "frontmatter_draft (object) and body_markdown are required for a create precheck", "precheck");
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const evaluated = await precheckSparkCreate({
    factSourceRoot,
    frontmatterDraft: draft,
    bodyMarkdown,
    dedupResult: args?.dedup_result,
  });
  if (!evaluated.ok) {
    return envelope("spark-precheck-create", "unavailable", {
      result: { mechanical_outcome: "unverifiable" },
      scope: { requested: "precheck", completed: [], not_completed: ["precheck"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, SPARK_DIRECTORY) }],
      gaps: [`${evaluated.error.code}: ${evaluated.error.message}`],
      verification: { checks: ["precheck"], passed: false },
      follow_up: []
    });
  }
  const value = evaluated.value;
  return envelope(
    "spark-precheck-create",
    value.mechanical_outcome === "unverifiable" ? "partial" : "completed",
    {
      result: value,
      scope: {
        requested: "precheck",
        completed: ["precheck"],
        not_completed: value.mechanical_outcome === "passed" ? [] : ["candidate has not passed the mechanical checks"],
      },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, SPARK_DIRECTORY) }],
      gaps: [
        ...(value.error_code ? [`${value.error_code}: ${value.error_message}`] : []),
        ...(value.issues ?? []),
      ],
      verification: { checks: ["precheck", "candidate-fingerprint"], passed: value.mechanical_outcome === "passed" },
      follow_up: value.mechanical_outcome === "passed"
        ? ["pass the returned candidate_fingerprint to ldvh_spark_write(action=create) as expected_candidate_fingerprint — the write refuses when the content changes in between"]
        : ["fix the reported issues and re-run the precheck; do not retry the write hoping for a different verdict (02 §10.1)"],
    },
  );
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
    const dedupResult = args?.dedup_result;
    if (typeof dedupResult !== "string" || dedupResult.trim().length === 0) {
      return invalidRequest("spark-write-object", "dedup_result is required for action=create (20 §6.2/§17.7): state the semantic dedup conclusion against existing open and terminal Sparks (e.g. \"no same-topic Spark found\" / \"overlaps <uid> but is a distinct direction\"). Dedup is not mechanically decidable — the conclusion stays with you, but an unrecorded one is a Stop Condition.", "create");
    }
    const expectedCandidateFingerprint = typeof args?.expected_candidate_fingerprint === "string"
      && args.expected_candidate_fingerprint.length > 0
      ? args.expected_candidate_fingerprint
      : null;
    if (expectedCandidateFingerprint === null) {
      return writeRejected("spark-write-object", {
        ok: false,
        error: {
          code: "spark/candidate_fingerprint_required",
          message: "expected_candidate_fingerprint is required for action=create (20 §13: 未携带时按「同一性未确认」零写入) — "
            + "run ldvh_spark_precheck_create on this candidate first and pass the candidate_fingerprint it returns",
          details: {},
        },
      }, factSourceRoot);
    }

    const actualCandidateFingerprint = computeSparkCreateCandidateFingerprint(draft, bodyMarkdown);
    if (actualCandidateFingerprint !== expectedCandidateFingerprint) {
      return writeRejected("spark-write-object", {
        ok: false,
        error: {
          code: "spark/candidate_changed",
          message: "the candidate content changed between precheck and write; the precheck verdict does not carry over (20 §13) — re-run the precheck on the current content",
          details: { expected_candidate_fingerprint: expectedCandidateFingerprint, actual_candidate_fingerprint: actualCandidateFingerprint },
        },
      }, factSourceRoot);
    }

    const dry = await createSparkObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.ok ? sig.value : null,
      dryRun: true,
    });
    if (!dry.ok) {
      return writeRejected("spark-write-object", dry, factSourceRoot);
    }
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
      expectedCandidateFingerprint,
    });
    if (!created.ok) {
      return writeRejected("spark-write-object", created, factSourceRoot);
    }
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

  const objectUid = args?.object_uid;
  const expectedFingerprint = args?.expected_fingerprint;
  const frontmatterAfter = args?.frontmatter_after;
  const frontmatterRemovals = Array.isArray(args?.frontmatter_removals) ? args.frontmatter_removals : null;
  const bodyMarkdownAfter = args?.body_markdown_after;
  const changeSummary = args?.change_summary;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("spark-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("spark-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (frontmatterAfter === undefined || frontmatterAfter === null || typeof frontmatterAfter !== "object") {
    return invalidRequest("spark-write-object", "frontmatter_after is required for action=update (an EMPTY OBJECT {} is legal and means 'no field changes')", "update");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("spark-write-object", "body_markdown_after is required for action=update — the COMPLETE target body starting at \"## 当前理解\" (the H1 is generated from title); a partial body, or a body read back with its H1, is refused", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("spark-write-object", "change_summary (one short semantic summary for the change_log) is required for action=update", "update");
  }

  const requestedStatus = frontmatterAfter.status;
  const isTerminalTransition = requestedStatus === "implemented" || requestedStatus === "discarded";
  if (isTerminalTransition) {
    const before = await readSparkObject({ factSourceRoot, objectUid });
    if (!before.ok) return writeRejected("spark-write-object", before, factSourceRoot);
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
    const updateDry = await updateSparkObject({
      factSourceRoot,
      objectUid,
      expectedFingerprint,
      frontmatterAfter,
    frontmatterRemovals,
      bodyMarkdownAfter,
      changeSummary,
      sessionSignature: sig.ok ? sig.value : null,
      dryRun: true,
    });
    if (!updateDry.ok) {
      return writeRejected("spark-write-object", updateDry, factSourceRoot);
    }
    const wasTerminal = before.value.frontmatter.status !== "open";
    if (!wasTerminal) {
      const relationTargets = Array.isArray(frontmatterAfter?.relations) ? frontmatterAfter.relations : [];
      const relationLookup = relationTargets.length > 0
        ? await resolveRefsTargets(factSourceRoot, relationTargets)
        : null;
      const resolveTargetType = (uid) => relationLookup?.resolved?.get(uid)?.type;
      const consent = await requestSparkGate(deps, exec, {
        action: "terminal",
        objectTitle: before.value.frontmatter.title ?? null,
        summary: sparkTerminalReport(frontmatterAfter, resolveTargetType),
      });
      if (!consent.ok) return consent.envelope;
    }
  }

  const boundaryDelta = await sparkBoundaryDelta({ factSourceRoot, objectUid, frontmatterAfter });

  const updated = await updateSparkObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    frontmatterRemovals,
    bodyMarkdownAfter,
    changeSummary,
    sessionSignature: sig.ok ? sig.value : null,
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
      changes: [{ object_uid: objectUid, change: "updated", summary: changeSummary }],
      ...(Array.isArray(updated.value.warnings) && updated.value.warnings.length > 0
        ? { warnings: updated.value.warnings }
        : {})
    },
    scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: readBack.value.file, content_fingerprint: updated.value.fingerprint }],
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
  const mechanicalCodes = new Set([
    "spark/frontmatter_invalid", "spark/body_invalid", "spark/coherence_invalid",
    "spark/relations_invalid", "spark/relation_target_unresolvable", "spark/serves_unresolvable", "spark/refs_unresolvable",
    "spark/initial_state_violation", "spark/status_transition_invalid", "spark/status_terminal",
    "spark/cas_conflict", "spark/change_summary_required", "spark/invalid_uid",
    "spark/candidate_changed", "spark/candidate_fingerprint_required", "spark/dedup_result_required",
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


function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  const result = env.result;
  if (result?.object_uid !== undefined) lines.push(`object: ${objectRef({ object_uid: result.object_uid, fact_type_key: result.fact_type_key ?? "spark" })}`);
  if (result?.title !== undefined) lines.push(`title: ${result.title}`);
  if (result?.status !== undefined) lines.push(`status: ${result.status}`);
  if (result?.serves !== undefined) lines.push(`serves: ${result.serves}`);
  if (Array.isArray(result?.refs) && result.refs.length > 0) {
    lines.push(`refs: ${result.refs.map((r) => {
      if (r === null || typeof r !== "object") return JSON.stringify(r);
      const ref = objectRef(r, { withTitle: typeof r.title === "string" });
      return ref || (typeof r.object_uid === "string" ? shortUid(r.object_uid) : JSON.stringify(r));
    }).join(", ")}`);
  }
  if (result?.question !== undefined) lines.push(`question: ${result.question}`);
  if (result?.fingerprint !== undefined) lines.push(`fingerprint: ${result.fingerprint}`);
  if (result?.body_valid !== undefined) lines.push(`body_valid: ${result.body_valid}`);
  if (result?.mechanical_outcome !== undefined) lines.push(`mechanical_outcome: ${result.mechanical_outcome}`);
  if (result?.candidate_fingerprint !== undefined) lines.push(`candidate_fingerprint: ${result.candidate_fingerprint}`);
  if (result?.error_code !== undefined) lines.push(`error_code: ${result.error_code}`);
  if (result?.read_back?.ok !== undefined) lines.push(`read_back: ${result.read_back.ok ? "ok" : "FAILED"}`);
  if (result?.actual_ref !== undefined) lines.push(`file: ${result.actual_ref}`);
  if (result?.count !== undefined) lines.push(`count: ${result.count}${result.total !== undefined && result.total !== result.count ? ` (of ${result.total})` : ""}`);
  if (Array.isArray(result?.items)) {
    for (const item of result.items) {
      const hit = typeof item.hitReason === "string" && item.hitReason !== "" ? ` 〔${item.hitReason}〕` : "";
      lines.push(`- ${objectRef(item)} [${item.status}]${item.priority ? ` ${item.priority}` : ""} ${item.title}${item.serves ? ` (${item.serves})` : ""}${hit}${Array.isArray(item.refs) && item.refs.length > 0 ? ` → ${item.refs.map((r) => (r !== null && typeof r === "object" ? objectRef(r) || shortUid(r.object_uid) : String(r))).join(", ")}` : ""}`);
    }
  }
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${objectRefOf(change.object_uid, change.fact_type_key ?? "spark")}`);
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  const warnings = Array.isArray(env.result?.warnings) ? env.result.warnings : (Array.isArray(env.warnings) ? env.warnings : []);
  for (const w of warnings) lines.push(`warning: ${typeof w === "string" ? w : JSON.stringify(w)}`);
  for (const next of env.follow_up ?? []) lines.push(`follow_up: ${typeof next === "string" ? next : JSON.stringify(next)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
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
      question: { type: "string", description: "single readable sentence (at most one terminal 。？！ ending the string); must appear verbatim in the 调查问题 body section (carrier coherence, 20 §14.1; frontmatter is the single authoritative text — the body only expands it)" },
      scope_boundary: { type: "string", description: "when to stop (boundary, not goal achievement); must appear verbatim in the 调查边界 body section (carrier coherence, 20 §14.1; frontmatter is the single authoritative text — the body only expands it)" },
      intent: { type: "string", description: "why this is worth keeping + the follow-up direction" },
      summary: { type: "string", description: "complete current semantic snapshot — what this thread currently knows and how to judge it. Index/summary layer: the body 当前理解 section expands it and need NOT repeat it verbatim (02 §7.1, Human 2026-11-10)" },
      evolution: { type: "array", items: evolutionEntry, description: "substantive-pivot log (cap 20); when non-empty the body must carry a 演变 H2 section" },
      serves: { type: "string", description: "SubGoal object_uid (canonical UUIDv4, 28 §12.3); must resolve to an active/achieved SubGoal object; omit when not applicable" },
      refs: { type: "array", items: refsEntry, description: "related fact objects (03 §7.2 关联引用型, 20 §8): any type; target status is NOT checked (an association survives the target closing); every target must resolve to an existing, readable, same-project object_uid or the write is rejected; cap 10; state-neutral; omit when none. Surfaced on the F1 list card for Human scanning." },
      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "suspension ordering tier (20 §8): closed set P0–P3; REQUIRED when status=open (AI proposes an initial tier, Human may adjust), terminal must omit it" },
      disposition: { type: "string", description: "terminal destination and scope; required iff status is implemented/discarded, forbidden while open" },
      relations: { type: "array", items: relationEntry, description: "merged-into (cardinality 1) / split-into (1..n); only on discarded, targets must be existing open sparks (20 §11)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "question", "scope_boundary", "intent", "summary"],
    additionalProperties: false
  };
  switch (operationKey) {
    case "spark-precheck-create":
      return {
        type: "object",
        properties: {
          frontmatter_draft: (() => { const { required: _r, ...rest } = sparkFrontmatter; return { ...rest, description: "the candidate's AI-supplied type fields, exactly as create would receive them (Code-managed fields excluded; `status` is stripped from the candidate fingerprint per 20 §13)" }; })(),
          body_markdown: { type: "string", description: "the candidate body markdown starting with '## 当前理解' (exactly what create would receive)" },
          dedup_result: { type: "string", description: "required: 20 §13 puts the create entry's dedup_result check INSIDE the precheck, so the precheck must receive the same dedup conclusion the write would carry" }
        },
        required: ["frontmatter_draft", "body_markdown", "dedup_result"],
        additionalProperties: false
      };
    case "spark-read-object":
      return {
        type: "object",
        properties: {
          object_uid: { type: "string", description: "Canonical object_uid of the Spark object to read — accepts five written forms and normalizes them to the canonical id: (1) bare canonical UUIDv4; (2) `<type>-<uuid>`; (3) `<type>-<8hex>` (02 §9.3 指称形态) 或裸 `<8hex>`（第五种：无类型前缀，反查时跨类型目录，命中即回填真实类型）; (4) `<projectId>@<any of those>` (what the Web 「复制对象引用」 button produces). A type prefix must match the entry being called; a short id is resolved against this project's carriers and rejected if it matches more than one (02 §9.3 第 4 条). Cross-project prefixes are rejected." }
        },
        required: ["object_uid"],
        additionalProperties: false
      };
    case "spark-list-objects":
      return {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "all"], description: "open = default (ordinary unresolved candidates only, 20 §12); all = include implemented/discarded for historical tracing" },
          keyword: { type: "string", description: "literal case-insensitive substring over title and question (the two semantic inputs 20 §6.2 names for dedup). Substring only — whether two Sparks are the same question stays a semantic judgement by the AI, never a mechanical verdict (02 §9 第 4 项 / 02:262: Code must not use similarity, embedding or keyword weights to adjudicate relevance)" },
          priorities: { type: "array", items: { type: "string", enum: ["P0", "P1", "P2", "P3"] }, description: "keep only Sparks whose declared priority is among these (20 §8). Untiered Sparks are never inferred into a tier, so they do not match any priority filter (20 §8: 排序缺失者排末位、不推定档位)" },
          serves: { type: "string", description: "keep only Sparks serving this SubGoal object_uid verbatim (28 §12.3). Empty result means no Spark declares it — not that the sub-goal is unused" },
          limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1). The cap applies AFTER filtering, and total is the filtered hit count" }
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
          frontmatter_after: (() => { const { required: _r, ...rest } = sparkFrontmatter; return { ...rest, description: FRONTMATTER_AFTER_DESCRIPTION }; })(),
          frontmatter_removals: { type: "array", description: `update: explicit deletion declarations (specs/02 §10.5: 未在通道内重述即继承基线；显式删除只经本通道声明). The accepted field names are NOT restated here — this enum is computed from the writer's own allow-list (SPARK_REMOVABLE_FIELDS for update: ${[...SPARK_REMOVABLE_FIELDS].join("/")}), so the schema and the writer cannot drift apart. Naming a field the writer does not accept is refused with zero writes; naming an absent field is a no-op (02 §10.5).`, items: { type: "string", enum: [...SPARK_REMOVABLE_FIELDS] } },
          body_markdown_after: { type: "string", description: "update: the complete target body markdown (same shape as body_markdown)" },
          change_summary: { type: "string", description: "update: one short semantic summary for the change_log entry" },
          expected_candidate_fingerprint: { type: "string", description: "create (required): the candidate_fingerprint returned by ldvh_spark_precheck_create for THIS candidate content. 20 §13 makes it a required create entry parameter — a create without it is refused with zero writes (「同一性未确认」). The write refuses when the content changed since the precheck." }
        },
        required: ["action"],
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

export function toolDescriptorFor(operationKey, operation, handler) {
  return defineTool({
    name: operation.toolName,
    description: operation.summary,
    parameters: toParameterSpec(parameterSchemaFor(operationKey)),
    ...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 },
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
  });
}

export function registerSparkTools(ctx, deps) {
  const handlers = {
    "spark-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "spark-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "spark-precheck-create": (args, exec) => executePrecheckCreate(args, exec, deps),
    "spark-write-object": (args, exec) => executeWriteObject(args, exec, deps),
  };
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    if (operation.writeShaped === true) registerWriteShapedTool(operation.toolName);
    disposers.push(ctx.tools.register(toolDescriptorFor(operationKey, operation, handlers[operationKey])));
  }
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch {   }
    }
  };
}

export { OPERATIONS };

export { renderEnvelope as renderEnvelopeForTest };
