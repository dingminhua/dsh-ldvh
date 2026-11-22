
import { recallForAction } from "./source-recall.js";

export const CONSULT_POINT = "research";

export const CONSULT_ANSWERS = Object.freeze({
  RESEARCH: "research",
  SKIP: "skip",
});

export const INTERNAL_LOOKUP_TYPES = Object.freeze(["pitfall", "report", "norm"]);

export const INTERNAL_LOOKUP_LIMIT = 8;

export const RESEARCH_TOOL_NAME = "ldvh_research_consult";

export const RESEARCH_OPERATION_SUMMARY = [
  "「该联网调查吗」的前置闸门：先在内部事实源查是否已有相关经验、报告或事实规范，只有查不到才向 Human 提请联网。",
  "",
  "WHEN TO CALL: 主控自查判断当前判断依赖外部对象的信息、而自己不掌握时（33 §5.1 进入信号第 1 条），先调本工具，而不是直接开检索。",
  "内部查找命中 → 直接返回内部候选，不提请；内部未命中 → 经宿主询问接缝向 Human 提请「要不要联网调查」，获准后返回派发模板（派零上下文调研子代理，走 33 号调研会话机器取证）。",
  "",
  "第①步的内部查找是**确定性词面匹配**（34 号召回同一求值器）：命中即用内部结论，未命中**不构成**「内部没有」——结论只能写「机械召回未命中」，并须按机制补检（ldvh_pitfall_list / ldvh_report_list / ldvh_norm_list 与载体 grep）。",
  "",
  "第③步的提请是征询，不是 Gate：答复不构成授权凭据，也不使行动在取得答复前暂停（00 §2.5、32 §3.4）；未取得答复按既有路径继续并如实说明。",
  "",
  "该处受一枚同形开关约束（与行动前／收口前两处同一形态，缺省关闭）：开关关闭时本工具只交还内部读数、不发出提请；开关状态读不到时按「不可用」如实报告，不当作已关闭。",
  "",
  "本工具不判断「该不该联网」——那是主控自查（04 §6.1），机械层不判定，故不构成机械保障（00 §4.6）。",
].join("\n");

function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function buildInternalQuery({ need, keywords, scope } = {}) {
  const parts = [];
  const subject = trimmed(need);
  if (subject !== null) parts.push(subject);
  if (Array.isArray(keywords)) {
    for (const keyword of keywords) {
      const value = trimmed(keyword);
      if (value !== null) parts.push(value);
    }
  }
  const extra = trimmed(scope);
  if (extra !== null) parts.push(extra);
  return parts.join(" ");
}

export async function internalLookup({ root, need, keywords, scope, limit } = {}) {
  const query = buildInternalQuery({ need, keywords, scope });
  if (query === "") {
    return { ok: false, error: { code: "consult/no_query", message: "内部查找需要至少一个可匹配的描述（need 或 keywords）" } };
  }
  const recall = await recallForAction({
    action: query,
    types: [...INTERNAL_LOOKUP_TYPES],
    includeSpecs: false,
    limit: Number.isInteger(limit) && limit > 0 ? limit : INTERNAL_LOOKUP_LIMIT,
    root,
  });
  if (recall?.ok !== true) {
    return { ok: false, error: recall?.error ?? { code: "consult/recall_failed", message: "内部查找没有返回可判定结果" } };
  }
  const facts = Array.isArray(recall.facts) ? recall.facts : [];
  const gaps = Array.isArray(recall.gaps) ? recall.gaps : [];
  const sourceUnread = gaps.some((gap) => typeof gap === "string" && gap.includes("事实源不可读"));
  const hits = facts.map((card) => ({
    type: card.type ?? null,
    object_uid: card.objectUid ?? card.ref ?? null,
    title: card.title ?? null,
    status: card.status ?? null,
    path: card.path ?? null,
    excerpt: card.excerpt ?? null,
    match_reason: card.hitReason ?? null,
    weak_hit: card.weakHit === true,
  }));
  return {
    ok: true,
    query,
    hits,
    counts: recall.counts ?? null,
    completeness: recall.recallCompleteness ?? null,
    source_read: !(sourceUnread || recall.recallCompleteness === "unavailable"),
    gaps,
    proves_applicability: false,
    coverage_note: "命中与不命中都不证明适用：机械召回是确定性词面匹配，换个说法就会漏，未命中也不代表没有同类经验（34 §12）",
  };
}

export function classifyInternalHits(hits) {
  const list = Array.isArray(hits) ? hits : [];
  const strong = list.filter((hit) => hit.weak_hit !== true);
  const weak = list.filter((hit) => hit.weak_hit === true);
  return {
    strong,
    weak,
    usable: strong.length > 0,
    note: strong.length > 0
      ? "内部有实质命中（强命中），构成可用的内部结论候选"
      : (weak.length > 0
        ? "内部只有弱命中（通用词／单字碰撞），不构成「内部已有可用结论」——按 34 §12，弱命中与未命中同样不证明适用"
        : "内部未命中"),
  };
}

export function composeConsultQuestion({ need, scope } = {}) {
  const subject = trimmed(need) ?? "这件事";
  const extra = trimmed(scope);
  const head = extra === null
    ? `${subject}——要不要联网调查？`
    : `${subject}——要不要联网调查？（范围：${extra}）`;
  return { question: head };
}

const RESEARCH_DISCIPLINE = [
  "## 硬性约束",
  "",
  "- **只取证**：不得修改任何文件、不得改动仓库状态；只在临时目录写一次性脚本。",
  "- **每条结论都要有可回指的外部来源**：HTTP(S) URL + 锚点 + 逐字摘录。找不到就说找不到，不要用记忆或推断冒充检索结果。",
  "- **三态如实标注**：查到了（confirmed）、查到了但不确定（uncertain）、查不到（gap）——「查不到」本身就是结论，不得用近似材料顶替。",
  "- **区分来源性质**：官方文档与规范原文优先；博客、论坛、issue 只作线索，须标明其权威性限度。",
  "- **不越界**：只回答派发单里的问题，不擅自扩大到相邻话题；范围需要扩张时在缺口项里说明，由主控决定是否继续。",
];

const RESEARCH_OUTPUT_FORMAT = [
  "## 输出格式",
  "",
  "按轮次提交，每条发现一项，字段如下：",
  "",
  "- **statement**：一句话事实断言（不要写结论语气）",
  "- **state**：confirmed / uncertain / gap",
  "- **evidence**（仅 confirmed）：text 逐字摘录、source 完整 HTTP(S) URL、anchor 可定位锚点、confidence high/medium/low",
  "- **issue** / **reason**（仅 uncertain）：悬而未决之处与原因",
  "- **description** / **priority**（仅 gap）：缺口描述与优先级 high/medium/low",
  "",
  "结尾给一句：本轮新增了哪些已证事实、还剩哪些缺口、下一轮该换什么检索路径。",
];

export function composeResearchDispatchTemplate({ need, purpose, scope, subQuestions, keywords } = {}) {
  const subject = trimmed(need) ?? "（主控未提供调研问题——先向主控澄清，不要自行编造）";
  const goal = trimmed(purpose);
  const extra = trimmed(scope);
  const subs = Array.isArray(subQuestions)
    ? subQuestions.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  const terms = Array.isArray(keywords)
    ? keywords.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  const lines = [];
  lines.push("# 联网调研任务（33 号调研吸收 · 定向取证）");
  lines.push("");
  lines.push("你是一位**零上下文**调研子代理：你没有读过主控的对话，也不知道这个项目此前发生过什么。**请只依据你检索到的外部资料作答**，不要用推测补空白。");
  lines.push("");
  lines.push("## 调研问题");
  lines.push("");
  lines.push(subject);
  lines.push("");
  if (goal !== null) {
    lines.push("## 这次查证服务于哪个判断");
    lines.push("");
    lines.push(goal);
    lines.push("");
  }
  if (extra !== null) {
    lines.push("## 范围限定");
    lines.push("");
    lines.push(extra);
    lines.push("");
  }
  if (subs.length > 0) {
    lines.push("## 子问题（每条都要有覆盖）");
    lines.push("");
    subs.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    lines.push("");
  }
  if (terms.length > 0) {
    lines.push("## 建议检索词");
    lines.push("");
    lines.push(terms.join("、"));
    lines.push("");
  }
  lines.push("## 你不需要做的");
  lines.push("");
  lines.push("- **不要下「该怎么做」的结论**：那是主控的方案收敛职责（04 §6.1）。你只提供证据。");
  lines.push("- **不要改仓库里的任何东西**：结论由主控按 33 号流程回写。");
  lines.push("- **不要因为找不到就停止**：换检索路径再找；确实查不到就如实报 gap，那是有价值的结论。");
  lines.push("");
  lines.push(...RESEARCH_DISCIPLINE);
  lines.push("");
  lines.push(...RESEARCH_OUTPUT_FORMAT);
  return lines.join("\n");
}

export function researchDispatchTemplate(inputs = {}) {
  return {
    point: CONSULT_POINT,
    kind: "online-research",
    prompt: composeResearchDispatchTemplate(inputs),
  };
}

export function internalHitLines(hits) {
  return (Array.isArray(hits) ? hits : []).map((hit, index) => {
    const uid = hit.object_uid ?? "(无 uid)";
    const title = hit.title ?? "(无标题)";
    const reason = hit.match_reason ?? "";
    return `${index + 1}. [${hit.type ?? "?"}] ${uid} ${title}${reason === "" ? "" : ` —— ${reason}`}`;
  });
}
