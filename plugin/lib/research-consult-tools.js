
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toParameterSpec } from "./parameter-spec-adapter.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import {
  CONSULT_ANSWERS,
  INTERNAL_LOOKUP_LIMIT,
  RESEARCH_OPERATION_SUMMARY,
  classifyInternalHits,
  internalHitLines,
  internalLookup,
  researchDispatchTemplate,
} from "./research-consult.js";

const OPERATIONS = {
  "research-consult": {
    toolName: "ldvh_research_consult",
    summary: RESEARCH_OPERATION_SUMMARY,
    effect: "read",
    awaitsHumanDecision: true
  }
};

const INTERNAL_READING_LINE = "交付说明里如实写内部读数：命中哪些／未命中；未命中只能写「按机制查过而未命中」，不得写成「内部没有相关经验」（34 §12）";

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

function unavailable(operationKey, gaps, requested) {
  return envelope(operationKey, "unavailable", {
    result: { decision: null, asked: false },
    scope: { requested: requested ?? operationKey, completed: [], not_completed: [requested ?? operationKey] },
    sources: [],
    gaps,
    verification: { checks: [], passed: false },
    follow_up: ["如实报告该处未取得能力或未取得答复；不得以自述代替（00 §4.6）"]
  });
}

function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function governedProject(deps, exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  const scope = await resolveGovernanceScope(deps?.dshHomePath, cwd);
  if (scope.state !== "governed") {
    return { ok: false, scope };
  }
  return { ok: true, scope, project: scope.project };
}

function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  const result = env.result;
  if (result?.internal_found !== undefined) lines.push(`internal_found: ${result.internal_found}`);
  if (result?.internal_hit_count !== undefined) lines.push(`internal_hits: ${result.internal_hit_count}`);
  if (result?.internal_weak_hit_count !== undefined) lines.push(`internal_weak_hits: ${result.internal_weak_hit_count}`);
  if (result?.internal_source_read !== undefined) lines.push(`internal_source_read: ${result.internal_source_read}`);
  if (result?.decision !== undefined) lines.push(`decision: ${result.decision ?? "null"}`);
  if (result?.asked !== undefined) lines.push(`asked: ${result.asked}`);
  if (result?.need !== undefined) lines.push(`need: ${result.need}`);
  if (Array.isArray(result?.internal_hits)) {
    for (const line of internalHitLines(result.internal_hits)) lines.push(`- ${line}`);
  }
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  for (const next of env.follow_up ?? []) lines.push(`follow_up: ${typeof next === "string" ? next : JSON.stringify(next)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchema() {
  return {
    type: "object",
    properties: {
      need: {
        type: "string",
        description: "要查清什么（一句话）。写主控自己不掌握、依赖外部对象信息的那一点（33 §5.1 进入信号第 1 条）"
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "第①步内部查找用的检索词（针对内部经验、报告、事实规范）。多写几个同义说法——机械召回是词面匹配，换个说法就会漏"
      },
      scope: {
        type: "string",
        description: "范围限定（时间、版本、适用场景），会进入提请标题与内容指纹"
      },
      purpose: {
        type: "string",
        description: "这次查证服务于哪个判断（写进派发模板，让调研子代理知道要支撑什么）"
      },
      sub_questions: {
        type: "array",
        items: { type: "string" },
        description: "子问题（交给 33 号调研会话做覆盖检查，每条都要有覆盖）"
      },
      internal_gap: {
        type: "string",
        description: "「内部已有 X 仍缺 Y」的说明。提供它表示主控判定内部结论不足以回答本次需要，即使内部有强命中也继续走提请（33 §6.6 第 1 项）"
      },
      limit: {
        type: "number",
        description: `内部查找返回条数上限（默认 ${INTERNAL_LOOKUP_LIMIT}）`
      }
    },
    required: ["need"],
    additionalProperties: false
  };
}

function internalFoundEnvelope(args, lookup, classified) {
  const hits = classified.strong;
  const weak = classified.weak;
  const followUp = [
    "先按 object_uid 精确读这些内部对象再判断是否够用；命中是候选不是结论，适用性由你判（02 §9.2）",
    "内部结论不足以回答本次需要时，带 internal_gap 参数再次调用本工具（写明「内部已有 X 仍缺 Y」），本工具会据此继续提请联网",
    INTERNAL_READING_LINE,
    weak.length > 0
      ? `另有 ${weak.length} 条弱命中（通用词／单字碰撞），不构成可用结论`
      : "",
    lookup.source_read === false
      ? "注意：本次内部事实源未检查成功，见 gaps——读数不等于「未命中」"
      : "本次只查事实侧（按设计不读规范源），故召回完整度恒为 partial；命中与否以 hits 为准"
  ].filter((line) => line !== "");
  return envelope("research-consult", "completed", {
    result: {
      need: trimmed(args?.need),
      internal_found: true,
      internal_hit_count: hits.length,
      internal_hits: hits,
      internal_weak_hit_count: weak.length,
      internal_source_read: lookup.source_read,
      internal_completeness: lookup.completeness,
      asked: false,
      decision: null,
      consult_required: false
    },
    scope: { requested: "internal-lookup", completed: ["internal-lookup"], not_completed: ["consult"] },
    sources: [{ kind: "fact-source", path: "ldvh-base" }],
    gaps: lookup.gaps,
    verification: { checks: ["internal-lookup", "governance-scope"], passed: true },
    follow_up: followUp
  });
}

function consultEnvelope(args, lookup, classified, outcome, escalation) {
  const decision = outcome?.decision ?? null;
  const asked = outcome?.asked === true;
  const sourceUnread = lookup.source_read === false;
  const gaps = [...lookup.gaps];
  if (sourceUnread) {
    gaps.push("内部事实源不可读：本次**未检查**内部事实源——这不是「未命中」，交付说明不得这样写");
  }
  if (outcome?.recordError !== undefined) gaps.push(`答复未能留痕（${outcome.recordError}）——重试会再次提问`);
  if (outcome?.reason !== undefined && decision === null) gaps.push(outcome.reason);
  const outcomeKind = sourceUnread ? "partial" : (decision === null ? "partial" : "completed");
  const commonResult = {
    need: trimmed(args?.need),
    internal_found: classified.usable,
    internal_hit_count: classified.strong.length,
    internal_hits: classified.strong,
    internal_weak_hit_count: classified.weak.length,
    internal_source_read: lookup.source_read,
    internal_completeness: lookup.completeness,
    asked,
    decision,
    consult_required: decision === CONSULT_ANSWERS.RESEARCH,
    ...(outcome?.custom_note === undefined ? {} : { custom_note: outcome.custom_note })
  };
  const commonFollowUp = [
    INTERNAL_READING_LINE,
    escalation === "internal-gap"
      ? "本次提请的理由是主控声明的内部缺口（internal_gap），须在交付说明里一并写出「内部已有 X 仍缺 Y」"
      : (escalation === "weak-only"
        ? "本次提请的理由是内部只有弱命中，不构成可用结论"
        : "本次提请的理由是内部未命中（按机制查过）")
  ];
  if (decision === CONSULT_ANSWERS.RESEARCH) {
    return envelope("research-consult", outcomeKind, {
      result: {
        ...commonResult,
        research_template: researchDispatchTemplate({
          need: args?.need,
          purpose: args?.purpose,
          scope: args?.scope,
          subQuestions: args?.sub_questions,
          keywords: args?.keywords
        })
      },
      scope: { requested: "consult", completed: ["internal-lookup", "consult"], not_completed: sourceUnread ? ["internal-lookup"] : [] },
      sources: [{ kind: "host-service", path: "userQuestions" }],
      gaps,
      verification: { checks: ["internal-lookup", "governance-scope", "answer-distinguishable"], passed: !sourceUnread },
      follow_up: [
        "用 `subagent` 派生一个**零上下文**调研子代理（不要用 subagent_fork——它会继承你的全部上下文），把 research_template.prompt 原样作为它的 prompt",
        "调研子代理交回三态证据后：用 ldvh_report_session 的 create → submit-round → audit-citation → check-delivery → finalize 走完 33 号机器",
        "finalize 之后用 ldvh_report_write 创建 report_form=research 的报告（urls 必填、逐字摘录须与证据条目一致）",
        "答复只表明「被问过并给出安排／不安排」，不构成授权凭据（00 §2.5、32 §9.1）",
        ...commonFollowUp
      ]
    });
  }
  if (decision === CONSULT_ANSWERS.SKIP) {
    return envelope("research-consult", outcomeKind, {
      result: commonResult,
      scope: { requested: "consult", completed: ["internal-lookup", "consult"], not_completed: sourceUnread ? ["internal-lookup"] : [] },
      sources: [{ kind: "host-service", path: "userQuestions" }],
      gaps,
      verification: { checks: ["internal-lookup", "governance-scope", "answer-distinguishable"], passed: !sourceUnread },
      follow_up: [
        "Human 明确选择先不联网：按既有路径继续",
        ...commonFollowUp
      ]
    });
  }
  return envelope("research-consult", "partial", {
    result: commonResult,
    scope: { requested: "consult", completed: ["internal-lookup"], not_completed: ["consult"] },
    sources: [{ kind: "host-service", path: "userQuestions" }],
    gaps: [
      ...gaps,
      "未取得答复：没有答复即没有决定，不得读成 skip（32 §9.1）；答复也不是行动放行的前提，不得据此暂停整件工作（00 §2.5、32 §3.4）"
    ],
    verification: { checks: ["internal-lookup", "governance-scope", "answer-distinguishable"], passed: false },
    follow_up: [
      "按既有路径继续，并在交付说明里如实写明「该处未取得答复、已直接推进」",
      "同内容下次仍会问；如需明确决定请重新提请",
      ...commonFollowUp,
      ...(outcome?.custom_note === undefined
        ? []
        : ["Human 在自由输入框写了字（见 custom_note）：逐字读它并纳入本轮判断，不要当成跳过"])
    ]
  });
}

export async function executeResearchConsult(args, exec, deps) {
  const need = trimmed(args?.need);
  if (need === null) {
    return invalidRequest("research-consult", "need 必填：要查清什么（一句话）", "need");
  }
  const scope = await governedProject(deps, exec);
  if (scope.ok !== true) {
    return unavailable(
      "research-consult",
      [`管辖状态为 ${scope.scope.state}：本工具在受管辖项目内服务（33 号调研吸收的适用面）`],
      "consult"
    );
  }
  const lookup = await internalLookup({
    root: scope.project.path,
    need,
    keywords: args?.keywords,
    scope: args?.scope,
    limit: args?.limit
  });
  if (lookup.ok !== true) {
    return unavailable("research-consult", [`${lookup.error.code}: ${lookup.error.message}`], "internal-lookup");
  }
  const classified = classifyInternalHits(lookup.hits);
  const internalGap = trimmed(args?.internal_gap);
  const escalation = internalGap !== null ? "internal-gap" : (classified.usable ? null : (classified.weak.length > 0 ? "weak-only" : "no-hit"));
  if (classified.usable && escalation === null) {
    return internalFoundEnvelope(args, lookup, classified);
  }
  const seam = deps?.hostSeams;
  if (typeof seam?.requestResearchConsult !== "function") {
    return unavailable(
      "research-consult",
      ["宿主询问接缝（requestResearchConsult）在本组合不可用，无法提请——如实报告，不得以自述代替答复（00 §4.6）"],
      "consult"
    );
  }
  const outcome = await seam.requestResearchConsult({
    need,
    scope: trimmed(args?.scope),
    keywords: args?.keywords,
    internalGap,
    agent: exec?.agent,
    signal: exec?.signal
  });
  return consultEnvelope(args, lookup, classified, outcome, escalation);
}

export function toolDescriptorFor(operationKey, operation, handler) {
  return defineTool({
    name: operation.toolName,
    description: operation.summary,
    parameters: toParameterSpec(parameterSchema()),
    ...(operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 }),
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
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => renderEnvelope(operationKey, value) }
  });
}

export function registerResearchConsultTools(ctx, deps) {
  const handlers = {
    "research-consult": (args, exec) => executeResearchConsult(args, exec, deps)
  };
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    disposers.push(ctx.tools.register(toolDescriptorFor(operationKey, operation, handlers[operationKey])));
  }
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch {   }
    }
  };
}

export { OPERATIONS };
