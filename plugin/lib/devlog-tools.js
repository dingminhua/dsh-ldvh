// LDVH devlog mechanical layer — runtime wiring.
//
// This module connects the DevLog writer (devlog-writer.js, specs/29 §13 +
// specs/02 §10) to the governed tool surface so the main controller can drive
// it from a live session:
//
//   - devlog-read-object      (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - devlog-list-objects     (effect: read)             — F0/F1 discovery:
//     title/status/occurred_at/summary projection, active-only by default
//     (29 §12.4: terminal entries stay out of ordinary candidates).
//   - devlog-precheck-create  (effect: read)             — read-only mechanical
//     precheck of a create candidate; same validator the write path runs.
//   - devlog-write-object     (effect: may_change_state) — controlled create
//     (after Human-confirmed proposal incl. dedup result) and CAS update with
//     change_log: active→active is 补充级更新 (29 §9.3 细化档 included),
//     active→absorbed/superseded/dropped are the three terminal transitions.
//
// Authorities: specs/05 §6 (operation declaration + common envelope), §9.3
// (may_change_state), specs/02 §10 (controlled read/create/update, write-back
// read-back), specs/29 §13/§14.1 (type-specific mechanical checks), specs/29
// §15/§16 (Human Gate: creation, replacement-grade revision and ALL three
// terminal transitions are Human decisions — this tool is the mechanical
// carrier, not the decision).
//
// WHAT THIS LAYER DOES NOT DO (29 §14.1 semantic rows, specs/00 §4.6): it does
// not judge whether `summary` is really a conclusion rather than a narrative,
// whether the conclusion still holds, whether an `absorbed-into` target really
// covers it, or whether a `summary` update is 细化 (refinement) or 替换
// (replacement). Those are semantic judgements. The tool guarantees only that
// the shapes exist, that references resolve and that exactly one change_log
// entry was appended — never that the judgement is right.

import { execFile } from "node:child_process";
import { join } from "node:path";

import {
  createDevLogObject,
  precheckDevLogCreate,
  readDevLogObject,
  updateDevLogObject,
  listDevLogObjects,
  DEVLOG_DIRECTORY,
} from "./devlog-writer.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toParameterSpec } from "./parameter-spec-adapter.js";
import { objectRefOf } from "./object-reference.js";
import { currentRouteValues } from "./session-signature.js";
import { FRONTMATTER_AFTER_DESCRIPTION, FRONTMATTER_REMOVALS_DESCRIPTION } from "./after-integrity.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "devlog-read-object": {
    toolName: "ldvh_devlog_read",
    summary: "Precise read of one DevLog fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/02 §9.2, specs/29 §13)",
    effect: "read"
  },
  "devlog-list-objects": {
    toolName: "ldvh_devlog_list",
    summary: "Enumerate DevLog fact objects (F0/F1 discovery): title/status/occurred_at/summary projection for the governed project; active-only by default, newest occurred_at first (specs/29 §12.4 — the timeline is a 回查 entry, not a topic view)",
    effect: "read"
  },
  "devlog-precheck-create": {
    toolName: "ldvh_devlog_precheck_create",
    summary: "只读机械预检一份 DevLog 创建候选：对候选 frontmatter_draft 与 body_markdown 跑**与受控创建完全相同的校验器**，返回 passed/failed/unverifiable、逐条 issues 与候选内容指纹；不落盘、不分配标识（specs/29 §13 提请前机械预检；与 workcase-precheck-create 同形——同一 validator 的两个入口）",
    effect: "read"
  },
  "devlog-write-object": {
    toolName: "ldvh_devlog_write",
    writeShaped: true,
    summary: "Controlled write of DevLog fact objects: create (after Human-confirmed proposal incl. dedup result) and CAS update with change_log; active→active is 补充级更新 (summary 细化档 included, §9.3), active→absorbed/superseded/dropped are terminal and read-only afterwards (specs/02 §10, specs/29 §13)",
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

/**
 * commit-form target resolver (02 §8.1 第 ② 条): the writer does not shell out,
 * so the tools layer injects this. execFile (not a shell) keeps the injection
 * surface closed.
 */
function makeCommitResolver(factSourceRoot) {
  return async (hash) => {
    if (typeof hash !== "string" || !/^[0-9a-f]{40}$/i.test(hash)) return false;
    return new Promise((resolve) => {
      execFile("git", ["cat-file", "-e", `${hash}^{commit}`], { cwd: factSourceRoot }, (err) => resolve(!err));
    });
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("devlog-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "devlog-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("devlog-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readDevLogObject({ factSourceRoot, objectUid, currentProjectId: governed.project.id });
  if (!read.ok) {
    const rejectedCodes = new Set(["devlog/invalid_uid", "devlog/not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("devlog-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, DEVLOG_DIRECTORY) }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;

  // 29 §9.1: absorbed entries are COMPRESSED — 实测 evidence is no longer
  // readable from the object. Disclose that on every read of one, otherwise a
  // reader would take "the object still exists" for "the evidence is still here".
  const compressionGap = fm.status === "absorbed"
    ? ["compressed: 该条目 status=absorbed，正文仅保留结论与边界与去向两段——实测数字与测量口径已不随对象可读（29 §9.1 已如实登记的已知缺口，须回承接物或 Git 历史取证）"]
    : [];
  const noServesGap = fm.serves === undefined
    ? ["serves-empty: 该条目未声明子目标归属——既可能确实不属于任何子目标，也可能属于某个但未声明，两种情形机械层不可区分（29 §8.1）"]
    : [];

  return envelope("devlog-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      occurred_at: fm.occurred_at,
      created_at: fm.created_at,
      summary: fm.summary,
      serves: typeof fm.serves === "string" ? fm.serves : undefined,
      refs: fm.refs ?? undefined,
      disposition: typeof fm.disposition === "string" ? fm.disposition : undefined,
      relations: fm.relations ?? undefined,
      body_valid: value.body_valid,
      mechanical_issues: value.mechanical_issues,
      frontmatter: fm,
      body: value.body,
    },
    scope: {
      requested: objectUid,
      completed: [objectUid],
      not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see mechanical_issues)"]
    },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: [...value.mechanical_issues, ...compressionGap, ...noServesGap],
    verification: { checks: ["frontmatter-parse", "body-structure", "closed-set", "carrier-coherence"], passed: value.mechanical_issues.length === 0 },
    follow_up: [
      "whether the conclusion is true, still holds, or is really a conclusion rather than a narrative are AI/Human semantic judgements — NOT mechanical results (29 §14.1)",
      "devlog-write-object action=update with the observed fingerprint when a controlled change is needed",
    ]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("devlog-list-objects", "unavailable", {
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
  const listed = await listDevLogObjects({ factSourceRoot, status: wantAll ? "all" : "active", limit: args?.limit });
  if (!listed.ok) {
    return envelope("devlog-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, DEVLOG_DIRECTORY) }],
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
  return envelope("devlog-list-objects", gaps.length > 0 ? "partial" : "completed", {
    result: {
      count: value.items.length,
      total: value.total,
      filter: wantAll ? "all" : "active",
      items: value.items.map((item) => ({
        object_uid: item.object_uid,
        title: item.title,
        status: item.status,
        occurred_at: item.occurred_at,
        summary: item.summary,
        serves: item.serves,
        refs: item.refs,
      })),
    },
    scope: { requested: "list", completed: ["list"], not_completed: [] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, DEVLOG_DIRECTORY) }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (29 §6.2) is a semantic comparison over the conclusion text — performed by the AI on this projection, never by the tool; it has NO mechanical layer (unlike 28 §6.2's anchor uniqueness)",
      "devlog-read-object for the F3 full content of any candidate",
    ]
  });
}

async function executePrecheckCreate(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("devlog-precheck-create", "unavailable", {
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
    return invalidRequest("devlog-precheck-create", "frontmatter_draft (object) and body_markdown are required for a create precheck", "precheck");
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const evaluated = await precheckDevLogCreate({
    factSourceRoot,
    frontmatterDraft: draft,
    bodyMarkdown,
    gitCommitResolver: makeCommitResolver(factSourceRoot),
  });
  if (!evaluated.ok) {
    return envelope("devlog-precheck-create", "unavailable", {
      result: { mechanical_outcome: "unverifiable" },
      scope: { requested: "precheck", completed: [], not_completed: ["precheck"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, DEVLOG_DIRECTORY) }],
      gaps: [`${evaluated.error.code}: ${evaluated.error.message}`],
      verification: { checks: ["precheck"], passed: false },
      follow_up: []
    });
  }
  const value = evaluated.value;
  return envelope(
    "devlog-precheck-create",
    value.mechanical_outcome === "unverifiable" ? "partial" : "completed",
    {
      result: value,
      scope: {
        requested: "precheck",
        completed: ["precheck"],
        not_completed: value.mechanical_outcome === "passed" ? [] : ["candidate has not passed the mechanical checks"],
      },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, DEVLOG_DIRECTORY) }],
      gaps: [
        ...(value.error_code ? [`${value.error_code}: ${value.error_message}`] : []),
        ...(value.issues ?? []),
      ],
      verification: { checks: ["precheck", "candidate-fingerprint"], passed: value.mechanical_outcome === "passed" },
      follow_up: value.mechanical_outcome === "passed"
        ? ["pass the returned candidate_fingerprint to ldvh_devlog_write(action=create) as expected_candidate_fingerprint — the write refuses when the content changes in between"]
        : ["fix the reported issues and re-run the precheck; do not retry the write hoping for a different verdict (02 §10.1)"],
    },
  );
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update") {
    return invalidRequest("devlog-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("devlog-write-object", "unavailable", {
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
    return envelope("devlog-write-object", "unavailable", {
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
      return invalidRequest("devlog-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 背景') are required for action=create", "create");
    }
    const expectedFingerprint = typeof args?.expected_candidate_fingerprint === "string"
      && args.expected_candidate_fingerprint.length > 0
      ? args.expected_candidate_fingerprint
      : null;
    const created = await createDevLogObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.value,
      expectedCandidateFingerprint: expectedFingerprint,
      gitCommitResolver: makeCommitResolver(factSourceRoot),
    });
    if (!created.ok) {
      return writeRejected("devlog-write-object", created, factSourceRoot, "create");
    }
    const readBack = await readDevLogObject({ factSourceRoot, objectUid: created.value.object_uid });
    return envelope("devlog-write-object", "completed", {
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
          ? ["precheck (no candidate fingerprint supplied — this create was NOT covered by ldvh_devlog_precheck_create, 02 §10.1)"]
          : [],
      },
      sources: [{ kind: "fact-object", path: created.value.file, content_fingerprint: created.value.fingerprint }],
      gaps: [
        ...(readBack.ok ? [] : [readBack.error.message]),
        ...(expectedFingerprint === null
          ? ["precheck-not-run: 本次创建未携带候选指纹，因此没有经受控预检覆盖——入参仍按类型规范核对，但预检这一环未兑现（02 §10.1）；该事实不得在事后被读作「已预检」"]
          : []),
      ],
      verification: { checks: ["frontmatter-closed-set", "body-skeleton", "carrier-coherence", "serves-resolvable", "write-read-back"], passed: readBack.ok },
      follow_up: [
        "whether the summary is really a conclusion and whether it still holds are AI/Human semantic judgements (29 §14.1) — this write only proves the shape",
        "devlog-write-object action=update with the read-back fingerprint for further controlled change",
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
    return invalidRequest("devlog-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("devlog-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("devlog-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("devlog-write-object", "change_summary is required for action=update (02 §10.5: exactly one change_log entry per actual modification)", "update");
  }
  const updated = await updateDevLogObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    frontmatterRemovals,
    bodyMarkdownAfter,
    changeSummary,
    sessionSignature: sig.value,
    gitCommitResolver: makeCommitResolver(factSourceRoot),
  });
  if (!updated.ok) {
    return writeRejected("devlog-write-object", updated, factSourceRoot, "update");
  }
  const readBack = await readDevLogObject({ factSourceRoot, objectUid });
  return envelope("devlog-write-object", "completed", {
    result: {
      action: "update",
      transition: updated.value.transition,
      object_uid: updated.value.object_uid,
      file: updated.value.file,
      fingerprint: updated.value.fingerprint,
      read_back: readBack.ok ? "ok" : `failed: ${readBack.error.message}`,
      // 写入侧的警告（如载体内聚差异），不阻断。
      ...(Array.isArray(updated.value.warnings) && updated.value.warnings.length > 0
        ? { warnings: updated.value.warnings }
        : {})
    },
    scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: updated.value.file, content_fingerprint: updated.value.fingerprint }],
    gaps: readBack.ok ? [] : [readBack.error.message],
    verification: { checks: ["cas-fingerprint", "transition-legality", "closed-set", "body-skeleton", "carrier-coherence", "write-read-back"], passed: readBack.ok },
    follow_up: updated.value.transition === "absorb"
      ? "absorbed is terminal AND compressed (29 §9.1): the 实测 sections are gone from the object — if the measured numbers may be needed later, keep the entry active instead"
      : updated.value.transition === "supersede"
        ? "superseded keeps the full text (29 §9.1); the overturning entry must be a DevLog object (§11)"
        : updated.value.transition === "drop"
          ? "dropped keeps the full text (29 §9.1: 过时的处置是 dropped 并保留全文, not deletion — §9.5 删除不存在)"
          : "active→active is 补充级更新 (29 §9.3): a 细化档 summary change needs only this change_log line; a 替换档 one additionally needs Human confirmation, which Code does NOT check (§15)",
  });
}

/**
 * Map a writer failure onto the 05 §8 envelope.
 *
 * 29 §16 makes creation, replacement-grade revision and all three terminal
 * transitions Human decisions. A writer refusal is therefore a REJECTION of the
 * request shape, not a judgement that the Human would have said no — the two
 * must not be conflated in the envelope.
 */
export function writeRejected(operationKey, result, factSourceRoot, action) {
  const code = result.error.code;
  const isRejection = code.startsWith("devlog/frontmatter")
    || code.startsWith("devlog/body")
    || code.startsWith("devlog/coherence")
    || code.startsWith("devlog/fingerprint")
    || code.startsWith("devlog/identity_")
    || code.startsWith("devlog/serves_")
    || code.startsWith("devlog/refs_")
    || code.startsWith("devlog/absorbed_into_")
    || code.startsWith("devlog/superseded_by_")
    || code.startsWith("devlog/target_")
    || code.startsWith("devlog/summary_")
    || code === "devlog/transition_invalid"
    || code === "devlog/terminal_readonly"
    || code === "devlog/initial_state_violation"
    || code === "devlog/disposition_required"
    || code === "devlog/invalid_uid"
    || code === "devlog/not_found"
    || code === "devlog/change_summary_required"
    || code === "devlog/candidate_changed"
    || code === "invalid_request";
  const outcome = isRejection ? "rejected" : "unavailable";
  const details = result.error.details?.issues ?? result.error.details ?? {};
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: action, completed: [], not_completed: [action] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, DEVLOG_DIRECTORY) }],
    gaps: [
      `${code}: ${result.error.message}`,
      ...(Array.isArray(details) ? details : []),
      ...renderIdentityConflictGaps(result.error.details),
    ],
    verification: { checks: ["mechanical-checks"], passed: false },
    follow_up: code === "devlog/identity_duplicated"
      ? ["two carriers claim the same object_uid — resolve the duplication by hand; the writer will not guess which one is authoritative (29 §17 第 5 项)"]
      : code === "devlog/terminal_readonly"
        ? ["三个终态均不可重开 (29 §9.2) — if the conclusion carries weight again, create a NEW entry that says so; the old one keeps its history"]
        : [],
  });
}

export function renderIdentityConflictGaps(details) {
  const conflicts = Array.isArray(details?.conflicts) ? details.conflicts : [];
  if (conflicts.length === 0) return [];
  return [
    `同一对象身份出现在 ${conflicts.length} 条载体上（29 §17 第 5 项：两处权威）——先消除重复载体再继续写入`,
    ...conflicts.map((entry) => `占用者：${entry?.title ?? "(无标题)"}｜文件=${entry?.file ?? "(未知)"}｜status=${entry?.status ?? "(未知)"}`)
  ];
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
  // **warnings 必须进模型可见文本**（同 gaps 的理由：只留在 envelope 里等于没给）。
  const __warnings = Array.isArray(env.result?.warnings) ? env.result.warnings : (Array.isArray(env.warnings) ? env.warnings : []);
  if (__warnings.length > 0) {
    lines.push("warnings:", ...__warnings.map((w) => `  - ${typeof w === "string" ? w : JSON.stringify(w)}`));
  }
  if (Array.isArray(env.follow_up) && env.follow_up.length > 0) {
    lines.push("follow-up:", ...env.follow_up.map((item) => `  - ${typeof item === "string" ? item : JSON.stringify(item)}`));
  }
  return text(lines.join("\n"));
}

function envelopeFactTypeKey(env) {
  const operationKey = typeof env.operation_key === "string" ? env.operation_key : "";
  const factType = operationKey.split("-")[0];
  return factType === "devlog" ? factType : "";
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
  const devlogFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 40 characters; entry short title for locating and Human scanning — does NOT carry the conclusion (29 §8)" },
      status: { type: "string", enum: ["active", "absorbed", "superseded", "dropped"], description: "create must be active (29 §9.2 — the only legal initial state); update may transition active→absorbed/superseded/dropped, all terminal and read-only afterwards" },
      occurred_at: { type: "string", description: "RFC3339 — WHEN THE WORK HAPPENED, not when the entry was written (29 §10.4). Required; must not be later than created_at. Using the recording time here is a defect the mechanical layer cannot detect (29 §15)" },
      summary: { type: "string", description: "当前语义快照 (29 §8/§9.3): the conclusion itself + its current applicability boundary + confirmed non-holds. Must appear VERBATIM in the 结论与边界 body section (carrier coherence, 29 §8 字段间不变量 1; frontmatter is the single authoritative text — the body only expands it). A 细化档 update (boundary/number refinement, conclusion unchanged) is a supplement-level write; a 替换档 one (loosening/tightening/replacing the conclusion) additionally needs Human confirmation — Code does NOT judge which one it is (29 §15)" },
      serves: { type: "string", description: "optional SubGoal object_uid (canonical UUIDv4); must resolve to an active|achieved SubGoal (28 §12.3). Omit when not applicable — an entry without serves has an empty topic and the presentation layer must say so (29 §8.1)" },
      refs: { type: "array", items: { type: "object" }, description: "关联的事实对象引用（29 §8 / §12.3bis；采用面扩展经 Human 决定，02 §8.2）: array of {object_uid} — 目标须为同项目存在且可读的事实对象（**不校验目标状态**——关联是历史事实），上限 10 项，禁重复、禁携带目标标题或关系解释；**只载内容关联**，生命周期关系走 relations、外部资料走 urls、载体内部锚点走 serves；解析失败零写入拒绝，不得降级为空数组；不存在时省略（空数组会伪造一个条件字段）" },
      disposition: { type: "string", description: "terminal destination & reason; required iff status=dropped, forbidden otherwise (29 §8)" },
      relations: { type: "array", items: { type: "object" }, description: "closed set {absorbed-into, superseded-by}, BOTH terminal-only (29 §11). absorbed-into (cardinality 1, iff status=absorbed) → ADR/WorkCase/Norm/Pitfall object_uid or {commit} form; superseded-by (cardinality 1, iff status=superseded) → DevLog object_uid ONLY (a commit cannot answer 「新结论在哪里」)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "occurred_at", "summary"],
    additionalProperties: false
  };
  const devlogFrontmatterAfter = (() => {
    const { required: _r, ...rest } = devlogFrontmatter;
    return { ...rest, description: FRONTMATTER_AFTER_DESCRIPTION };
  })();

  if (operationKey === "devlog-read-object") {
    return {
      type: "object",
      properties: { object_uid: { type: "string", description: "Canonical object_uid of the DevLog object to read — accepts five written forms and normalizes them to the canonical id: (1) bare canonical UUIDv4; (2) `<type>-<uuid>`; (3) `<type>-<8hex>` (02 §9.3 指称形态) 或裸 `<8hex>`（第五种：无类型前缀，反查时跨类型目录，命中即回填真实类型）; (4) `<projectId>@<any of those>` (what the Web 「复制对象引用」 button produces). A type prefix must match the entry being called; a short id is resolved against this project's carriers and rejected if it matches more than one (02 §9.3 第 4 条). Cross-project prefixes are rejected." } },
      required: ["object_uid"],
      additionalProperties: false
    };
  }
  if (operationKey === "devlog-precheck-create") {
    return {
      type: "object",
      properties: {
        frontmatter_draft: { ...devlogFrontmatter, description: "the candidate's AI-supplied type fields (exactly what create would receive)" },
        body_markdown: { type: "string", description: "the candidate's body markdown starting with '## 背景' (exactly what create would receive)" },
      },
      required: ["frontmatter_draft", "body_markdown"],
      additionalProperties: false
    };
  }
  if (operationKey === "devlog-list-objects") {
    return {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "all"], description: "active = default (ordinary candidates, 29 §12.4); all = include absorbed/superseded/dropped for historical tracing" },
        limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 02 §9.1)" }
      },
      additionalProperties: false
    };
  }
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "update"], description: "create: new DevLog in status=active (Human decision required, 29 §16); update: CAS write against an existing object" },
      frontmatter_draft: devlogFrontmatter,
      body_markdown: { type: "string", description: "create: the body markdown starting with '## 背景' (H2 sections 背景/做法/实测/结论与边界/去向, all five required, in order, non-empty, and summary must appear VERBATIM in 结论与边界; the H1 is generated from title)" },
      object_uid: { type: "string", description: "update: target object" },
      expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
      frontmatter_after: devlogFrontmatterAfter,
      frontmatter_removals: { type: "array", items: { type: "string" }, description: `${FRONTMATTER_REMOVALS_DESCRIPTION} For DevLog the removable fields are \`serves\` (29 §8 optional topic pointer) and \`refs\` (29 §8 optional association references).` },
      body_markdown_after: { type: "string", description: "update: the complete target body markdown (same shape as body_markdown, INCLUDING the H1 line — pass back what a precise read returned). For status=absorbed the body must carry ONLY 结论与边界 + 去向 (29 §9.1 压缩形态)" },
      change_summary: { type: "string", description: "update: one short semantic summary for the change_log entry. For a 细化档 summary update it must state what was refined; for a 替换档 one it must state the replacement reason (29 §9.3)" },
      expected_candidate_fingerprint: { type: "string", description: "create: the candidate_fingerprint returned by ldvh_devlog_precheck_create for THIS candidate content. When supplied, the write refuses if the content changed in between — so a precheck verdict never silently carries over to a different candidate (29 §13). Omit only when the candidate was not prechecked, and record that as an unfulfilled scope (02 §10.1)" }
    },
    required: ["action"],
    additionalProperties: false
  };
}

export function toolDescriptorFor(operationKey, operation, handler) {
  // Register through defineTool so the DSH argument check actually runs: the
  // bare-descriptor path only asserts output/timeoutMs shape and stores the
  // schema verbatim, leaving `parameters` unenforced (spark-5b0b380e).
  return defineTool({
    name: operation.toolName,
    description: operation.summary,
    parameters: toParameterSpec(parameterSchemaFor(operationKey)),
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
  });
}

/**
 * The handler map, exposed so tests can drive the real handlers (same shape as
 * goal-tools.js `makeExecute`): a test that re-implemented the envelope would
 * stop measuring the tool plane.
 */
export function makeExecute(deps) {
  const handlers = {
    "devlog-precheck-create": (args, exec) => executePrecheckCreate(args, exec, deps),
    "devlog-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "devlog-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "devlog-write-object": (args, exec) => executeWriteObject(args, exec, deps),
  };
  return { handlers };
}

export function registerDevLogTools(ctx, deps) {
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
