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
//   - workcase-write-object (effect: may_change_state) — seven controlled
//     actions mapped to the 21 §14 operations:
//       create  — C1 提案对象模式, draft initial state;
//       approve — Gate 1 (draft→open): stamps gate_1 (authorization
//                 fingerprint computed by Code) + allocates attempt 1;
//       execute — open-period update: heartbeat/takeover/reallocate,
//                 body progress, result drafts; plan/scope frozen by C2;
//       close   — Gate 2 (open→closed): result+outcome, attempt 收口;
//       rebatch — C2 局部重批 (open→draft): attempt voided, gate_1
//                 dropped, evidence snapshot into change_log;
//       cancel  — draft→closed cancelled (计划未经执行即被取消);
//       revise  — draft→draft pre-Gate-1 evolution.
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
  recordWorkcaseReview,
  listWorkcaseObjects,
} from "./workcase-writer.js";
import { currentRouteValues, currentSessionIdentity } from "./session-signature.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";

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
    summary: "Controlled write of WorkCase fact objects across the 工单 lifecycle: create (C1 提案, draft), approve (Gate 1: stamps authorization fingerprint + attempt 1; returns plan_step_reference — the authoritative 「计划步骤 N」清单), execute (open-period; plan/scope frozen by C2), close (Gate 2: result+outcome, attempt 收口; requires at least one review recorded by a session OTHER than the executor, workcase-2be11478), rebatch (C2 局部重批 open→draft), cancel (draft→closed cancelled), revise (draft evolution), record_review (append ONE review entry carrying the caller's Code-stamped session identity — the narrow channel for an isolated reviewer) (specs/03 §9.4–§9.5, specs/21 §14). 写「执行」节时引用计划步骤请用「计划步骤 N」（21 §8 记账纪律）",
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
// write handler — seven controlled actions (21 §14)
// ---------------------------------------------------------------------------

const WRITE_ACTIONS = new Set(["create", "approve", "execute", "close", "rebatch", "cancel", "revise", "record_review"]);

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
  "independent_review",
  "unauthorized_action_guard",
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

  let result;
  if (action === "create") {
    const draft = args?.frontmatter_draft;
    const bodyMarkdown = args?.body_markdown;
    if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
      return invalidRequest("workcase-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 摘要') are required for action=create", "create");
    }
    // 21 §14 C1 / §6.3：创建前须经宿主询问入口取得 Human 的**路由选择**。
    // 这不是「AI 声明问过了」，而是 Human 本人的答复由宿主记录；拿不到即拒绝。
    // 无答题器 → fail-closed（静默不等于同意），与 07 §5.6 consent 同纪律。
    const gate = deps?.hostSeams;
    if (gate === undefined || typeof gate.requestWorkcaseRouting !== "function") {
      return envelope("workcase-write-object", "unavailable", {
        result: null,
        scope: { requested: "create", completed: [], not_completed: ["create"] },
        sources: [],
        gaps: ["ctx.userQuestions.ask is not wired into this composition, so the 21 §6.3 routing decision "
          + "cannot be obtained. 21 §14 C1 requires the Human's explicit confirmation before creation; "
          + "REPORT TO HUMAN — an un-routed candidate must not silently become an object."],
        verification: { checks: ["governance-scope", "human-routing"], passed: false },
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
    });
    if (routing.granted !== true) {
      return envelope("workcase-write-object", "rejected", {
        result: null,
        scope: { requested: "create", completed: [], not_completed: ["create"] },
        sources: [],
        gaps: [`21 §6.3/§14 C1 requires an explicit Human routing decision: ${routing.reason}`],
        verification: { checks: ["governance-scope", "human-routing"], passed: false },
        // 路由到「直接执行」是合法结论，不是错误：此时不应创建对象，
        // 而应在当次行动内处理（21 §6.3 不对象化）。
        follow_up: routing.routedTo === "direct"
          ? ["handle the work directly in this action — do not create a WorkCase object (21 §6.3)"]
          : ["obtain the Human's routing decision, then retry"]
      });
    }
    result = await createWorkcaseObject({ factSourceRoot, frontmatterDraft: draft, bodyMarkdown, sessionSignature: sig.value });
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
      const bodyMarkdownAfter = args?.body_markdown_after;
      if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
        return invalidRequest("workcase-write-object", "frontmatter_after (object) and body_markdown_after (the full next body starting with '## 摘要') are required for action=execute", "execute");
      }
      const attemptOperation = args?.attempt_operation ?? "heartbeat";
      const newController = typeof args?.new_controller === "string" && args.new_controller.length > 0 ? args.new_controller : null;
      result = await executeWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary, attemptOperation, newController, sessionSignature: sig.value, sessionIdentity: ident.value });
    } else if (action === "close") {
      const outcome = args?.outcome;
      const resultPayload = args?.result;
      const bodyMarkdownAfter = args?.body_markdown_after;
      if (typeof outcome !== "string" || typeof resultPayload !== "object" || resultPayload === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
        return invalidRequest("workcase-write-object", "outcome, result ({criteria_checks[], achieved_scope, residual[]}) and body_markdown_after (including the 结果 section) are required for action=close — Gate 2 (21 §10.2)", "close");
      }
      result = await closeWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, outcome, result: resultPayload, changeSummary, bodyMarkdownAfter, sessionSignature: sig.value });
    } else if (action === "rebatch") {
      const frontmatterAfter = args?.frontmatter_after;
      const bodyMarkdownAfter = args?.body_markdown_after;
      if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
        return invalidRequest("workcase-write-object", "frontmatter_after (the revised draft fields) and body_markdown_after (the revised 摘要/授权范围/计划 body) are required for action=rebatch — change_summary must carry 重批原因 + 当时核对快照结论 (21 §9.2)", "rebatch");
      }
      result = await rebatchWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature: sig.value });
    } else if (action === "cancel") {
      const resultPayload = args?.result;
      const bodyMarkdownAfter = args?.body_markdown_after;
      if (typeof resultPayload !== "object" || resultPayload === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
        return invalidRequest("workcase-write-object", "result ({achieved_scope: 取消理由与未发生的范围}) and body_markdown_after (including the 结果 section) are required for action=cancel (21 §9.2)", "cancel");
      }
      result = await cancelWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, result: resultPayload, changeSummary, bodyMarkdownAfter, sessionSignature: sig.value });
    } else if (action === "record_review") {
      // 复核结论回传通道（workcase-2be11478 计划步骤 4）：只追加一条 reviews 条目，
      // 不授予任何其它写能力。
      //
      // 两条合法入口（对应本单 scope (C) 的「受管辖子代理**或**另一受管辖根会话」）：
      //  (a) 由**另一个受管辖根会话**直接调用（sessionIdentity = 它自己的 host 身份）；
      //  (b) 由父会话**代其子代理**回传：指定 `reviewer_child_agent_id`，此时身份与结论
      //      都取自宿主登记表（Code 亲观测），见下方子分支。
      // 子代理自身不注册 ldvh_* 工具（lifecycle.js 的 origin==="subagent" 分支），
      // 故 (b) 是「开启代理做独立审核」在机械上可行的路径。
      const childAgentId = requireString(args, "reviewer_child_agent_id", action);
      let summary = requireString(args, "summary", action);
      let reviewerIdentity = ident.value;
      let reviewerChildNote = null;
      if (childAgentId !== null) {
        // 代子代理回传：身份取自宿主登记表（调用方**不可设置**），结论取子代理
        // **真实产出的最终文本**（Code 在 turn-end 捕获）——故实施者既不能伪造
        // 身份，也不能把自查文本冒充成子代理的结论。
        const lookup = deps?.lookupChild;
        if (typeof lookup !== "function") {
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
        const child = lookup(childAgentId);
        if (child === null) {
          return invalidRequest("workcase-write-object",
            `reviewer_child_agent_id ${JSON.stringify(childAgentId)} is not a subagent registered under this session — `
            + "only a session the host actually observed may be cited as the reviewer", "record_review");
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
        // §8 分工一致。省略 summary 时取结论首段，若其本身超限则要求调用方指明概要。
        const conclusion = child.conclusion.trim();
        if (summary !== null) {
          if (!conclusion.includes(summary.trim())) {
            return invalidRequest("workcase-write-object",
              "the supplied summary is not a verbatim excerpt of the reviewer subagent's captured conclusion — the "
              + "recorded summary must be traceable to what the reviewer actually produced, not rewritten by the parent "
              + "session (防「代述」冒充). Pass an exact substring of its conclusion (the full text stays in the "
              + "transcript, per 21 §8 复核详情不入对象).", "record_review");
          }
          summary = summary.trim();
        } else {
          // 取首段；仍超限则要求调用方显式提供 ≤600 的逐字概要，而不是静默截断
          // （截断会产生一个看似完整、实则被腰斩的结论，属伪造边界的形态）。
          const firstParagraph = conclusion.split(/\n\s*\n/)[0].trim();
          if (firstParagraph.length <= 600) {
            summary = firstParagraph;
          } else {
            return invalidRequest("workcase-write-object",
              "the reviewer subagent's conclusion is longer than the 600-char reviews[].summary cap (21 §8). The full "
              + "text belongs in the transcript (复核详情不入对象); pass `summary` as a verbatim excerpt (≤600 chars) of "
              + "it. Refusing rather than truncating: a silently truncated conclusion would read as complete.",
              "record_review");
          }
        }
        reviewerIdentity = authoritativeSessionIdentity({ sessionId: child.sessionId, source: "host", origin: "subagent" });
        if (reviewerIdentity === null) {
          return invalidRequest("workcase-write-object", `subagent ${childAgentId} carries no usable session identity`, "record_review");
        }
        reviewerChildNote = childAgentId;
      }
      if (summary === null) {
        return invalidRequest(
          "workcase-write-object",
          "summary (the review conclusion, ≤600 chars, carrying the 02 §15 seven elements: 对象/基线/方法/覆盖/未覆盖/发现/保证边界) is required for action=record_review",
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
    } else {
      // revise
      const frontmatterAfter = args?.frontmatter_after;
      const bodyMarkdownAfter = args?.body_markdown_after;
      if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
        return invalidRequest("workcase-write-object", "frontmatter_after and body_markdown_after are required for action=revise (pre-Gate-1 draft evolution)", "revise");
      }
      result = await reviseWorkcaseObject({ factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature: sig.value });
    }
  }

  if (!result.ok) {
    return writeRejected("workcase-write-object", result, factSourceRoot);
  }
  return envelope("workcase-write-object", "completed", {
    result: {
      action: args.action,
      object_uid: result.value.object_uid,
      actual_ref: result.value.file,
      fingerprint: result.value.fingerprint,
      read_back: result.value.read_back === "ok" ? { ok: true } : { ok: false },
      changes: [{ object_uid: result.value.object_uid, change: args.action }],
    },
    scope: { requested: args.action, completed: [args.action, "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: result.value.file, content_fingerprint: result.value.fingerprint }],
    gaps: [],
    verification: { checks: ["cas-baseline", "closed-set", "field-invariants", "c2-fingerprint", "body-structure", "carrier-coherence", "atomic-write", "read-back"], passed: true },
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
    "invalid_request",
  ]);
  const outcome = mechanicalCodes.has(code) ? "rejected" : "unavailable";
  const issues = Array.isArray(failureResult.error.details?.issues) ? failureResult.error.details.issues : [];
  const followUp = code === "workcase/cas_conflict"
    ? ["re-read the object (workcase-read-object), reconcile the concurrent change, and retry with the fresh fingerprint"]
    : code === "workcase/c2_fingerprint_invalidated"
      ? ["plan/scope changed while open — C2 authorization invalidated; the ONLY legal path is action=rebatch (局部重批), then re-approve via Gate 1 (21 §10.3)"]
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
  if (result?.object_uid !== undefined) lines.push(`object: ${result.object_uid}`);
  if (result?.title !== undefined) lines.push(`title: ${result.title}`);
  if (result?.status !== undefined) lines.push(`status: ${result.status}`);
  if (result?.attempt_id !== undefined) lines.push(`attempt: ${result.attempt_id} (controller: ${result.controller ?? "unknown"})`);
  if (result?.outcome !== undefined) lines.push(`outcome: ${result.outcome}`);
  if (result?.fingerprint !== undefined) lines.push(`fingerprint: ${result.fingerprint}`);
  if (result?.read_back?.ok !== undefined) lines.push(`read_back: ${result.read_back.ok ? "ok" : "FAILED"}`);
  if (result?.actual_ref !== undefined) lines.push(`file: ${result.actual_ref}`);
  if (result?.count !== undefined) lines.push(`count: ${result.count}${result.total !== undefined && result.total !== result.count ? ` (of ${result.total})` : ""}`);
  if (Array.isArray(result?.items)) {
    for (const item of result.items) {
      lines.push(`- ${item.object_uid} [${item.status}]${item.outcome ? ` outcome=${item.outcome}` : ""} ${item.title}${item.serves ? ` (${item.serves})` : ""}`);
    }
  }
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${change.object_uid}`);
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
      summary: { type: "string", description: "要做什么的当前语义快照（AI 向，不设长度上限）；使未读原计划的后续执行者可独立执行；必须逐字出现在「摘要」正文节" },
      scope: { type: "string", description: "授权范围与边界：必须同时回答「做什么」与「明确不做什么」；是越权拒绝的比对基准；必须逐字出现在「授权范围」正文节" },
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
        description: "复核节点概要流水（21 §8）：每次独立复核后追加一项。at 与 provider/model 由 Code 从会话记录托管，AI 不得自填；summary 为结构化概要，每项 ≤ 600 字符、至少含 02 §15 判据七要素（对象/基线/方法/覆盖/未覆盖/发现/保证边界）；复核详情不入对象；条数上限 20，达上限 fail-closed 拒绝新增",
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
      outcome: { type: "string", enum: ["completed", "partial", "not-achieved", "cancelled"], description: "[Code-stamped on close] 终态判定（21 §9.3）" },
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
    summary: { type: "string", description: "record_review: the review conclusion (≤600 chars), carrying the 02 §15 seven elements (对象/基线/方法/覆盖/未覆盖/发现/保证边界). `at`, provider/model and session_id are stamped by Code — the caller supplies only this text. When reviewer_child_agent_id is given, this MUST match the subagent's captured conclusion verbatim (or be omitted to adopt it)." },
    reviewer_child_agent_id: { type: "string", description: "record_review: relay an ISOLATED SUBAGENT's review — pass its agent id (from the subagent tool). The identity and the conclusion text are then taken from the host's own subagent registry (Code-observed, not settable by the caller), so the implementer can neither forge the reviewer's identity nor substitute its own text. Omit to record YOUR OWN session's review (then your session must differ from the implementer's)." }
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
    case "workcase-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "approve", "execute", "close", "rebatch", "cancel", "revise", "record_review"] },
          frontmatter_draft: workcaseFrontmatter,
          body_markdown: { type: "string", description: "create: the body markdown starting with '## 摘要' (H2 sections 摘要/授权范围/计划; the H1 is generated from title)" },
          routing_request: { type: "string", description: "create: the Human's request in their own words, shown in the 21 §6.3 routing prompt (e.g. 「帮我把 X 改掉」). Optional but strongly recommended — it is what lets the Human recognise which piece of work is being routed." },
          routing_rationale: {
            type: "object",
            description: "create: the AI's 21 §6.3 reasoning, shown in the routing prompt so the Human can judge. Advisory text only — it is not part of what is accepted.",
            properties: {
              forWorkcase: { type: "array", items: { type: "string" }, description: "倾向建工单的理由（如：涉及多处改动 / 需独立复核 / 可能跨会话）" },
              forDirect: { type: "array", items: { type: "string" }, description: "倾向直接执行的理由（如：改动范围小、单文件）" },
            },
          },
          approver: { type: "string", description: "approve: the approving Human identity — stamped into gate_1.approver (21 §10.1)" },
          controller: { type: "string", description: "approve: the executing controller identity — stamped into attempt.controller (21 §10.4)" },
          gate1_request: {
            type: "object",
            description: "approve: the Gate 1 request elements that have NO object-field carrier (21 §10.1 必含). Plan/serves/scope are already carried by fields and are not repeated here. Required keys: independent_review (独立复核的安排 — who runs it, how many perspectives), unauthorized_action_guard (越权动作被机械拒绝的机制), unverified_scope_and_risks (未验证范围与风险), approved_scope_and_next (批准的作用范围与后续方向). Each must be a non-empty string; omissions are rejected rather than passing silently.",
            properties: {
              independent_review: { type: "string", description: "独立复核的安排：由谁复核、几个视角、何时（21 §10.1 + 32 §12 按风险选最小充分视角）" },
              unauthorized_action_guard: { type: "string", description: "越权动作被机械拒绝的机制" },
              unverified_scope_and_risks: { type: "string", description: "未验证范围与风险" },
              approved_scope_and_next: { type: "string", description: "批准的作用范围与后续方向" },
            },
            required: ["independent_review", "unauthorized_action_guard", "unverified_scope_and_risks", "approved_scope_and_next"],
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
          body_markdown_after: { type: "string", description: "execute/close/rebatch/cancel/revise: the complete next body starting with '## 摘要' (no H1 — generated from title). 「执行」节记账纪律（21 §8）：引用计划步骤时写「计划步骤 N」，N 以当前 plan 为界（approve 返回的 plan_step_reference 给出权威清单）；复核、补充验证、收尾等非计划步骤事项独立描述，不要续编进计划序号——plan 的位置序号是该类型唯一的计划步骤编号体系" },
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
