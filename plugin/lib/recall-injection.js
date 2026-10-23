// recall-injection.js —— 行动前召回注入（双源召回的触发侧）
//
// ## 权威
//
// `specs/10 §5.3`（DSH 环境接入与插件发布规范）逐字：
//   「行动前引导入口：经 `agent/pre-step` waterfall 事件（载荷
//    `{agent, messages, turn, step, signal}`）**在来源定义的触发时机**提供事实候选
//    与既有行动结构路由。」
//
// `specs/02 §9.2`（召回进入条件）逐字：
//   「AI 已明确当前目标后，只有在项目事实对当次理解、判断、验证或行动确实必要，
//    或当前输入精确引用稳定事实时，才进入事实消费分支。新会话、压缩、委派或生命周期
//    事件本身不自动证明事实消费必要，也不自动证明事实不存在。」
//
// `specs/05 §9.2`（传输边界）逐字：
//   「F0–F2 候选、预热卡、分页结果或概率提示不得被写成 F3/F4 已读、事实适用、
//    行动允许或事实声明。」
//
// ## 本模块做什么、不做什么
//
// **做**：在 pre-step 的 step 1，用**本回合的用户消息**作查询，调双源召回，
// 把命中的候选渲染成一行可见的上下文注入（含命中理由与预算状态）。
//
// **不做**（每条都有规范依据）：
// - 不声称「已适用」——`02 §9.2` 与 `34 §13` 都写明召回命中不等于适用，
//   注入行只列候选，定性由 AI 后续判断。
// - 不无条件注入——`02 §9.2` 明确「新会话、压缩、委派或生命周期事件本身不自动
//   证明事实消费必要」。故本模块设**进入条件**：只有从本回合用户消息里能提出
//   有效的行动性 token 时才召回（见 `enterFactConsumption`）。
// - 不重复注入不变的内容——digest 去重（与管辖判定行同机制）。
// - 不静默截断——超预算如实写在注入行里（`05 §9.2`「超预算、分页、不可用和未
//   展开范围必须据实返回 partial/unavailable」）。
// - 不建索引、不落盘、不写事实源（`34 §17` 第 1 项、`02 §9.2`）。

import { recallForAction } from "./source-recall.js";

/** 注入行可见摘要（Human 侧折叠时看到的短标签）。 */
export const RECALL_SUMMARY = "双源召回 · dsh-ldvh · 行动前候选";

/** 沉默阈值：命中少于这个数就不注入（避免每回合刷空行）。 */
const MIN_HITS = 1;

/** 默认单次注入预算（字节）。与 guidance 的 1500 分开计——两者是不同的注入面。 */
export const RECALL_CHAR_BUDGET = 900;

/**
 * 判断本回合是否进入事实消费（`02 §9.2` 的进入条件）。
 *
 * `02 §9.2` 禁止「新会话/压缩/委派/生命周期事件本身」作为进入理由。本函数因此
 * **只看用户消息本身**：从里面提不出有效 token 就不进——那样召回必然空手，
 * 注入一行空候选既无用，也正是 `02 §9.2` 要防的「无条件全量注入」。
 *
 * @param {string} text 本回合用户消息文本
 * @returns {boolean}
 */
export function enterFactConsumption(text) {
  if (typeof text !== "string") return false;
  // 去掉空白与纯标点后还剩至少 4 个字符，才认为「有可召回的内容」。
  // 短于这个长度的输入（"好"、"继续"、"ok"）不足以构成查询，强行召回只会
  // 返回噪声，反而让注入行变成每回合的固定噪音。
  const meaningful = text.replace(/[\s\p{P}\p{S}]/gu, "");
  return meaningful.length >= 4;
}

/**
 * 从 pre-step 载荷的 messages 里取出**本回合用户消息**文本。
 *
 * 载荷结构由 `10 §5.3` 定义为 `{agent, messages, turn, step, signal}`。
 * `messages` 是本回合装配的批次（不含历史），故末条 user 消息即本回合输入。
 * 我们自己注入的行也带 `role: "user"`，须排除（否则会拿注入结果当查询）。
 *
 * @param {unknown[]} messages
 * @param {(m: object) => boolean} isOwnMessage 判定是否本插件注入的行
 * @returns {string} 取不到时返回空串
 */
export function currentUserText(messages, isOwnMessage) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message === null || typeof message !== "object") continue;
    if (message.role !== "user") continue;
    if (typeof isOwnMessage === "function" && isOwnMessage(message)) continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((part) => part !== null && typeof part === "object" && part.type === "text")
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text !== "") return text;
  }
  return "";
}

/**
 * 渲染注入行文本（模型侧看到的就是这段）。
 *
 * 措辞纪律：**只说候选，不说适用**。`02 §9.2` 与 `34 §13` 都明文召回命中不等于
 * 适用，故行首用「候选」而非「应遵守/已适用」；每行带命中理由，使 AI 能核对
 * 「为什么这条被认为相关」而不是盲信。
 *
 * @param {{specs: object[], facts: object[], truncated: boolean, budget: object}} result
 * @returns {string}
 */
export function renderRecallRow(result) {
  const specs = Array.isArray(result?.specs) ? result.specs : [];
  const facts = Array.isArray(result?.facts) ? result.facts : [];
  const lines = [];
  lines.push("【双源召回 · 行动前候选】");
  lines.push("以下由确定性匹配从规范源与事实源取得，是**候选**不是结论：召回的命中不等于适用（02 §9.2／34 §13），是否适用须自行判断。");
  if (specs.length > 0) {
    lines.push("规范源：");
    for (const spec of specs) {
      lines.push(`- ${spec.title}（${spec.path}）— ${spec.hitReason}`);
    }
  }
  if (facts.length > 0) {
    lines.push("事实源：");
    for (const fact of facts) {
      const status = typeof fact.status === "string" && fact.status !== "" ? `/${fact.status}` : "";
      lines.push(`- [${fact.type}${status}] ${fact.title}（${fact.path}）— ${fact.hitReason}`);
    }
  }
  if (specs.length === 0 && facts.length === 0) {
    lines.push("本次未命中候选。这不证明「无相关约束」——确定性匹配会漏（换个说法就漏），必要时请自行扩大检索。");
  }
  if (result?.truncated === true) {
    lines.push(`（超出预算已裁剪：上限 ${result.budget?.limitBytes ?? "?"} 字节，实际用 ${result.budget?.usedBytes ?? "?"} 字节。未列出的部分不代表不存在。）`);
  }
  return lines.join("\n");
}

/**
 * 执行一次召回并决定是否注入。
 *
 * @param {object} input
 * @param {string} input.userText 本回合用户消息
 * @param {string} input.projectRoot 管辖项目根（事实源在 `<root>/ldvh-base`）
 * @param {number} [input.budgetBytes]
 * @returns {Promise<{inject: false, reason: string} | {inject: true, text: string, digest: string, result: object}>}
 */
export async function buildRecallInjection({ userText, projectRoot, budgetBytes } = {}) {
  if (typeof projectRoot !== "string" || projectRoot === "") {
    return { inject: false, reason: "no-project" };
  }
  // 02 §9.2 进入条件：用户消息不足以构成查询时不进。
  if (!enterFactConsumption(userText)) {
    return { inject: false, reason: "no-fact-consumption" };
  }
  let result;
  try {
    result = await recallForAction({
      action: userText,
      root: projectRoot,
      limit: 3,
      budgetBytes: Number.isInteger(budgetBytes) ? budgetBytes : RECALL_CHAR_BUDGET,
    });
  } catch (error) {
    // 召回失败不拦回合（它是输入侧，不是闸门）；如实标出原因，不假装「无相关」。
    return { inject: false, reason: `recall-failed:${error instanceof Error ? error.message : String(error)}` };
  }
  if (result?.ok !== true) {
    return { inject: false, reason: `recall-unavailable:${result?.error?.code ?? "unknown"}` };
  }
  const total = (result.specs?.length ?? 0) + (result.facts?.length ?? 0);
  if (total < MIN_HITS) {
    // 一条都没命中就不注入——`02 §9.2` 要防的正是「无条件注入」。
    // 不注入不等于「无相关」，故这里只在返回值里说明，不写进上下文。
    return { inject: false, reason: "no-hits" };
  }
  const text = renderRecallRow(result);
  return { inject: true, text, digest: text, result };
}
