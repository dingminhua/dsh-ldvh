// LDVH workcase mechanical layer — runtime wiring.
//
// This module connects the WorkCase writer (workcase-writer.js, specs/21
// §14 + specs/03 §9) to the governed tool surface so the main controller
// can drive it from a live session:
//
//   - workcase-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - workcase-list-objects (effect: read)             — F0/F1 discovery:
//     title/status/serves/outcome projection, draft+open by default
//     (21 §13: closed 只在精确引用、证据链反查或历史追溯时展开).
//   - workcase-write-object (effect: may_change_state) — the controlled
//     actions mapped to the 21 §14 operations (see WRITE_ACTIONS for the
//     authoritative list; 21 §14 has grown past the original seven):
//       create  — C1 提案对象模式, draft initial state;
//       approve — Gate 1 (draft→open): stamps gate_1 (authorization
//                 fingerprint computed by Code) + allocates attempt 1;
//       execute — open-period update: heartbeat/takeover/reallocate,
//                 body progress, result drafts; plan/scope frozen by C2.
//                 **The Gate 2 closure proposal travels through execute**:
//                 writing `## 结果` while keeping status=open is the only
//                 path into 「待批准关闭」 (awaiting_gate2) — close cannot be
//                 the first call that introduces that section;
//       close   — Gate 2 (open→closed): result+outcome, attempt 收口;
//       rebatch — C2 局部重批 (open→draft): attempt voided, gate_1
//                 dropped, evidence snapshot into change_log;
//       cancel  — draft→closed cancelled (计划未经执行即被取消);
//       revise  — draft→draft pre-Gate-1 evolution;
//       correct — closed→closed 终态**事实更正**（21 §9.2:259 / 03 §9.5 / §10):
//                 只重写正文 + 追加一条 change_log，终态判定与授权快照逐字不变；
//                 必须携带 Human 授权记录，缺之 fail-closed。
//
// Authorities: specs/05 §6 (operation declaration + common envelope),
// §9.3 (may_change_state), specs/03 §9 (controlled read/create/update,
// write-back read-back), specs/21 §14 (type-specific mechanical checks).
// Gate 1 / Gate 2 are Human Gates on the FLOW level — the mechanical layer
// stamps what was approved by the approver/controller identities the flow
// supplies; it never decides approval itself (21 §10).

import {
  createWorkcaseObject,
  readWorkcaseObject,
  approveWorkcaseObject,
  executeWorkcaseObject,
  closeWorkcaseObject,
  rebatchWorkcaseObject,
  cancelWorkcaseObject,
  reviseWorkcaseObject,
  correctWorkcaseObject,
  recordWorkcaseReview,
  recordWorkcaseAudit,
  requestWorkcaseAdjustment,
  decideWorkcaseAdjustment,
  listWorkcaseObjects,
  precheckWorkcaseCreate,
  bodyHasResultSection,
  REVIEW_SUMMARY_MAX_CHARS,
} from "./workcase-writer.js";
import { currentRouteValues, currentSessionIdentity } from "./session-signature.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { syncWorkcaseGoal, GOAL_WRITE_POINTS } from "./workcase-goals.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";
import { objectRef, objectRefOf } from "./object-reference.js";

const OPERATIONS = {
  "workcase-read-object": {
    toolName: "ldvh_workcase_read",
    summary: "Precise read of one WorkCase fact object by object_uid: frontmatter (incl. gate_1/attempt/result), body, mechanical issues and file fingerprint (specs/03 §9.2, specs/21 §13)",
    effect: "read"
  },
  "workcase-list-objects": {
    toolName: "ldvh_workcase_list",
    summary: "Enumerate WorkCase fact objects (F0/F1 discovery): title/status/serves/outcome projection for the governed project; draft+open by default, closed only with status=all (specs/03 §8, specs/21 §13)",
    effect: "read"
  },
  "workcase-precheck-create": {
    toolName: "ldvh_workcase_precheck_create",
    summary: "只读机械预检一份 WorkCase 创建候选：对候选 frontmatter_draft 与 body_markdown 跑**与受控创建完全相同的校验器**，返回 passed/failed/unverifiable、逐条 issues 与候选内容指纹；不落盘、不分配标识（specs/21 §14 create；与 06 §6.2 precheck-git-commit 同形——同一 validator 的两个入口）",
    effect: "read"
  },
  "workcase-write-object": {
    toolName: "ldvh_workcase_write",
    writeShaped: true,
    // `create` routes through the 21 §6.3 Human decision before it may proceed
    // (requestWorkcaseRouting), so this tool can block on a person. The
    // timeout budget is PER TOOL, not per action, so the whole tool must
    // declare no wall-clock deadline — otherwise every non-create action
    // silently pays for create's human wait. See the descriptor factory for
    // why a deadline here would guarantee a wrong result rather than a slow one.
    awaitsHumanDecision: true,
    summary: "Controlled write of WorkCase fact objects across the 工单 lifecycle: create (C1 提案, draft), approve (Gate 1: requires a covering pre-Gate-1 audit record — 时序闸+覆盖闸, 21 §14; stamps authorization fingerprint + attempt 1; returns plan_step_reference — the authoritative 「计划步骤 N」清单), execute (open-period update: attempt heartbeat/takeover/reallocate, 执行 progress, **and the Gate 2 closure PROPOSAL** — writing the `## 结果` section through execute with status kept `open` is what puts the case into 「待批准关闭」 (awaiting_gate2) and hands it back to Human — at that moment the host advance goal is **paused** (write point `propose_close`), so automatic continuation stops until Human rules; while in that period the 结果 section is FROZEN (workcase/result_proposal_frozen) and further execute calls may only leave it byte-identical; plan/scope frozen by C2), close (Gate 2: result+outcome, attempt 收口; requires at least one review recorded by a session OTHER than the executor, workcase-2be11478; **requires that the previously persisted body ALREADY carries `## 结果`** — a first-time 结果 section and the status flip may not be merged into one call, workcase/result_proposal_required, so the two-step order execute-then-close is mandatory and close is withheld until Human rules on the proposal), rebatch (C2 局部重批 open→draft), cancel (draft→closed cancelled), revise (draft evolution), correct (终态事实更正：仅 closed 对象，只重写正文并追加一条 change_log，终态判定与 result/reviews 逐字不变，须携带 Human 授权记录；21 §9.2:259 / 03 §10), record_review (append ONE review entry carrying the caller's Code-stamped session identity — the narrow channel for an isolated reviewer; 复核轴, open 期), record_audit (append ONE pre_reviews entry carrying the auditor's Code-stamped identity and the Code-computed candidate fingerprint — the narrow channel for an isolated pre-Gate-1 audit; 审核轴, draft 期, ≤3 per candidate) (specs/03 §9.4–§9.5, specs/21 §14). 写「执行」节时引用计划步骤请用「计划步骤 N」（21 §8 记账纪律）",
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

/**
 * 正文通道的**换行归一**（2026-10-19 建立，承 workcase-996e207a 三度落盘失败）。
 *
 * ## 为什么需要它
 *
 * 写路径（`executeWorkcaseObject` 等）把 `body_markdown_after` 当作**已成型的多行
 * markdown**：载体内聚校验要求 `frontmatter.scope` 逐字出现在正文「## 授权范围」节中，
 * 而正文节是按行切分的（`sectionContent`）。一旦正文折成一行，`## 授权范围` 不再是
 * 独占一行的 H2，`sectionContent` 取不到该节 → `carrier coherence: frontmatter scope
 * must appear verbatim` 拒绝写入。
 *
 * 实测（workcase-996e207a，2026-10-19）：同一份正确正文经**工具通道**进入时被拒，
 * 经**直接调用 writer** 进入时成功；把工具收到的字符串打出来，换行是字面量 `\n`
 * （反斜杠 + n）而不是 U+000A——即 multiline 在通道里被转义成了字面量。此时正文
 * 变成单行，H2 不再独占一行，故必然触发上述载体内聚失败。
 *
 * ## 处置范围（刻意保守）
 *
 * 只把**输入中不含真换行**且含字面量 `\n` 的字符串视为「被转义的正文」并还原。
 * 已含真换行的正常正文一律原样透传——避免把正文里合法出现的字面量 `\n`（例如描述
 * 某个转义序列的说明文字）误改成换行。
 *
 * 还原后仍须含 `## 摘要`：本函数只做形态还原，**不做静默修补**。还原仍不成形而
 * 返回 `null` 时，调用方按 `invalid_request` 拒绝并给出可操作说明——把一份形态不明
 * 的正文写进载体，比拒绝更危险。
 *
 * @returns {string|null} 归一后的正文，或 null（无法安全归一）
 */
export function normalizeBodyMarkdown(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  let body = value;
  if (!body.includes("\n") && body.includes("\\n")) {
    body = body.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  return body.includes("## 摘要") ? body : null;
}

/** 正文归一失败时的统一拒绝语（指名可操作处置，不静默修补）。 */
function bodyMarkdownInvalidRequest(action) {
  return invalidRequest(
    "workcase-write-object",
    `body_markdown_after must be the complete next body as multi-line markdown starting with '## 摘要' (no H1 — it is generated from title). `
    + `Received a value that does not contain the '## 摘要' heading even after un-escaping literal '\\n' — refusing to write a body whose shape cannot be verified (21 §8 载体内聚: frontmatter summary/scope 须逐字出现在正文同名节). `
    + `Pass the body as real newlines, not as an escaped one-line string.`,
    action,
  );
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
 * The authoritative SESSION IDENTITY of the calling session
 * (workcase-2be11478 计划步骤 2).
 *
 * 与 signatureFor 并列但语义不同：署名答「跑在哪个 provider/model 上」（路由值，
 * 同路由的多个会话相同），身份答「这是哪个会话」（会话记录首行的 id，会话间唯一）。
 * 关闭侧的身份比对用的是后者——前者无法区分复核者与实施者。
 *
 * 取不到时返回 null（不是占位值）：调用方据此让关闭门禁 fail-closed，而不是
 * 用一个猜的身份放行。
 */
async function sessionIdentityFor(deps, exec) {
  const identity = await currentSessionIdentity(deps.sessionPersistence?.(), exec?.agent);
  if (!identity.ok) return { ok: false, reason: identity.reason };
  // source: "host" —— 身份取自宿主执行上下文（exec.agent），不由参数/环境变量控制。
  const carrier = authoritativeSessionIdentity({ ...identity.value, source: "host" });
  if (carrier === null) return { ok: false, reason: "the session record carries no usable identity" };
  return { ok: true, value: carrier };
}

/**
 * Resolve a cited reviewer/auditor child to a record the caller cannot set.
 *
 * Source order (2026-10-18 「子代理登记表被清空」 修复 · 步骤 3):
 *   ① the in-memory child registry — the live observation, strongest evidence;
 *   ② the cited session's own record, through the registry's durable seam
 *      (lifecycle.js resolveChild → child-session-record.js). The registry is
 *      per-plugin-instance state and start() only re-adopts agents the host still
 *      lists as live, so after a plugin rebuild EVERY child that had already
 *      finished is invisible to ① — and a finished child is exactly what a
 *      review/audit record is about. Five isolated reviewers were lost that way on
 *      workcase-996e207a (record_review answered "not a subagent registered"
 *      while the reviewers' own session records sat on disk).
 *
 * Neither source is settable by the caller: ② re-establishes「是子代理」from the
 * header the host wrote and the delegation lineage from the calling session down.
 *
 * @returns {Promise<{available: boolean, child: object|null, source: string|null,
 *   reason: string|null}>} `available: false` means neither seam exists (the
 *   caller reports unavailable, as before); `child: null` with `available: true`
 *   means both were consulted and neither holds this id.
 */
async function resolveCitedChild(deps, childAgentId, exec) {
  const lookup = deps?.lookupChild;
  const resolveChild = deps?.resolveChild;
  if (typeof lookup !== "function" && typeof resolveChild !== "function") {
    return { available: false, child: null, source: null, reason: null };
  }
  const known = typeof lookup === "function" ? lookup(childAgentId) : null;
  if (known !== null && known !== undefined) {
    return { available: true, child: known, source: "registry", reason: null };
  }
  if (typeof resolveChild !== "function") {
    return { available: true, child: null, source: "registry", reason: null };
  }
  const parentSessionId = exec?.agent?.session?.header?.id;
  let resolved;
  try {
    resolved = await resolveChild(childAgentId, {
      parentSessionId: typeof parentSessionId === "string" && parentSessionId.length > 0 ? parentSessionId : undefined
    });
  } catch (error) {
    return {
      available: true,
      child: null,
      source: "session-record",
      reason: `the durable session-record lookup threw: ${String(error?.message ?? error)}`
    };
  }
  if (resolved?.ok === true && resolved.record !== null && resolved.record !== undefined) {
    return { available: true, child: resolved.record, source: resolved.source ?? "session-record", reason: null };
  }
  return {
    available: true,
    child: null,
    source: "session-record",
    reason: resolved?.reason ?? "the session record did not resolve to a subagent of this session"
  };
}

/**
 * 把一次受控写入与**本会话的宿主推进目标**对齐（specs/21 §14「宿主推进目标」）。
 *
 * 只在五个写入点生效（approve/execute 设置或恢复；close/cancel/rebatch 收口），
 * 由工具层在**调用 writer 之前**执行：失败即拒绝本次写入（fail-closed），不留
 * 下「对象前进了、目标没跟上」的半态。
 *
 * 目标文本须承载对象标识，故先做一次精确读取取标题——writer 内部也会读一次，
 * 这次多读的代价换的是「拒绝发生在写之前」。
 */
async function syncGoalForWrite({ deps, exec, action, factSourceRoot, objectUid, point = action }) {
  if (!GOAL_WRITE_POINTS.includes(point)) return { ok: true, action: "not-applicable", detail: {} };
  const read = await readWorkcaseObject({ factSourceRoot, objectUid });
  if (!read.ok) return { ok: true, action: "not-applicable", detail: { reason: "object unreadable; the writer reports it" } };
  return syncWorkcaseGoal({
    ctx: deps.goals === undefined ? undefined : { get: (key) => (key === "goals" ? deps.goals() : undefined) },
    agent: exec?.agent,
    point,
    objectUid,
    title: read.value.frontmatter.title,
  });
}

// ---------------------------------------------------------------------------
// read / list handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("workcase-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "workcase-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("workcase-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readWorkcaseObject({ factSourceRoot, objectUid });
  if (!read.ok) {
    const rejectedCodes = new Set(["workcase/invalid_uid", "workcase/object_not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("workcase-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "workcases") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;
  const issues = value.mechanical_issues;
  return envelope("workcase-read-object", issues.length === 0 ? "completed" : "partial", {
    result: {
      object_uid: fm.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: fm.title,
      status: fm.status,
      serves: fm.serves,
      outcome: fm.outcome,
      attempt_id: fm.attempt?.attempt_id,
      controller: fm.attempt?.controller,
      gate_1_fingerprint: fm.gate_1?.authorization_fingerprint,
      frontmatter: fm,
      body: value.body,
    },
    scope: {
      requested: objectUid,
      completed: [objectUid],
      not_completed: issues.length === 0 ? [] : ["mechanical-issues (see gaps)"],
    },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: issues,
    verification: { checks: ["frontmatter-parse", "closed-set", "field-invariants"], passed: issues.length === 0 },
    follow_up: [
      "gate_1.authorization_fingerprint mismatching the current plan+scope is a C2 invalidation — the only legal path is rebatch (21 §10.3)",
      "an attempt present without an active holder is an orphaned attempt: reconcile the side-effect scope BEFORE resuming or voiding (21 §10.4)",
    ]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("workcase-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object discovery serves governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const includeClosed = args?.status === "all";
  const limit = typeof args?.limit === "number" && Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 200;
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listWorkcaseObjects({ factSourceRoot, includeClosed, limit });
  if (!listed.ok) {
    return envelope("workcase-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "workcases") }],
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
  return envelope("workcase-list-objects", value.complete ? "completed" : "partial", {
    result: {
      count: value.items.length,
      total: value.complete ? value.items.length : value.total,
      filter: includeClosed ? "all" : "draft+open",
      items: value.items,
    },
    scope: {
      requested: "list",
      completed: value.complete ? ["list"] : [`first ${value.items.length} of ${value.total}`],
      not_completed: value.complete ? [] : [`${value.total - value.items.length} objects beyond the limit`],
    },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "workcases") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (21 §6.2) is a semantic comparison over title/summary/scope — performed by the AI on this projection, never by the tool",
      "workcase-read-object for the F3 full content of any candidate; recall does not imply authorization to resume (21 §13)",
    ]
  });
}

// ---------------------------------------------------------------------------
// precheck handler — 提请前的只读机械检查（21 §14 create）
//
// 次序纪律：本操作必须在**取得 Human 的路由答复之前**完成。理由不是礼节：
// 提请（及其审查）针对的是**那份**候选内容，若候选在机械上站不住，则 Human 的
// 答复落在一个从未成立的提案上——提问者与答问者围绕的不是同一件事。此前该
// 次序在实现中并不存在：create 分支先问、后校验再落盘（见本文件 create 分支）。
//
// 本操作**只读**：不落盘、不分配 object_uid、不写 change_log、不产生任何副作用，
// 故可对同一候选反复调用。它也不构成授权或 Human 确认的替代物。
// ---------------------------------------------------------------------------

async function executePrecheckCreate(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("workcase-precheck-create", "unavailable", {
      result: null,
      scope: { requested: "precheck", completed: [], not_completed: ["precheck"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: controlled operations serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const draft = args?.frontmatter_draft;
  const bodyMarkdown = args?.body_markdown;
  if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return invalidRequest(
      "workcase-precheck-create",
      "frontmatter_draft (object) and body_markdown (markdown starting with '## 摘要') are required — the precheck evaluates a candidate, so an absent candidate is nothing to check",
      "precheck",
    );
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const prechecked = await precheckWorkcaseCreate({ factSourceRoot, frontmatterDraft: draft, bodyMarkdown });
  if (!prechecked.ok) {
    return envelope("workcase-precheck-create", "unavailable", {
      result: null,
      scope: { requested: "precheck", completed: [], not_completed: ["precheck"] },
      sources: [],
      gaps: [`${prechecked.error.code}: ${prechecked.error.message}`],
      verification: { checks: ["mechanical-precheck"], passed: false },
      follow_up: []
    });
  }
  const value = prechecked.value;
  const outcome = value.mechanical_outcome;
  return envelope("workcase-precheck-create", outcome === "passed" ? "completed" : outcome === "failed" ? "rejected" : "partial", {
    result: {
      mechanical_outcome: outcome,
      candidate_fingerprint: value.candidate_fingerprint,
      issues: value.issues,
      ...(value.error_code === undefined ? {} : { error_code: value.error_code, error_message: value.error_message }),
      // 预检的**保证边界**随结果一并交还，避免调用方把 passed 读成「可以写入」。
      guarantee_boundary: [
        "passed 只说明该候选按已封闭定义的机械规则可写入，不说明它应当被写入",
        "不证明内容恰当、范围合适或 Human 会同意——内容是否可决属 Gate 1 与 Human 判断",
        "不构成授权凭据，也不替代 Human 的确认（21 §16）",
        "候选指纹只覆盖调用方提供的候选内容（frontmatter_draft + body_markdown），不含 Code 生成的 object_uid/created_at/change_log",
      ],
    },
    scope: { requested: "precheck", completed: ["precheck", "mechanical-checks"], not_completed: outcome === "passed" ? [] : ["mechanical-checks (see issues)"] },
    sources: [{ kind: "fact-source", path: join(factSourceRoot, "workcases"), note: "read-only: no file was written" }],
    gaps: value.issues,
    verification: { checks: ["governance-scope", "frontmatter-closed-set", "body-structure", "carrier-coherence", "serves-resolution"], passed: outcome === "passed" },
    follow_up: [
      "pass the returned candidate_fingerprint to ldvh_workcase_write(action=create) as expected_candidate_fingerprint — the write refuses when the content changes in between",
      "after a passed precheck the Human routing question may be asked (21 §6.3); a failed or unverifiable precheck must be reported, not routed",
    ]
  });
}

// ---------------------------------------------------------------------------
// write handler — the controlled actions of 21 §14
// ---------------------------------------------------------------------------

// This gate must list EXACTLY the actions the descriptor advertises (the
// `action` enum further down) — otherwise an action the spec defines and the
// schema publishes is refused by its own front-door check, and the channel is
// unreachable in every composition. That is what happened to
// request_adjustment / decide_adjustment (21 §14 增量审批): both handler
// branches existed and the enum listed them, but this Set omitted them, so
// `request_adjustment` failed closed for every caller — silently, since the
// rejection read like an unknown action rather than a broken gate.
// `tool-descriptor-contract.test.mjs` now pins the two lists together so the
// next omission cannot land unnoticed.
const WRITE_ACTIONS = new Set(["create", "approve", "execute", "close", "rebatch", "cancel", "revise", "correct", "record_review", "record_audit", "request_adjustment", "decide_adjustment"]);

/**
 * 21 §10.1 Gate 1 提请必含要素中**没有对象字段承载**的那几项。
 *
 * 其余三项（计划步骤与判据 / serves / scope 两向）已分别由 `plan`、
 * `serves`、`scope` 字段承载，故不在此重复要求。此处列出的四项在原实现
 * 中既无字段、也无校验——`独立复核的安排` 因此可被静默遗漏（本会话
 * WC-D `99957f65` 的实测实例）。
 *
 * 校验只覆盖「存在且非空」；内容是否恰当属 Human 判断（00 §4.2/§5）。
 */
const GATE1_REQUEST_KEYS = [
  "unauthorized_action_guard",
  "pre_creation_review",
  "independent_review",
  "unverified_scope_and_risks",
  "approved_scope_and_next",
];

// 21 §14 创建条目：「AI 只产出提案对象，含查重结果；Human 确认后经受控创建入口
// 落盘」——C1 提案对象模式。
//
// 2026-09-18 修订：此前该「Human 确认」只存在于规范文字里，受控入口仅校验提案
// 对象的字段合法性（status=draft、无 gate_1/attempt/result），因此「提案是否真被
// Human 确认过」在机械层无任何承载。第一版修补要求 AI 自填 `human_confirmation`
// 字符串——**那是伪保障**：AI 可自行编造，凭据真实性无从核验，与「拿到 Human 的
// 意图」不是一回事。
//
// 现行做法：经宿主询问入口 `ctx.userQuestions.ask` 真正取得 Human 的**路由选择**
// （Human 原话：「create 的时候没有拿到 human 是否创建 wc 的意图，就不能 create」）。
// 与 `ldvh_register_governed_project` 的 07 §5.6 consent 同形（ldvh-tools.js:636），
// 沿用同一 fail-closed 纪律：无答题器、询问失败、未作选择一律拒绝——静默不等于同意。
//
// 问的是**路由**（建工单 or 直接执行），不是**内容**：内容判断属 Gate 1
// （21 §10.1 提请必含计划与逐条判据），届时 Human 手上有完整对象。创建时追问内容
// 会要求 Human 做一个他还无从做出的判断，故本询问只承载「要不要以 WorkCase 承接」。
// 提示语与选项由 host-seams.js 的 requestWorkcaseRouting 构造（单一实现）。

/**
 * 从子代理的捕获结论中挑出可入账的复核概要（friction-7a64bbe2 例②）。
 *
 * 21 §8 要求 `reviews[].summary` 非空、≤600 字符，且至少承载判据七要素（对象／
 * 基线／方法／覆盖／未覆盖／发现／保证边界）。原实现取「首段」，而子代理收尾消息
 * 的首段常是过程话（"I've completed the review. Here's my summary..."），一个要素
 * 都不含——对象里于是留下一条「机械通过、实则无实质」的记录。
 *
 * 选取口径（全部是结论的**逐字子串**，不改写、不截断）：
 *   1. 按空行切段；在能装进 600 的段落里，取**含要素最多**者（同分取靠前者）；
 *   2. 没有段落含要素时，退化为第一个能装进 600 的段落；
 *   3. 一段都装不下 → 返回 null，由调用方 fail-closed 要求显式逐字概要。
 *
 * `labels` 参数（2026-10-28）：复核轴按 02 §16 七要素选段，审核轴按 21 §8 的三维
 * （对象恰当性／方案可行性／scope 清晰度）选段。此前 audit 通道未传本函数、只取
 * 首段，是 friction-7a64bbe2 例② 的同型漏修半边（过程话污染 summary），本次一并
 * 改走选段逻辑——缺省值保持七要素，既有复核侧行为不变。
 *
 * 导出供单元测试直接覆盖（该分支在集成路径上被身份校验挡在前面）。
 *
 * @param {string} conclusion 子代理捕获的结论全文
 * @param {string[]} [labels] 选段时计数的要素标签，缺省为复核七要素
 * @returns {string|null} 可入账的概要；无法自动选取时为 null
 */
export const REVIEW_SEVEN_LABELS = Object.freeze(["对象", "基线", "方法", "覆盖", "未覆盖", "发现", "保证边界"]);
export const AUDIT_THREE_LABELS = Object.freeze(["对象恰当性", "方案可行性", "scope 清晰度"]);

export function pickReviewSummary(conclusion, labels = REVIEW_SEVEN_LABELS) {
  const CAP = REVIEW_SUMMARY_MAX_CHARS;
  const text = typeof conclusion === "string" ? conclusion.trim() : "";
  if (text.length === 0) return null;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const fits = (p) => p.length <= CAP;
  const hits = (p) => labels.filter((label) => p.includes(label)).length;
  const withElements = paragraphs.filter((p) => fits(p) && hits(p) > 0);
  if (withElements.length > 0) return withElements.reduce((a, b) => (hits(b) > hits(a) ? b : a));
  return paragraphs.find(fits) ?? null;
}

/**
 * 把调用方提交的概要**锚回**子代理结论的原文字节区间（friction-b389a3bd）。
 *
 * 阻碍事实：校验方持有的是宿主登记表的**原始字节**，而摘录方唯一能读到的文本经过
 * 宿主渲染层——行尾空白、缩进与硬换行在那里看不出也复现不了（2026-10-18 实测「153
 * 条文本含行尾空白」，2026-10-19 现场「带缩进或硬换行就再失败一次」）。原实现要求
 * `conclusion.includes(summary)`，于是同一份忠实摘录被反复拒绝，调用方最终只能写入
 * 信息量极低的短串，审核记录退化。
 *
 * 口径：**空白（含换行、缩进）在判等中一律忽略**，非空白字符必须按原文顺序连续命中；
 * 命中后入账的是**原文自身的连续区间**（起止取首个与末个非空白字符）。故 21 §14
 * 「`summary` 须为子代理捕获结论的**逐字子串**」的字面不破——落盘文本确实是结论的
 * 字节级子串，父会话依旧改不动任何一个非空白字符（防代述不受削弱，被放宽的只有
 * 不可复现的空白形状）。
 *
 * 不放宽的部分如实声明：标点、用词、字符增删与顺序仍须逐字命中。探针把两处不相邻
 * 原文拼成一段时命中的是**覆盖两者及其间原文的完整区间**——落盘的多出的一段仍是审计
 * 者自己的原文（长度由调用方上限兜住），拼不进父会话的字，故不构成代述通道。
 *
 * 长度上限**不在本函数判定**（超限区间交由调用方按各自的字段上限报告，以免把
 * 「装不下」误报成「无出处」）。
 *
 * @param {string} conclusion 子代理捕获的结论全文（原文）
 * @param {string} excerpt 调用方按可见形态截取的概要
 * @returns {{text: string, start: number, end: number} | null} 原文区间；无法锚定时 null
 */
export function anchorConclusionExcerpt(conclusion, excerpt) {
  if (typeof conclusion !== "string" || typeof excerpt !== "string") return null;
  const src = stripWhitespaceWithMap(conclusion);
  const probe = stripWhitespaceWithMap(excerpt);
  if (src.norm.length === 0 || probe.norm.length === 0) return null;
  const at = src.norm.indexOf(probe.norm);
  if (at < 0) return null;
  const start = src.map[at].start;
  const end = src.map[at + probe.norm.length - 1].end;
  return { text: conclusion.slice(start, end), start, end };
}

/**
 * 丢弃全部空白字符，并为每个保留字符登记其在原文中的起止索引（`map[i]` 与
 * `norm[i]` 一一对应）。返回的 norm 用于比对，map 用于把命中位置映回原文区间。
 */
function stripWhitespaceWithMap(text) {
  let norm = "";
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    norm += text[i];
    map.push({ start: i, end: i + 1 });
  }
  return { norm, map };
}

function requireString(args, key, action) {
  const v = args?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (!WRITE_ACTIONS.has(action)) {
    return invalidRequest("workcase-write-object", `action must be one of ${[...WRITE_ACTIONS].join("|")}; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("workcase-write-object", "unavailable", {
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
    return envelope("workcase-write-object", "unavailable", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`signature_unavailable: the authoritative provider/model could not be read from the DSH session record (${sig.reason}). `
        + "REFUSE to write an unsigned change_log entry; REPORT TO HUMAN — this write cannot be signed and must not be recorded as a stable fact."],
      verification: { checks: ["governance-scope", "signature-source"], passed: false },
      follow_up: ["human must resolve the session signature source, then retry"]
    });
  }
  // 会话身份（workcase-2be11478 计划步骤 2）：与署名并列、语义不同，见 sessionIdentityFor。
  // 取不到时 ident.ok 为 false，但**不在此处拒绝**——身份只在需要它的 action
  // （approve/execute/record_review）与关闭门禁上起作用；read 类 action 不依赖它。
  // 各 action 分支按需 fail-closed，避免把身份缺失升级成整个写入面不可用。
  const ident = await sessionIdentityFor(deps, exec);

  // 宿主推进目标（specs/21 §14「宿主推进目标」，接入形态见 specs/10 §5.8）：
  // 五个写入点须与本会话的宿主目标保持一致，且**在写入之前**判定——
  // 服务不可用、取不到本会话 agent、或当前目标指向**另一对象**时一律拒绝本次写入
  // （fail-closed）。拒绝发生在 writer 之前，故不会留下「对象前进了、目标没跟上」
  // 的半态；收口点遇「本无目标」是 none 而非失败（目标可能已由 Human 清除）。
  let goalSync = { ok: true, action: "not-applicable", detail: {} };
  if (action === "close") {
    // close 是「待批准关闭」期的**结束**写入点：`propose_close` 把推进目标暂停了，
    // 若在 close 之前仍按「设置点」重新武装，就会在 Human 已作出判定的当次写入里
    // 先重新点燃自动续轮、再关闭——两次目标操作互相抵消，且中间那一瞬是错的。
    // 故 close 先**解除暂停**（resume 到 active，不 complete：complete 是不可恢复的
    // 终态，若随后的关闭写入失败，目标就再也武装不回来），writer 成功后由
    // `settleGoalAfterClose` 收口到 complete。
    const goalUid = requireString(args, "object_uid", action);
    if (goalUid !== null) {
      goalSync = await syncGoalForWrite({ deps, exec, action, point: "approve", factSourceRoot, objectUid: goalUid });
      if (!goalSync.ok) {
        return envelope("workcase-write-object", "rejected", {
          result: { goal: { ok: false, code: goalSync.code, message: goalSync.message } },
          scope: { requested: action, completed: [], not_completed: [goalUid] },
          sources: [{ kind: "host-service", path: "goals" }],
          gaps: [`${goalSync.code}: ${goalSync.message}`],
          verification: { checks: ["governance-scope", "signature-source", "host-goal-consistency"], passed: false },
          follow_up: [
            "resolve the host goal conflict or make the goals service available, then retry — the object was NOT written"
          ]
        });
      }
    }
  } else if (action !== "execute" && GOAL_WRITE_POINTS.includes(action)) {
    // execute 不在此列：它的写入点**按目的分岔**（本次正文首次带上「## 结果」节
    // ⇒ `propose_close`，否则 `execute`），判据需要读正文，只有 execute 分支内部
    // 才知道。若在此按 `point = action = "execute"` 先武装／恢复一次，随后分支内的
    // `propose_close` 暂停会在同一次调用里被前一跳抵消——待批准关闭期的目标暂停
    // 将静默失效（2026-10-19 实测复现：落盘结果节后目标仍为 active/armed）。
    const goalUid = requireString(args, "object_uid", action);
    if (goalUid !== null) {
      goalSync = await syncGoalForWrite({ deps, exec, action, factSourceRoot, objectUid: goalUid });
      if (!goalSync.ok) {
        return envelope("workcase-write-object", "rejected", {
          result: { goal: { ok: false, code: goalSync.code, message: goalSync.message } },
          scope: { requested: action, completed: [], not_completed: [goalUid] },
          sources: [{ kind: "host-service", path: "goals" }],
          gaps: [`${goalSync.code}: ${goalSync.message}`],
          verification: { checks: ["governance-scope", "signature-source", "host-goal-consistency"], passed: false },
          follow_up: [
            "resolve the host goal conflict or make the goals service available, then retry — the object was NOT written"
          ]
        });
      }
    }
  }

  let result;
  if (action === "create") {
    const draft = args?.frontmatter_draft;
    const bodyMarkdown = args?.body_markdown;
    if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
      return invalidRequest("workcase-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 摘要') are required for action=create", "create");
    }
    // 次序纪律（21 §14 create）：**先做提请前的只读机械检查，通过后再提请**。
    //
    // 此前该次序在实现中并不存在——路由询问在前，校验与落盘在后，故机械上站不住
    // 的候选同样会被呈到 Human 面前，Human 的答复可能落在一个从未成立的提案上。
    // 这不是「多一层礼貌」：提请与其审查针对的是**那份**候选内容，提问者与答问者
    // 必须围绕同一件事。
    //
    // 与 06 §6.2 precheck-git-commit 同形：同一 validator 的两个入口——预检在此处
    // 返回结构化结果，受控写入在真实写入时由同一实现再执行一次。
    const prechecked = await precheckWorkcaseCreate({ factSourceRoot, frontmatterDraft: draft, bodyMarkdown });
    if (!prechecked.ok) {
      return envelope("workcase-write-object", "unavailable", {
        result: null,
        scope: { requested: "create", completed: [], not_completed: ["create"] },
        sources: [],
        gaps: [`${prechecked.error.code}: ${prechecked.error.message}`],
        verification: { checks: ["governance-scope", "pre-mechanical-check"], passed: false },
        follow_up: []
      });
    }
    if (prechecked.value.mechanical_outcome !== "passed") {
      const v = prechecked.value;
      return envelope("workcase-write-object", "rejected", {
        result: null,
        scope: { requested: "create", completed: ["pre-mechanical-check"], not_completed: ["create"] },
        sources: [],
        gaps: [
          `pre-submission mechanical check did not pass (${v.mechanical_outcome}${v.error_code === undefined ? "" : `: ${v.error_code}`}) — the candidate must be fixed or reported before it is put in front of the Human`,
          ...v.issues,
          ...(v.error_message === undefined ? [] : [v.error_message]),
        ],
        verification: { checks: ["governance-scope", "pre-mechanical-check"], passed: false },
        follow_up: [
          "fix the reported items, then re-run — a candidate that fails mechanical checks must not be routed to the Human",
          "21 §6.3 routing asks whether to carry this work as a WorkCase; it is asked only once the candidate mechanically stands",
        ]
      });
    }
    // 提请与写入之间候选内容必须保持一致：写入侧比对指纹，不一致即拒绝。
    // 否则 Human 之所见与所落不是同一物。
    //
    // 取调用方**显式提供**的指纹优先：它记录了「另一次预检调用所检查的那份内容」，
    // 而这里的内部预检只记录了「本次调用所检查的那份」。二者相同时结论一致；不同
    // 时说明调用方依据的是一次**针对别的候选**的预检——那正是必须被拦下的情形，
    // 故不能静默以内部值覆盖调用方的声明（覆盖会让跨调用的指纹比对变成空转，
    // 参数存在却永不被消费）。
    const providedFingerprint = requireString(args, "expected_candidate_fingerprint", "create");
    const candidateFingerprint = providedFingerprint ?? prechecked.value.candidate_fingerprint;
    // 21 §14 C1 / §6.3：创建前须经宿主询问入口取得 Human 的**路由选择**。
    // 这不是「AI 声明问过了」，而是 Human 本人的答复由宿主记录；拿不到即拒绝。
    // 无答题器 → fail-closed（静默不等于同意），与 07 §5.6 consent 同纪律。
    const gate = deps?.hostSeams;
    if (gate === undefined || typeof gate.requestWorkcaseRouting !== "function") {
      return envelope("workcase-write-object", "unavailable", {
        result: null,
        scope: { requested: "create", completed: ["pre-mechanical-check"], not_completed: ["create"] },
        sources: [],
        gaps: ["ctx.userQuestions.ask is not wired into this composition, so the 21 §6.3 routing decision "
          + "cannot be obtained. 21 §14 C1 requires the Human's explicit confirmation before creation; "
          + "REPORT TO HUMAN — an un-routed candidate must not silently become an object."],
        verification: { checks: ["governance-scope", "pre-mechanical-check", "human-routing"], passed: false },
        follow_up: ["human must decide whether to carry this work as a WorkCase, then retry"]
      });
    }
    const routing = await gate.requestWorkcaseRouting({
      request: args?.routing_request ?? null,
      rationale: args?.routing_rationale ?? null,
      // The host forwarder reaches the browser answerer only when the request
      // carries the live agent (dsh-api-remotes/lib/index.js:115-119); without
      // it the waterfall exhausts to NO_PROVIDER in real compositions.
      agent: exec?.agent,
      // This ask has no wall-clock deadline (see `awaitsHumanDecision` in
      // OPERATIONS): the caller's signal is the only release for an abandoned
      // prompt, and forwarding it makes the ask abort (ASK_ABORTED) rather
      // than hang.
      signal: exec?.signal,
      // 21 §6.3 先读后问：候选指纹就是「这个问题」的身份。同一候选的重试复用
      // 既有答复而**不再提问**——这正是「同一件事问两次」的机械封堵点。
      // 它取自本候选内容（与写入侧比对用的是同一个值），不是会话或时间。
      candidateKey: candidateFingerprint,
    });
    if (routing.granted !== true) {
      return envelope("workcase-write-object", "rejected", {
        result: null,
        scope: { requested: "create", completed: ["pre-mechanical-check"], not_completed: ["create"] },
        sources: [],
        gaps: [`21 §6.3/§14 C1 requires an explicit Human routing decision: ${routing.reason}`],
        verification: { checks: ["governance-scope", "pre-mechanical-check", "human-routing"], passed: false },
        // 路由到「直接执行」是合法结论，不是错误：此时不应创建对象，
        // 而应在当次行动内处理（21 §6.3 不对象化）。
        follow_up: routing.routedTo === "direct"
          ? ["handle the work directly in this action — do not create a WorkCase object (21 §6.3)"]
          : ["obtain the Human's routing decision, then retry"]
      });
    }
    result = await createWorkcaseObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.value,
      expectedCandidateFingerprint: candidateFingerprint,
    });
  } else {
    // All remaining actions are CAS-guarded transitions on an existing object.
    const objectUid = requireString(args, "object_uid", action);
    const expectedFingerprint = requireString(args, "expected_fingerprint", action);
    if (objectUid === null) return invalidRequest("workcase-write-object", `object_uid is required for action=${action}`, action);
    if (expectedFingerprint === null) return invalidRequest("workcase-write-object", `expected_fingerprint is required for action=${action} (CAS baseline — from your last precise read)`, action);
    const changeSummary = requireString(args, "change_summary", action);
    if (changeSummary === null) return invalidRequest("workcase-write-object", `change_summary (one short semantic summary for the change_log entry) is required for action=${action}`, action);

    if (action === "approve") {
      const approver = requireString(args, "approver", action);
      const controller = requireString(args, "controller", action);
      if (approver === null || controller === null) {
        return invalidRequest("workcase-write-object", "approver (the approving Human identity) and controller (the executing controller identity) are required for action=approve — Gate 1 stamps them into gate_1/attempt (21 §10.1/§10.4)", "approve");
      }
      // 21 §10.1: the Gate 1 request MUST contain the elements that no object
      // field carries. plan/serves/scope are already fields, so they are not
      // re-demanded here; the rest had NO carrier at all, which is how the
      // 独立复核安排 requirement was silently omitted (Friction recorded
      // 2026-09-16). Mechanical check is presence + non-empty only — whether
      // the content is adequate stays with the Human (00 §4.2/§5).
      const gate1Request = args?.gate1_request;
      const missing = GATE1_REQUEST_KEYS.filter((key) => (
        typeof gate1Request?.[key] !== "string" || gate1Request[key].trim().length === 0
      ));
      if (missing.length > 0) {
        return invalidRequest(
          "workcase-write-object",
          `gate1_request is required for action=approve and must carry a non-empty string for each element (21 §10.1 提请必含; missing: ${missing.join(", ")}). These are the Gate 1 request elements with NO object-field carrier — omitting them would let an undeclared Gate 1 pass silently.`,
          "approve",
        );
      }
      result = await approveWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, approver, controller, changeSummary, sessionSignature: sig.value, sessionIdentity: ident.value });
    } else if (action === "execute") {
      const frontmatterAfter = args?.frontmatter_after;
      const bodyMarkdownAfter = normalizeBodyMarkdown(args?.body_markdown_after);
      if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || args?.body_markdown_after === undefined) {
        return invalidRequest("workcase-write-object", "frontmatter_after (object) and body_markdown_after (the full next body starting with '## 摘要') are required for action=execute", "execute");
      }
      if (bodyMarkdownAfter === null) return bodyMarkdownInvalidRequest("execute");
      const attemptOperation = args?.attempt_operation ?? "heartbeat";
      const newController = typeof args?.new_controller === "string" && args.new_controller.length > 0 ? args.new_controller : null;
      // 写入点按**目的**分岔（21 §8「待批准关闭」期）：本次正文若首次带上「## 结果」
      // 节，这次调用就是**提交关闭提案**，宿主目标随之暂停（`propose_close`）；
      // 否则仍是执行期推进，目标保持武装（`execute`）。判据在写入侧同函数
      // `bodyHasResultSection`，比较基线是上一次落盘正文——调用方自证不了「上次已有」。
      const priorRead = await readWorkcaseObject({ factSourceRoot, objectUid });
      const willProposeClosure = priorRead.ok
        && !bodyHasResultSection(priorRead.value.body ?? "")
        && bodyHasResultSection(bodyMarkdownAfter);
      if (willProposeClosure) {
        goalSync = await syncGoalForWrite({ deps, exec, action, point: "propose_close", factSourceRoot, objectUid });
      } else {
        // 执行期推进：目标保持武装。仍须走一次一致性检查（目标服务不可用、取不到
        // 本会话 agent、或目标指向另一对象时 fail-closed），否则「目标指向他单却照
        // 写本单」的半态会从这条路径溜过去——两条分岔都必须判定，只是写入点不同。
        goalSync = await syncGoalForWrite({ deps, exec, action, point: "execute", factSourceRoot, objectUid });
      }
      if (!goalSync.ok) {
        return envelope("workcase-write-object", "rejected", {
          result: { goal: { ok: false, code: goalSync.code, message: goalSync.message } },
          scope: { requested: action, completed: [], not_completed: [objectUid] },
          sources: [{ kind: "host-service", path: "goals" }],
          gaps: [`${goalSync.code}: ${goalSync.message}`],
          verification: { checks: ["governance-scope", "signature-source", "host-goal-consistency"], passed: false },
          follow_up: [
            "resolve the host goal conflict or make the goals service available, then retry — the object was NOT written"
          ]
        });
      }
      result = await executeWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary, attemptOperation, newController, sessionSignature: sig.value, sessionIdentity: ident.value });
    } else if (action === "close") {
      const outcome = args?.outcome;
      const resultPayload = args?.result;
      const bodyMarkdownAfter = normalizeBodyMarkdown(args?.body_markdown_after);
      if (typeof outcome !== "string" || typeof resultPayload !== "object" || resultPayload === null || args?.body_markdown_after === undefined) {
        return invalidRequest("workcase-write-object", "outcome, result ({criteria_checks[], achieved_scope, residual[]}) and body_markdown_after (including the 结果 section) are required for action=close — Gate 2 (21 §10.2)", "close");
      }
      if (bodyMarkdownAfter === null) return bodyMarkdownInvalidRequest("close");
      result = await closeWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, outcome, result: resultPayload, changeSummary, bodyMarkdownAfter, sessionSignature: sig.value });
      // 「待批准关闭」期到此结束：把先前解除的暂停收口为 complete（21 §14 收口点）。
      // 放在 writer **之后**：关闭写入失败时目标必须仍停在暂停态，否则一次失败的
      // 关闭会顺带把工单重新推回自动续轮。
      if (result.ok && result.value?.gate_2?.awaiting_gate2_closed === true) {
        goalSync = await syncGoalForWrite({ deps, exec, action: "close", point: "close", factSourceRoot, objectUid });
      }
    } else if (action === "rebatch") {
      const frontmatterAfter = args?.frontmatter_after;
      const bodyMarkdownAfter = normalizeBodyMarkdown(args?.body_markdown_after);
      if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || bodyMarkdownAfter === null) {
        return invalidRequest("workcase-write-object", "frontmatter_after (the revised draft fields) and body_markdown_after (the revised 摘要/授权范围/计划 body) are required for action=rebatch — change_summary must carry 重批原因 + 当时核对快照结论 (21 §9.2)", "rebatch");
      }
      result = await rebatchWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature: sig.value });
    } else if (action === "cancel") {
      const resultPayload = args?.result;
      const bodyMarkdownAfter = normalizeBodyMarkdown(args?.body_markdown_after);
      if (typeof resultPayload !== "object" || resultPayload === null || bodyMarkdownAfter === null) {
        return invalidRequest("workcase-write-object", "result ({achieved_scope: 取消理由与未发生的范围}) and body_markdown_after (including the 结果 section) are required for action=cancel (21 §9.2)", "cancel");
      }
      result = await cancelWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, result: resultPayload, changeSummary, bodyMarkdownAfter, sessionSignature: sig.value });
    } else if (action === "request_adjustment") {
      // 增量审批·申请（21 §14 乙档）：只登记待批条目，不触碰 plan/scope，也不产生授权。
      const items = args?.items;
      const rationale = args?.rationale;
      if (!Array.isArray(items) || items.length === 0 || typeof rationale !== "string" || rationale.trim().length === 0) {
        return invalidRequest("workcase-write-object", "items ([{step, done_criteria}]) and rationale are required for action=request_adjustment — 申请须写明要追加什么、以及为什么不做它就达不成已批判据（21 §14）", "request_adjustment");
      }
      result = await requestWorkcaseAdjustment({ factSourceRoot, objectUid, expectedFingerprint, items, rationale, changeSummary, sessionSignature: sig.value });
    } else if (action === "decide_adjustment") {
      // 增量审批·决定（Human Gate；21 §14）：批准则追加 plan/scope 并重算授权指纹，
      // attempt 与 reviews 一概不动（这正是与「局部重批」的根本差别）。
      const decision = args?.adjustment_decision;
      const by = args?.by;
      const humanAuthorization = args?.human_authorization;
      if ((decision !== "approved" && decision !== "rejected") || typeof by !== "string" || by.trim().length === 0) {
        return invalidRequest("workcase-write-object", "adjustment_decision (\"approved\" | \"rejected\") and by (决定者身份) are required for action=decide_adjustment (21 §14)", "decide_adjustment");
      }
      if (typeof humanAuthorization !== "string" || humanAuthorization.trim().length === 0) {
        return invalidRequest("workcase-write-object", "human_authorization is required for action=decide_adjustment — 本通道在执行期实时扩大授权，须给出 Human 的授权记录（谁／何时／覆盖什么），缺之 fail-closed（与 correct 同规格；21 §14）", "decide_adjustment");
      }
      result = await decideWorkcaseAdjustment({ factSourceRoot, objectUid, expectedFingerprint, decision, by, humanAuthorization, bodyMarkdownAfter: normalizeBodyMarkdown(args?.body_markdown_after), changeSummary, sessionSignature: sig.value, sessionIdentity: ident.value });
    } else if (action === "record_review") {
      // 复核结论回传通道（workcase-2be11478 计划步骤 4）：只追加一条 reviews 条目，
      // 不授予任何其它写能力。
      //
      // 唯一合法入口（Human 决定 2026-10-09；04 §7.3 承载形式唯一化）：由父会话
      // **代其受管辖隔离子代理**回传：指定 `reviewer_child_agent_id`，此时身份与结论
      // 都取自宿主登记表（Code 亲观测），见下方子分支。此前另一受管辖根会话亦可作
      // 入口，本调用方即该根会话；该入口已移除——同编排下的另一会话不满足 04 §7.3
      // 的上下文隔离要求。
      // 子代理自身不注册 ldvh_* 工具（lifecycle.js 的 origin==="subagent" 分支），
      // 故本入口是「开启代理做独立审核」在机械上可行的路径。
      const childAgentId = requireString(args, "reviewer_child_agent_id", action);
      let summary = requireString(args, "summary", action);
      let reviewerIdentity = ident.value;
      let reviewerChildNote = null;
      if (childAgentId !== null) {
        // 代子代理回传：身份取自宿主登记表（调用方**不可设置**），结论取子代理
        // **真实产出的最终文本**（Code 在 turn-end 捕获）——故实施者既不能伪造
        // 身份，也不能把自查文本冒充成子代理的结论。
        const cited = await resolveCitedChild(deps, childAgentId, exec);
        if (cited.available !== true) {
          return envelope("workcase-write-object", "unavailable", {
            result: null,
            scope: { requested: action, completed: [], not_completed: [action] },
            sources: [],
            gaps: ["review_channel_unavailable: the host does not expose the subagent registry, so a delegated "
              + "review cannot be attributed to the reviewer's own session. Report to HUMAN — do not substitute the "
              + "implementer's own summary for the reviewer's conclusion."],
            verification: { checks: ["governance-scope", "session-identity"], passed: false },
            follow_up: ["human must enable the subagent registry seam, then retry"],
          });
        }
        const child = cited.child;
        if (child === null) {
          return invalidRequest("workcase-write-object",
            `reviewer_child_agent_id ${JSON.stringify(childAgentId)} is not a subagent registered under this session — `
            + "only a session the host actually observed may be cited as the reviewer"
            + (cited.reason === null ? "" : `; the durable session-record lookup also failed: ${cited.reason}`), "record_review");
        }
        if (typeof child.conclusion !== "string" || child.conclusion.trim().length === 0) {
          return invalidRequest("workcase-write-object",
            `subagent ${childAgentId} has produced no captured conclusion yet — there is nothing to record as its review. `
            + "Wait for it to finish its turn, then retry (an empty conclusion is a real state, not a review).", "record_review");
        }
        // 结论文本以子代理的真实产出为准。21 §8 要求 reviews[].summary ≤ 600 字符，
        // 且「复核详情不入对象」（归会话 transcript）；而子代理的 captured conclusion
        // 是它的**最终正文全文**，通常远超 600 —— 直接采用会被上限拒绝，使通道对真实
        // 复核不可用（本单实测：一份七要素结论 672 字符即被拒）。
        //
        // 故：调用方只能提供**概要**（≤600），而该概要必须是子代理结论的**逐字子串**
        // ——既保证概要有出处（不被父会话自由改写），又让全文留在 transcript 里，与
        // §8 分工一致。省略 summary 时按要素选段，选不出则要求调用方指明概要。
        //
        // 比对口径（friction-b389a3bd，2026-10-28）：原实现要求 `conclusion.includes(summary)`
        // 的**字节精确**匹配，但校验方持有的是登记表原始字节、摘录方只能读到经宿主渲染的
        // 文本（行尾空白与缩进看不出也复现不了），忠实摘录因此被反复拒绝、记录退化。现改为
        // `anchorConclusionExcerpt`：**空白形状不参与判等**，非空白字符须按原文顺序连续命中，
        // 入账取**原文自身的字节区间**——21 §14「逐字子串」的字面因此不破，防代述不受削弱。
        const conclusion = child.conclusion.trim();
        if (summary !== null) {
          const anchored = anchorConclusionExcerpt(conclusion, summary);
          if (anchored === null) {
            return invalidRequest("workcase-write-object",
              "the supplied summary is not an excerpt of the reviewer subagent's captured conclusion — the "
              + "recorded summary must be traceable to what the reviewer actually produced, not rewritten by the parent "
              + "session (防「代述」冒充). Pass a span of its conclusion text verbatim apart from whitespace shape "
              + "(leading/trailing and in-line whitespace is tolerated; wording, punctuation and order are not). "
              + "The full text stays in the transcript, per 21 §8 复核详情不入对象.", "record_review");
          }
          summary = anchored.text;
        } else {
          // **省略 summary 时取哪一段**（friction-7a64bbe2 例②）。
          //
          // 原实现取「首段」（`split(/\n\s*\n/)[0]`），实测录得的是子代理的过程话
          // （"I've completed the incremental review. Here's my final summary..."）——
          // 21 §8 要求 summary 承载**判据七要素**（对象/基线/方法/覆盖/未覆盖/发现/
          // 保证边界），而过程话一个要素都不含，于是对象里留下一条看似「机械通过」、
          // 实则没有任何复核实质的记录。
          //
          // 修正口径见 pickReviewSummary 的文档注释（原则：优先取承载七要素的段落，
          // 不按位置取首段；一段都装不下则 fail-closed，绝不截断）。
          const picked = pickReviewSummary(conclusion);
          if (picked === null) {
            return invalidRequest("workcase-write-object",
              "the reviewer subagent's conclusion cannot be recorded automatically: it is longer than the 600-char "
              + "reviews[].summary cap (21 §8) and no single paragraph of it fits. The full text belongs in the "
              + "transcript (复核详情不入对象); pass `summary` as an excerpt (≤600 chars, whitespace shape tolerated) carrying the 02 §16 "
              + "seven elements. Refusing rather than truncating: a silently truncated conclusion would read as complete.",
              "record_review");
          }
          summary = picked;
        }
        reviewerIdentity = authoritativeSessionIdentity({ sessionId: child.sessionId, source: "host", origin: "subagent" });
        if (reviewerIdentity === null) {
          return invalidRequest("workcase-write-object", `subagent ${childAgentId} carries no usable session identity`, "record_review");
        }
        reviewerChildNote = childAgentId;
      } else {
        // 承载形式唯一化（Human 决定 2026-10-09；04 §7.3 独立复核唯一形式）：
        // 独立复核只承认受管辖隔离子代理（独立上下文）一种承载，由父会话以
        // `reviewer_child_agent_id` 回传。此前另一受管辖根会话亦可作入口(本调用方
        // 即该根会话)，但同编排下的另一会话不满足 04 §7.3 的上下文隔离要求。
        //
        // 此处 fail-closed 而非降级放行：按 00 §5.7 停止并报告，保持 open 交还 Human，
        // 不得以主控自查或本调用方自身文本冒充独立复核（02 §16 三形态互不替代）。
        return invalidRequest("workcase-write-object",
          "record_review now requires `reviewer_child_agent_id`: 独立复核的唯一承载形式是受管辖隔离子代理（独立上下文，04 §7.3）。"
          + "未提供子代理 id 时本调用方将以自身会话身份盖戳，产出的是主控自查而非独立复核——按 00 §5.7 停止并报告，"
          + "不得以自查冒充。请派一个隔离子代理做独立复核（须后台派生以取得其 agent_id），完成后以 `reviewer_child_agent_id` 回传；"
          + "若无法创建子代理或 id 不可回传，保持 open 交还 Human，不要关闭。",
          "record_review",
        );
      }
      if (summary === null) {
        return invalidRequest(
          "workcase-write-object",
          "summary (the review conclusion, ≤600 chars, carrying the 02 §16 seven elements: 对象/基线/方法/覆盖/未覆盖/发现/保证边界) is required for action=record_review",
          "record_review",
        );
      }
      if (!ident.ok) {
        return envelope("workcase-write-object", "unavailable", {
          result: null,
          scope: { requested: action, completed: [], not_completed: [action] },
          sources: [],
          gaps: [`review_identity_unavailable: the caller's authoritative session identity could not be read from the DSH session record (${ident.reason}). `
            + "This channel exists precisely so that WHO recorded a review is proven by Code, not asserted by a caller — "
            + "recording without it would make an implementer's self-check indistinguishable from an independent review "
            + "(workcase-2be11478). REPORT TO HUMAN: run the review from a DSH shell/session whose session log is readable, then retry."],
          verification: { checks: ["governance-scope", "signature-source", "session-identity"], passed: false },
          follow_up: ["human must ensure the reviewing session's authoritative record is readable, then retry"]
        });
      }
      result = await recordWorkcaseReview({
        factSourceRoot, objectUid, expectedFingerprint, summary,
        changeSummary, sessionSignature: sig.value, sessionIdentity: reviewerIdentity,
        reviewerNote: reviewerChildNote === null ? null : `记录自子代理会话 ${reviewerChildNote} 的最终产出（Code 捕获）`,
      });
    } else if (action === "record_audit") {
      // 建前审核结论回传通道（21 §14「建前审核记录」，2026-10-16 建立）：
      // 只追加一条 pre_reviews 条目，不授予任何其它写能力。
      //
      // **与 record_review 完全同构**——两轴的差异只有一处：本通道只对
      // status=draft 开放（审核轴的对象是尚未取得效力的候选），而 record_review
      // 只对 open 开放。不可自证性的要求、身份来源可信边界、防代述门禁、
      // 派生纪律全部相同，理由见 record_review 分支上方注释与 21 §14。
      const childAgentId = requireString(args, "auditor_child_agent_id", action);
      const verdict = requireString(args, "verdict", action);
      let summary = requireString(args, "summary", action);
      let auditorIdentity = ident.value;
      let auditorChildNote = null;
      if (childAgentId !== null) {
        // 代子代理回传：身份取自宿主登记表（调用方**不可设置**），结论取子代理
        // **真实产出的最终文本**（Code 在 turn-end 捕获）——故实施者既不能伪造
        // 身份，也不能把自查文本冒充成子代理的审核结论。
        const citedAudit = await resolveCitedChild(deps, childAgentId, exec);
        if (citedAudit.available !== true) {
          return envelope("workcase-write-object", "unavailable", {
            result: null,
            scope: { requested: action, completed: [], not_completed: [action] },
            sources: [],
            gaps: ["audit_channel_unavailable: the host does not expose the subagent registry, so a delegated "
              + "audit cannot be attributed to the auditor's own session. Report to HUMAN — do not substitute the "
              + "implementer's own summary for the auditor's conclusion."],
            verification: { checks: ["governance-scope", "session-identity"], passed: false },
            follow_up: ["human must enable the subagent registry seam, then retry"],
          });
        }
        const child = citedAudit.child;
        if (child === null) {
          return invalidRequest("workcase-write-object",
            `auditor_child_agent_id ${JSON.stringify(childAgentId)} is not a subagent registered under this session — `
            + "only a session the host actually observed may be cited as the auditor"
            + (citedAudit.reason === null ? "" : `; the durable session-record lookup also failed: ${citedAudit.reason}`), "record_audit");
        }
        if (typeof child.conclusion !== "string" || child.conclusion.trim().length === 0) {
          return invalidRequest("workcase-write-object",
            `subagent ${childAgentId} has produced no captured conclusion yet — there is nothing to record as its audit. `
            + "Wait for it to finish its turn, then retry (an empty conclusion is a real state, not an audit).", "record_audit");
        }
        // 结论文本以子代理的真实产出为准：调用方只能提供**概要**（≤600），且该概要
        // 必须是子代理结论的**逐字子串**——既保证概要有出处（不被父会话自由改写），
        // 又让全文留在 transcript 里（21 §8「审核详情不入对象」）。
        // 比对口径同 `record_review`（friction-b389a3bd：空白形状不参与判等、入账取原文
        // 字节区间）；省略 summary 时的选段口径亦同（friction-7a64bbe2 例② 的 audit 半边，
        // 按 21 §8 的三维——对象恰当性／方案可行性／scope 清晰度——选段，不按位置取首段）。
        const conclusion = child.conclusion.trim();
        if (summary !== null) {
          const anchored = anchorConclusionExcerpt(conclusion, summary);
          if (anchored === null) {
            return invalidRequest("workcase-write-object",
              "the supplied summary is not an excerpt of the auditor subagent's captured conclusion — the "
              + "recorded summary must be traceable to what the auditor actually produced, not rewritten by the parent "
              + "session (防「代述」冒充). Pass a span of its conclusion text verbatim apart from whitespace shape "
              + "(leading/trailing and in-line whitespace is tolerated; wording, punctuation and order are not). "
              + "The full text stays in the transcript, per 21 §8 审核详情不入对象.", "record_audit");
          }
          summary = anchored.text;
        } else {
          const picked = pickReviewSummary(conclusion, AUDIT_THREE_LABELS);
          if (picked === null) {
            return invalidRequest("workcase-write-object",
              `the auditor subagent's conclusion cannot be recorded automatically: it is longer than the ${REVIEW_SUMMARY_MAX_CHARS}-char `
              + "pre_reviews[].summary cap (21 §8) and no single paragraph of it fits. The full "
              + "text belongs in the transcript (审核详情不入对象); pass `summary` as an excerpt (≤600 chars) of "
              + "it. Refusing rather than truncating: a silently truncated conclusion would read as complete.",
              "record_audit");
          }
          summary = picked;
        }
        auditorIdentity = authoritativeSessionIdentity({ sessionId: child.sessionId, source: "host", origin: "subagent" });
        if (auditorIdentity === null) {
          return invalidRequest("workcase-write-object", `subagent ${childAgentId} carries no usable session identity`, "record_audit");
        }
        auditorChildNote = childAgentId;
      } else {
        // 承载形式唯一化（与 record_review 同纪律；21 §14 承载形式依 04 §7.3 的
        // 类比定位）：建前独立审核只承认受管辖隔离子代理（独立上下文）一种承载，
        // 由父会话以 `auditor_child_agent_id` 回传。fail-closed 而非降级放行——
        // 否则「主控自己写一段审核结论」即可满足覆盖闸，闸门形同虚设。
        return invalidRequest("workcase-write-object",
          "record_audit requires `auditor_child_agent_id`: 建前独立审核的唯一承载形式是受管辖隔离子代理（独立上下文，21 §14）。"
          + "未提供子代理 id 时本调用方将以自身会话身份盖戳，产出的是主控自查而非独立审核——按 00 §5.7 停止并报告，"
          + "不得以自查冒充。请派一个隔离子代理做建前独立审核（须后台派生以取得其 agent_id），完成后以 "
          + "`auditor_child_agent_id` 回传；若无法创建子代理或 id 不可回传，按 00 §5.7 停止并报告。",
          "record_audit",
        );
      }
      if (summary === null) {
        return invalidRequest(
          "workcase-write-object",
          "summary (the audit conclusion, ≤600 chars, covering the three dimensions 对象恰当性／方案可行性／scope 清晰度, each with 符合/不符＋证据) is required for action=record_audit",
          "record_audit",
        );
      }
      if (verdict === null) {
        return invalidRequest(
          "workcase-write-object",
          "verdict (\"pass\" | \"needs_revision\") is required for action=record_audit — 覆盖闸只认 pass，missing/unknown 一律 fail closed（21 §8）",
          "record_audit",
        );
      }
      if (!ident.ok) {
        return envelope("workcase-write-object", "unavailable", {
          result: null,
          scope: { requested: action, completed: [], not_completed: [action] },
          sources: [],
          gaps: [`audit_identity_unavailable: the caller's authoritative session identity could not be read from the DSH session record (${ident.reason}). `
            + "This channel exists precisely so that WHO recorded an audit is proven by Code, not asserted by a caller — "
            + "recording without it would make an implementer's self-check indistinguishable from an independent audit. "
            + "REPORT TO HUMAN: run the audit from a DSH session whose session log is readable, then retry."],
          verification: { checks: ["governance-scope", "signature-source", "session-identity"], passed: false },
          follow_up: ["human must ensure the auditing session's authoritative record is readable, then retry"]
        });
      }
      const coveredPartitionIds = Array.isArray(args?.covered_partitions) ? args.covered_partitions : null;
      const roundIndex = Number.isInteger(args?.round_index) ? args.round_index : null;
      result = await recordWorkcaseAudit({
        factSourceRoot, objectUid, expectedFingerprint, summary, verdict,
        changeSummary, sessionSignature: sig.value, sessionIdentity: auditorIdentity,
        auditorNote: auditorChildNote === null ? null : `记录自子代理会话 ${auditorChildNote} 的最终产出（Code 捕获）`,
        coveredPartitionIds,
        roundIndex,
      });
    } else if (action === "correct") {
      // 终态事实更正（21 §9.2:259 / 03 §9.5 / §10）：**只对 closed 对象**，
      // 且**只改正文**——`frontmatter_after` 不是可选而是根本不存在于本动作：
      // 终态判定与授权快照由 writer 从落盘对象逐字继承（结构保证）。
      // Human 授权是必填项，而不是注释里的礼貌：更正与其它受控更新同权限。
      const bodyMarkdownAfter = normalizeBodyMarkdown(args?.body_markdown_after);
      const humanAuthorization = args?.human_authorization;
      if (bodyMarkdownAfter === null) {
        return invalidRequest("workcase-write-object", "body_markdown_after (the full corrected body starting with '## 摘要', no H1) is required for action=correct", "correct");
      }
      if (typeof humanAuthorization !== "string" || humanAuthorization.trim().length === 0) {
        return invalidRequest("workcase-write-object", "human_authorization is required for action=correct — 事实更正与其它受控更新同权限（Human 确认），须在条目中留下授权记录，否则 fail-closed（21 §9.2 / 03 §9.5）", "correct");
      }
      result = await correctWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, bodyMarkdownAfter, changeSummary, humanAuthorization, sessionSignature: sig.value });
    } else {
      // revise
      const frontmatterAfter = args?.frontmatter_after;
      const bodyMarkdownAfter = normalizeBodyMarkdown(args?.body_markdown_after);
      if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || bodyMarkdownAfter === null) {
        return invalidRequest("workcase-write-object", "frontmatter_after and body_markdown_after are required for action=revise (pre-Gate-1 draft evolution)", "revise");
      }
      result = await reviseWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature: sig.value });
    }
  }

  if (!result.ok) {
    return writeRejected("workcase-write-object", result, factSourceRoot);
  }
  // create 的次序纪律必须**从结果中可读**：成功信封登记预检这一步，读者才能
  // 看出「先检查、后提请」确实发生过，而不是只能看到路由被问过。仅在被拒绝时
  // 登记（下方早退分支）会让合格路径的次序成为不可观测的行为。
  const isCreate = args.action === "create";
  return envelope("workcase-write-object", "completed", {
    result: {
      action: args.action,
      object_uid: result.value.object_uid,
      actual_ref: result.value.file,
      fingerprint: result.value.fingerprint,
      read_back: result.value.read_back === "ok" ? { ok: true } : { ok: false },
      changes: [{ object_uid: result.value.object_uid, change: args.action }],
      // 21 §8「执行」节记账纪律的前置提示（workcase-1c6afa19 计划步骤 2 的返
      // 回体部分）：writer 已在 approve/execute 的返回值里算出 plan 清单，但本
      // 信封此前是**六键白名单**，清单在工具边界被丢掉——工具描述声称会返回，
      // 调用方却拿不到（独立复核 workcase-1c6afa19 reviews[1] 实测）。
      // 此处只做**透传**：规则文本与清单仍由 writer 的 planStepReference(plan)
      // 单一计算，工具层不复制、不改写它。其余 action 的 writer 返回值没有该键，
      // 条件展开使其不出现在信封里（JSON.stringify 亦会丢弃 undefined 值键）。
      ...(result.value.plan_step_reference === undefined
        ? {}
        : { plan_step_reference: result.value.plan_step_reference }),
      // 宿主推进目标这一步必须**从结果中可读**（与上文 create 的次序纪律同理）：
      // 只把结果留在日志里，读者无法从信封看出「目标是否真的与对象对齐」。
      goal: goalSync,
    },
    scope: {
      requested: args.action,
      completed: isCreate
        ? ["pre-mechanical-check", "human-routing", args.action, "read-back"]
        : [args.action, "read-back", ...(GOAL_WRITE_POINTS.includes(args.action) ? ["host-goal"] : [])],
      not_completed: [],
    },
    sources: [{ kind: "fact-object", path: result.value.file, content_fingerprint: result.value.fingerprint }],
    gaps: [],
    verification: {
      checks: isCreate
        ? ["pre-mechanical-check", "human-routing", "cas-baseline", "closed-set", "field-invariants", "c2-fingerprint", "body-structure", "carrier-coherence", "atomic-write", "read-back"]
        : ["cas-baseline", "closed-set", "field-invariants", "c2-fingerprint", "body-structure", "carrier-coherence", "atomic-write", "read-back"],
      passed: true,
    },
    follow_up: [
      "use the NEW fingerprint from this result for the next action; committing goes through the controlled-commit contract (specs/06)",
      args.action === "approve"
        ? "Gate 1 approval covers only the scope_snapshot recorded — executing beyond it is a scope violation (21 §10.1)"
        : args.action === "close"
          ? "outcome=completed does not automatically equal review-passed or overall completion (21 §9.2 边界)"
          : args.action === "execute"
            ? "attempt tokens carry NO authorization — authorization only comes from Gate 1 (21 §10.4)"
            : "proceed with the recorded transition",
    ]
  });
}

function writeRejected(operationKey, failureResult, factSourceRoot) {
  const code = failureResult.error.code;
  const mechanicalCodes = new Set([
    "workcase/frontmatter_invalid", "workcase/body_invalid", "workcase/coherence_invalid",
    "workcase/initial_state_violation", "workcase/transition_invalid", "workcase/c2_fingerprint_invalidated",
    "workcase/cas_conflict", "workcase/serves_unresolvable", "workcase/relations_unresolvable",
    "workcase/change_summary_required", "workcase/invalid_uid",
    "workcase/candidate_changed", "workcase/candidate_fingerprint_invalid",
    "invalid_request",
  ]);
  const outcome = mechanicalCodes.has(code) ? "rejected" : "unavailable";
  const issues = Array.isArray(failureResult.error.details?.issues) ? failureResult.error.details.issues : [];
  const followUp = code === "workcase/cas_conflict"
    ? ["re-read the object (workcase-read-object), reconcile the concurrent change, and retry with the fresh fingerprint"]
    : code === "workcase/c2_fingerprint_invalidated"
      ? ["plan/scope changed while open — C2 authorization invalidated; the ONLY legal path is action=rebatch (局部重批), then re-approve via Gate 1 (21 §10.3)"]
      : code === "workcase/candidate_changed"
        ? ["the precheck verdict belonged to a different candidate: re-run ldvh_workcase_precheck_create on the CURRENT content and pass its fingerprint, then retry — do not reuse a stale verdict"]
        : code === "workcase/transition_invalid"
          ? ["check the current status against the transition table (draft→open→closed, rebatch open→draft, cancel draft→closed); closed is read-only (21 §9.2)"]
          : code === "workcase/serves_unresolvable"
            ? ["goal.md is missing or the SG-n does not exist — Gate 1 is fail-closed without a resolvable anchor (21 §10.1); omit serves or fix the anchor"]
            : ["fix the reported mechanical issues and retry; zero write has occurred"];
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: "write", completed: [], not_completed: ["write"] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "workcases") }],
    gaps: [`${code}: ${failureResult.error.message}`, ...issues],
    verification: { checks: [], passed: false },
    follow_up: followUp
  });
}

// ---------------------------------------------------------------------------
// Registration (same shape as pitfall-tools.js — mounted from
// registerLdvhTools, so tools land only in governed sessions)
// ---------------------------------------------------------------------------

function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  const result = env.result;
  if (result?.object_uid !== undefined) lines.push(`object: ${objectRef({ object_uid: result.object_uid, fact_type_key: result.fact_type_key ?? "workcase" })}`);
  if (result?.title !== undefined) lines.push(`title: ${result.title}`);
  if (result?.status !== undefined) lines.push(`status: ${result.status}`);
  if (result?.attempt_id !== undefined) lines.push(`attempt: ${result.attempt_id} (controller: ${result.controller ?? "unknown"})`);
  if (result?.outcome !== undefined) lines.push(`outcome: ${result.outcome}`);
  if (result?.mechanical_outcome !== undefined) lines.push(`mechanical_outcome: ${result.mechanical_outcome}`);
  if (result?.candidate_fingerprint !== undefined && result.candidate_fingerprint !== null) lines.push(`candidate_fingerprint: ${result.candidate_fingerprint}`);
  if (result?.error_code !== undefined) lines.push(`error_code: ${result.error_code}`);
  if (result?.fingerprint !== undefined) lines.push(`fingerprint: ${result.fingerprint}`);
  if (result?.read_back?.ok !== undefined) lines.push(`read_back: ${result.read_back.ok ? "ok" : "FAILED"}`);
  if (result?.actual_ref !== undefined) lines.push(`file: ${result.actual_ref}`);
  if (result?.count !== undefined) lines.push(`count: ${result.count}${result.total !== undefined && result.total !== result.count ? ` (of ${result.total})` : ""}`);
  if (Array.isArray(result?.items)) {
    for (const item of result.items) {
      lines.push(`- ${objectRef(item)} [${item.status}]${item.outcome ? ` outcome=${item.outcome}` : ""} ${item.title}${item.serves ? ` (${item.serves})` : ""}`);
    }
  }
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${objectRefOf(change.object_uid, change.fact_type_key ?? "workcase")}`);
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  // Models mis-shape open objects when they see additionalProperties:true
  // with no declared properties — every WorkCase data object declares its
  // shape explicitly (mirrors 21 §8 field contract).
  const workcaseFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log and generates the H1 from title. gate_1/attempt/result/outcome are flow-managed: the writer stamps them on the respective transitions (approve/close) — values passed here are overwritten",
    properties: {
      title: { type: "string", description: "工单短标题，≤ 30 字；不承载完成判据或结果结论" },
      status: { type: "string", enum: ["draft", "open", "closed"], description: "create must be draft; transitions are stamped by approve/close/rebatch/cancel (21 §9)" },
      gist: { type: "string", description: "给 Human 扫读的一句话要点（21 §8）：这份工单要做什么、要 Human 决定什么。draft/open 时必填、closed 时条件；≤ 200 字符；纯文本——不得以编号引用（如「承 workcase-xxxx 的 residual」）、Markdown 标记或归因链开头，须自足可读；无正文承载。它服务 Human 分诊（卡面即提请面），与 summary（AI 接续快照，可长、可含编号与 Markdown）分工不重叠" },
      serves: { type: "string", description: "服务的 sub-goal 锚点，值形如 SG-3；必须匹配 goal.md 中存在的 SG-n；不是 relations 条目（21 §8）" },
      summary: { type: "string", description: "要做什么的当前语义快照（AI 向，不设长度上限）；使未读原计划的后续执行者可独立执行；必须逐字出现在「摘要」正文节。**书写格式（21 §8，机械校验）**：超过 200 字符时须用空行分块，且**首块之外**的每块首行须是 **H3 标题行**（如 `### 现状核实` / `### 处置方向` / `### 边界`），标题行独占一行、内容另起。首块可为总述、不要求标题。标题名由你按内容定，规则只要求「有块级标题、看得出这一块在讲什么」；200 字符以内不强制分块。**只认 H3**：`**加粗**` 与 `标签：` 不再被接受——实测二者在渲染层与正文同处一个段落（单个换行不产生新段落），读者看不出层次" },
      scope: { type: "string", description: "授权范围与边界：必须同时回答「做什么」与「明确不做什么」；是越权拒绝的比对基准；必须逐字出现在「授权范围」正文节。**书写格式（21 §8，机械校验）**：「做什么：」与「明确不做什么：」必须**各自独占一行**并各带内容（不得写成 `做什么：A；B。明确不做什么：C。` 这类行内串联）；两者下的具体条目用 `- ` 列表逐条列出。该骨架不受长度豁免——任何长度都须两段分明；超过 200 字符时另须用空行分块，且**首块之外**的每块首行须是 H3 标题行，或本字段语义必需的 `做什么：`／`明确不做什么：` 两标签行（**只认这两类**；`**加粗**` 与其它任意 `XX：` 不构成块首——实测它们在渲染层与正文同处一个段落，读者看不出层次）" },
      plan: {
        type: "array",
        description: "可执行计划步骤；每项 {step, done_criteria}；done_criteria 必须可被证据判定（21 §6.1）",
        items: {
          type: "object",
          properties: {
            step: { type: "string", description: "单一执行者一次连续执行可完成的步骤" },
            done_criteria: { type: "string", description: "可被证据判定的完成判据" }
          },
          required: ["step", "done_criteria"],
          additionalProperties: false
        }
      },
      gate_1: { type: "object", description: "[Code-stamped on approve] {approved_at, approver, authorization_fingerprint, scope_snapshot} — AI does not supply it" },
      attempt: { type: "object", description: "[Code-managed] {attempt_id, started_at, controller, heartbeat_at} — heartbeat/takeover/reallocate via action=execute; carries NO authorization (21 §10.4)" },
      result: { type: "object", description: "[Code-stamped on close] {criteria_checks[], achieved_scope, residual[]} — drafts live in the body 结果 section while open" },
      reviews: {
        type: "array",
        description: "复核节点概要流水（21 §8）：每次独立复核后追加一项。at 与 provider/model 由 Code 从会话记录托管，AI 不得自填；summary 为结构化概要，每项 ≤ 600 字符、至少含 02 §16 判据七要素（对象/基线/方法/覆盖/未覆盖/发现/保证边界）；复核详情不入对象；条数上限 20，达上限 fail-closed 拒绝新增",
        items: {
          type: "object",
          properties: {
            at: { type: "string", description: "[Code-managed] RFC3339 — stamped by the writer" },
            provider: { type: "string", description: "[Code-managed] authoritative provider from the session record" },
            model: { type: "string", description: "[Code-managed] authoritative model from the session record" },
            summary: { type: "string", description: "复核节点概要：≤ 600 字符，含发现与处置去向" },
          },
          required: ["summary"],
          additionalProperties: false,
        },
      },
      pre_reviews: {
        type: "array",
        description: "建前独立审核的节点概要流水（**审核轴**，21 §8，2026-10-16 建立）：与 reviews 的复核轴分立互不替代。draft 期可行（Gate 1 提请前须至少一条覆盖当前候选）；open/closed 期保留为历史。正常写入通道是 action=record_audit（经 auditor_child_agent_id 回传），本字段在此声明以便整对象 carried write 不被工具面拒绝；at/署名/session_id/auditor_origin/candidate_fingerprint 均由 Code 托管，AI 不得自填。条数上限 20；同一次审核事项（同一 candidate_fingerprint）最多 3 条",
        items: {
          type: "object",
          properties: {
            at: { type: "string", description: "[Code-managed] RFC3339 — stamped by the writer" },
            provider: { type: "string", description: "[Code-managed] authoritative provider from the session record" },
            model: { type: "string", description: "[Code-managed] authoritative model from the session record" },
            summary: { type: "string", description: "三维结论概要（对象恰当性／方案可行性／scope 清晰度，各含符合/不符＋证据）：≤ 600 字符" },
            session_id: { type: "string", description: "[Code-managed] 审核者会话身份（取自 DSH 会话记录）" },
            session_source: { type: "string", description: "[Code-managed] host | shell（仅 host 可作为判据）" },
            auditor_origin: { type: "string", description: "[Code-managed] 审核者来源形态；受管辖隔离子代理记 subagent（21 §14 承载形式唯一化的机械凭据）" },
            candidate_fingerprint: { type: "string", description: "[Code-managed] 该次审核针对的 plan+scope 内容指纹（与 gate_1.authorization_fingerprint 同源函数计算）；覆盖闸据此判定「审的是不是当前这一版」。AI 不得自填" },
            verdict: { type: "string", enum: ["pass", "needs_revision"], description: "审核结论（21 §8 闭集）；覆盖闸只认 pass" },
          },
          required: ["summary", "verdict"],
          additionalProperties: false,
        },
      },
      outcome: { type: "string", enum: ["completed", "partial", "not-achieved", "cancelled"], description: "[Code-stamped on close] 终态判定（21 §9.3）" },
      refs: {
        type: "array",
        maxItems: 10,
        description: "普通内容关联（03 §7.2 / 21 §8）：每项必须是精确 {object_uid}，目标须为可解析的同项目事实对象（同项目事实目录内存在载体文件且其 object_uid 行可解析；不校验目标可读性与 frontmatter 合法性，机械口径见 21 §15.1）；仅用于精确引用与派生反查，不是生命周期关系，也不证明履行、覆盖或闭环",
        items: {
          type: "object",
          properties: { object_uid: { type: "string" } },
          required: ["object_uid"],
          additionalProperties: false,
        },
      },
      relations: {
        type: "array",
        description: "贡献关联：仅 contributed-to → Pitfall object_uid（21 §12 关系闭集）",
        items: {
          type: "object",
          properties: {
            relation_key: { type: "string", enum: ["contributed-to"] },
            target: { type: "object", properties: { object_uid: { type: "string" } }, required: ["object_uid"], additionalProperties: false }
          },
          required: ["relation_key", "target"],
          additionalProperties: false
        }
      },
      change_summary: { type: "string", description: "one-line summary for the change_log entry" }
    },
    required: ["title", "summary", "scope", "plan"],
    additionalProperties: false
  };
  const casArgs = {
    object_uid: { type: "string", description: "target object" },
    expected_fingerprint: { type: "string", description: "CAS baseline fingerprint from your last precise read (03 §9.5)" },
    change_summary: { type: "string", description: "one short semantic summary for the change_log entry" },
    items: {
      type: "array",
      description: "request_adjustment: 拟追加的事项——每项 {step, done_criteria}，两者均非空（21 §14 乙档：超目录但必需）。申请**不产生任何可执行权限**，真正的门在 decide_adjustment",
      items: { type: "object", properties: { step: { type: "string" }, done_criteria: { type: "string" } }, required: ["step", "done_criteria"] },
    },
    rationale: { type: "string", description: "request_adjustment: 为什么必需——须回答「不做它，已批的 done_criteria 就达不成」（21 §14 乙档的定义要件）" },
    adjustment_decision: { type: "string", enum: ["approved", "rejected"], description: "decide_adjustment: Human 对该申请的判定（21 §14）。批准须同时给出 body_markdown_after（**不含 H1**，与 execute/close 同形）；新步骤须出现在正文「## 计划」节（载体内聚）" },
    by: { type: "string", description: "decide_adjustment: 作出决定的人（同 gate_1.approver 的形态，21 §14）。**先决：须同时给出 human_authorization（Human 的授权记录，缺之 fail-closed，与 correct 同规格）**；**注意：`by` 是自报文本**——「谁批的」的可核痕迹来自 Code 托管的决定者会话身份（**在能取得 host 来源身份时**盖戳进 decision.session_id；取不到时该痕迹缺失，返回值的 decider_identity 会显式报 unavailable），规范已如实声明该边界" },
    human_authorization: { type: "string", description: "decide_adjustment: **必填**——Human 的授权记录（谁／何时／覆盖什么），与 correct 的 human_authorization 同规格，缺之 fail-closed。它会被写进 change_log；**它不证明 Human 真的批过**，只让「没有转述的批准」机械上不可发生（21 §14）" },
    summary: { type: "string", description: "record_review / record_audit: the conclusion summary to record (≤600 chars; review carries the 02 §16 seven elements 对象/基线/方法/覆盖/未覆盖/发现/保证边界, audit the 21 §8 three dimensions 对象恰当性／方案可行性／scope 清晰度). `at`, provider/model and session_id are stamped by Code — the caller supplies only this text. When the subagent id is given, this must be a span taken from that subagent's captured conclusion (防「代述」冒充): wording, punctuation and order verbatim, while whitespace shape (trailing spaces, indentation, line breaks) is ignored for matching and the text recorded is the source span itself. Omit it to adopt the conclusion paragraph carrying those elements." },
    reviewer_child_agent_id: { type: "string", description: "record_review: relay an ISOLATED SUBAGENT's review — REQUIRED (04 §7.3: 受管辖隔离子代理是独立复核的唯一承载形式). Pass its agent id (from a BACKGROUND subagent spawn — a synchronous spawn's id is reclaimed on return and cannot be relayed). The identity and the conclusion text are then taken from the host's own subagent registry (Code-observed, not settable by the caller), so the implementer can neither forge the reviewer's identity nor substitute its own text. Omitting it is refused: recording your own session's review is 主控自查, not 独立复核 — stop and report to Human (00 §5.7) instead." },
    auditor_child_agent_id: { type: "string", description: "record_audit: relay an ISOLATED SUBAGENT's pre-Gate-1 audit — REQUIRED, same mechanism and same rationale as reviewer_child_agent_id (21 §14「建前审核记录」). Pass a BACKGROUND-spawned audit subagent's agent id; the identity and conclusion text are taken from the host's own subagent registry, so the implementer cannot forge the auditor's identity nor substitute its own conclusion. Omitting it is refused — otherwise a self-written audit would satisfy the coverage gate and the gate would be vacuous. This channel acts on status=draft only (the audit axis targets a candidate that has not yet taken effect)." },
    verdict: { type: "string", enum: ["pass", "needs_revision"], description: "record_audit: the audit verdict (21 §8 closed set). The Gate 1 coverage gate accepts ONLY \"pass\"; an unknown or missing value fails closed. `candidate_fingerprint` is computed by Code (same function as gate_1.authorization_fingerprint) and cannot be supplied by the caller — otherwise the「which version was audited」criterion would be handed to the party being judged." },
    covered_partitions: { type: "array", items: { type: "string" }, description: "record_audit: 本次审核**覆盖的分区 id**（21 §9.2 分区口径：`plan` 每步骤 `plan#N` + `scope` 每条目 `scope:<标签>#N`）。省略即覆盖当前全部分区——与改造前的整份审语义一致，旧调用无须改动。分区指纹由 Code 按当前候选计算，调用方只给 id，不能自填指纹。用于增量审核：只审改动分区，未变分区沿用既有 `pass`。未知 id 一律拒绝（fail closed），因为分区 id 随内容变化。" },
    round_index: { type: "integer", description: "record_audit: 本次审核属于同一审核事项的**第几轮**（1-based）。省略即由 Code 分配新轮（当前最大轮 + 1）；同一轮的多个**分片**并行审核须传同一个值——轮次上限按不同 `round_index` 计数，故分片不占额外轮次（21 §9.2，2026-10-27 口径）。超过上限即返回 `workcase/pre_gate1_audit_round_cap`。" }
  };
  switch (operationKey) {
    case "workcase-read-object":
      return {
        type: "object",
        properties: {
          object_uid: { type: "string", description: "Canonical object_uid of the WorkCase object to read" }
        },
        required: ["object_uid"],
        additionalProperties: false
      };
    case "workcase-list-objects":
      return {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft+open", "all"], description: "draft+open = default (21 §13 默认候选); all = include closed for precise reference / evidence chains / historical tracing" },
          limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
        },
        additionalProperties: false
      };
    case "workcase-precheck-create":
      return {
        type: "object",
        properties: {
          frontmatter_draft: workcaseFrontmatter,
          body_markdown: { type: "string", description: "The same body markdown that create takes (starting with '## 摘要'; the H1 is generated from title). Evaluated by the SAME validator the write path uses — the precheck is not a second rule set." },
        },
        required: ["frontmatter_draft", "body_markdown"],
        additionalProperties: false
      };
    case "workcase-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "approve", "execute", "close", "rebatch", "cancel", "revise", "correct", "record_review", "record_audit", "request_adjustment", "decide_adjustment"] },
          frontmatter_draft: workcaseFrontmatter,
          body_markdown: { type: "string", description: "create: the body markdown starting with '## 摘要' (H2 sections 摘要/授权范围/计划; the H1 is generated from title)" },
          expected_candidate_fingerprint: { type: "string", description: "create: the candidate_fingerprint returned by ldvh_workcase_precheck_create for THIS candidate content. When supplied, the write refuses if the content changed in between — so a precheck verdict never silently carries over to a different candidate (21 §14 create). Optional: omit when the candidate was not prechecked." },
          routing_request: { type: "string", description: "create: the Human's request in their own words, shown in the 21 §6.3 routing prompt (e.g. 「帮我把 X 改掉」). Optional but strongly recommended — it is what lets the Human recognise which piece of work is being routed." },
          routing_rationale: {
            type: "object",
            description: "create: the AI's 21 §6.3 reasoning. Advisory only, NOT part of what is accepted — and since 2026-10 NOT shown in the routing prompt either (Human ruled the AI's lean reasons must not appear there), so supplying it changes nothing user-visible. Kept for call compatibility; omit it.",
            properties: {
              forWorkcase: { type: "array", items: { type: "string" }, description: "倾向建工单的理由（如：涉及多处改动 / 需独立复核 / 可能跨会话）" },
              forDirect: { type: "array", items: { type: "string" }, description: "倾向直接执行的理由（如：改动范围小、单文件）" },
            },
          },
          approver: { type: "string", description: "approve: the approving Human identity — stamped into gate_1.approver (21 §10.1)" },
          controller: { type: "string", description: "approve: the executing controller identity — stamped into attempt.controller (21 §10.4)" },
          gate1_request: {
            type: "object",
            description: "approve: the Gate 1 request elements that have NO object-field carrier (21 §10.1 必含). Plan/serves/scope are already carried by fields and are not repeated here. Required keys: unauthorized_action_guard (越权动作被机械拒绝的机制), pre_creation_review (建立前独立审核的结论 — 21 §14 Gate 1 前置·建前独立审核), independent_review (独立复核的安排 — who runs it, how many perspectives), unverified_scope_and_risks (未验证范围与风险), approved_scope_and_next (批准的作用范围与后续方向). Each must be a non-empty string; omissions are rejected rather than passing silently.",
            properties: {
              unauthorized_action_guard: { type: "string", description: "越权动作被机械拒绝的机制" },
              pre_creation_review: { type: "string", description: "建立前独立审核的结论（21 §14「Gate 1 前置·建前独立审核」）：凡建单 Gate 1 前必经受管辖隔离子代理审核，此处给出其结论；覆盖对象恰当性/方案可行性/scope 清晰度三维，各给「符合/不符+证据」" },
              independent_review: { type: "string", description: "独立复核的安排：由谁复核、几个视角、何时（21 §10.1 + 32 §12 按风险选最小充分视角）" },
              unverified_scope_and_risks: { type: "string", description: "未验证范围与风险" },
              approved_scope_and_next: { type: "string", description: "批准的作用范围与后续方向" },
            },
            required: ["unauthorized_action_guard", "pre_creation_review", "independent_review", "unverified_scope_and_risks", "approved_scope_and_next"],
          },
          attempt_operation: { type: "string", enum: ["heartbeat", "takeover", "reallocate"], description: "execute: heartbeat (default — refresh heartbeat_at) | takeover (new controller, new monotonic attempt id) | reallocate (void + new id — 冷恢复 after side-effect reconciliation, 21 §10.4)" },
          new_controller: { type: "string", description: "execute: the new controller identity for takeover/reallocate" },
          outcome: { type: "string", enum: ["completed", "partial", "not-achieved", "cancelled"], description: "close: 终态判定（21 §9.3）" },
          result: {
            type: "object",
            description: "close/cancel: {criteria_checks: [{satisfied, evidence}] 逐条对应 plan, achieved_scope, residual: string[]}",
            properties: {
              criteria_checks: {
                type: "array",
                items: {
                  type: "object",
                  properties: { satisfied: { type: "boolean" }, evidence: { type: "string" } },
                  required: ["satisfied", "evidence"],
                  additionalProperties: false
                }
              },
              achieved_scope: { type: "string" },
              residual: { type: "array", items: { type: "string" } }
            },
            required: ["achieved_scope"],
            additionalProperties: false
          },
          body_markdown_after: { type: "string", description: "execute/close/rebatch/cancel/revise: the complete next body starting with '## 摘要' (no H1 — generated from title). correct: the complete CORRECTED body of a closed record (same rule: start at H2). 「执行」节记账纪律（21 §8）：引用计划步骤时写「计划步骤 N」，N 以当前 plan 为界（approve 返回的 plan_step_reference 给出权威清单）；复核、补充验证、收尾等非计划步骤事项独立描述，不要续编进计划序号——plan 的位置序号是该类型唯一的计划步骤编号体系" },
          human_authorization: { type: "string", description: "correct only: the Human's authorization record for this terminal fact correction (whose decision, when, and what it covers). Required and non-empty — 更正与其它受控更新同权限（Human 确认），缺之 fail-closed（21 §9.2:259 / 03 §9.5）。It is written verbatim into the change_log entry; it is NOT a substitute for Human consent itself." },
          ...casArgs,
          frontmatter_after: (() => { const { required: _r, ...rest } = workcaseFrontmatter; return { ...rest, description: "execute/rebatch/revise: the complete target frontmatter fields (Code-managed fields are overwritten by the writer)" }; })(),
        },
        required: ["action"],
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

/**
 * Build the registration descriptor for one operation.
 *
 * `timeoutMs` is omitted for operations that block on a Human answer
 * (`awaitsHumanDecision`) — see the identical note in ldvh-tools.js. The host's
 * timeout policy arms a deadline from this field and substitutes `TOOL_TIMEOUT`
 * for the real result after it elapses, and it does so AFTER the tool resolves:
 * a human answering at second 31 still had their answer discarded. Omitting the
 * key is the host-sanctioned "no deadline" declaration (defineTool drops the
 * key when undefined; the policy wrapper returns `next()` unarmed) and is what
 * the official `ask_user_question` does.
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

export function registerWorkcaseTools(ctx, deps) {
  const handlers = {
    "workcase-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "workcase-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "workcase-precheck-create": (args, exec) => executePrecheckCreate(args, exec, deps),
    "workcase-write-object": (args, exec) => executeWriteObject(args, exec, deps),
  };
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
