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
//   命中 34 §6 进入信号（或判不出、按不确定处理）时才召回（见 `classifyEntry`）。
// - 不重复注入不变的内容——digest 去重（与管辖判定行同机制）。
// - 不静默截断——超预算如实写在注入行里（`05 §9.2`「超预算、分页、不可用和未
//   展开范围必须据实返回 partial/unavailable」）。
// - 不建索引、不落盘、不写事实源（`34 §17` 第 1 项、`02 §9.2`）。

import { recallForAction } from "./source-recall.js";

/** 注入行可见摘要（Human 侧折叠时看到的短标签）。 */
export const RECALL_SUMMARY = "双源召回 · dsh-ldvh · 行动前候选";

/** 沉默阈值：命中少于这个数就不注入（避免每回合刷空行）。 */
const MIN_HITS = 1;

/**
 * 默认单次注入预算（字节）。与 guidance 的 1500 分开计——两者是不同的注入面。
 *
 * 定值依据（实测，2026-10-24）：`limit: 3` 时三条规范的候选卡约 1400–1500 字节、
 * 三条事实约 870–910 字节，合计约 **2300 字节**。原定 900 字节导致**每一条**都被
 * 裁到只剩 1–2 项且 `truncated` 恒为 true——预算过紧时它不再起「防超量」作用，
 * 反而使召回常态性不完整。
 * 故定为 2400：足以容纳 3 规范 + 3 事实，仍对更大结果形成硬上限
 * （`fd133f0d` A3 要求预算为机械约束，不是无上限）。
 */
export const RECALL_CHAR_BUDGET = 2400;

/**
 * 改变状态的动作标记（`34 §6` 进入信号第 1 项：「即将执行会产生副作用或改变
 * 状态的动作」）。
 *
 * 这是**判断辅助**而非规范清单：34 §6 给的是语义条件，不是词表。词表只能近似，
 * 故本函数的产出必须允许「不确定」这一档（见 `classifyEntry`），不得把「没匹配上」
 * 当作「不在范围内」——那正是 §6 不确定处理禁止的「按无约束处理」。
 */
const WRITE_ACTIONS = Object.freeze([
  "改", "修改", "写入", "写", "新增", "增加", "加", "删除", "删", "移除", "重命名", "改名",
  "创建", "建", "建立", "提交", "commit", "push", "合并", "merge", "回滚", "revert",
  "安装", "卸载", "升级", "配置", "部署", "发布", "迁移", "更新", "修正", "重写", "重构",
  "设置", "调整", "替换", "覆盖", "清空", "落盘", "保存", "生成", "起草", "实现", "修复",
]);

/**
 * 纯读取与纯查询的动作标记（`34 §6` 排除条件：「纯读取与纯查询动作不进入本系统」）。
 */
const READ_ACTIONS = Object.freeze([
  "看", "看看", "读", "读一下", "查", "查看", "查询", "列", "列出", "列一下", "找", "找出",
  "搜", "搜索", "检索", "统计", "数一下", "有几", "多少", "是什么", "为什么", "有哪些",
  "解释", "说明", "告诉我", "show", "list", "read", "find", "search", "grep", "cat",
]);

/**
 * `34 §6` 进入判定的三态结果。
 *
 * **为什么必须是三态而不是布尔**：`34 §6`「不确定处理」明文——
 * 「适用性无法判定时，**不得**按『无约束』处理……须将该项登记为未验证范围」。
 * 一个 `boolean` 必然把「读不出动作性质」压成 `false`，那就是按无约束处理。
 *
 * - `enter`：命中 §6 进入信号（有改变状态的迹象），或无迹象但也不像纯读（不确定→按进入处理）
 * - `exclude`：命中 §6 排除条件（纯读取/纯查询），明确不进
 * - `uncertain`：读不出动作性质，且输入过短无法判断
 */
export const ENTRY_VERDICTS = Object.freeze(["enter", "exclude", "uncertain"]);

/**
 * 判定本回合是否进入（`34 §6` 进入信号 + 排除条件，不是 `02 §9.2`）。
 *
 * **这里判的是「时点」，不是「必要性」**——`02 §9.2` 判「值不值得查」（通用），
 * `34 §6` 判「现在是不是该查的那个点」（本业务过程）。二者正交，不可互相替代：
 * 本函数只回答后者。进入之后再由召回本身决定有没有东西可给。
 *
 * 判据优先级（依据 `34 §6` 的节内顺序）：
 * 1. 先看**排除条件**：纯读取/纯查询 → `exclude`（§6 明文排除）。
 * 2. 再看**进入信号**：有改变状态的迹象 → `enter`。
 * 3. 两者都不命中 → `uncertain`，**按进入处理**（§6 不确定处理：不得按无约束）。
 *
 * @param {string} text 本回合用户消息文本
 * @returns {"enter" | "exclude" | "uncertain"}
 */
export function classifyEntry(text) {
  // 空输入不是「判不出来」，是「没有动作可言」——故排除，不归不确定。
  if (typeof text !== "string") return "uncertain";
  if (text.trim() === "") return "exclude";
  const normalized = text.toLowerCase();

  // **本函数的精度边界（必须如实声明，`00 §5.6`）**
  //
  // 34 §6 的进入信号是**语义条件**（「会产生副作用或改变状态的动作」），词表匹配
  // 只能近似。实测它有两种确定的错误：
  //   (a) 「看看这些 ADR 是怎么**写**的」——询问句，但含「写」字，被判为写动作；
  //   (b) 「改这个文件好不好」——征询，不是执行。
  //
  // 因此本函数**不声称能精确判定动作性质**。它只做一件事：把**明显**的纯读取
  // 排掉（「看看」「列出」「查一下」这类，这是误召回的主要来源），其余一律交给
  // 保守方向——进入。
  //
  // 判据：**读与写字典同时命中时判 enter**（因为写迹象意味着可能改状态，而 §6
  // 不确定处理禁止按无约束跳过）；**只命中读**才排除。这样 (a) 会被判 enter ——
  // 即「多召回一次」，代价是多注入一行候选，而不是漏掉一次本该做的召回。
  // 这个方向是刻意的：漏召回的代价高于多召回。
  const isRead = READ_ACTIONS.some((word) => normalized.includes(word.toLowerCase()));
  const isWrite = WRITE_ACTIONS.some((word) => normalized.includes(word.toLowerCase()));
  if (isWrite) return "enter";
  if (isRead) return "exclude";

  // 既无读也无写迹象：可能是「这个怎么理解」这类纯对话，也可能是「把它弄好」这类
  // 隐含动作。§6 不确定处理要求不得按无约束处理，故判 uncertain 并按进入处理。
  // 但过短的输入（「好」「继续」）没有可召回的内容，强行召回只会刷噪声，
  // 这种情形归 exclude —— 它不是「可能改状态」，而是「没有动作可言」。
  const meaningful = text.replace(/[\s\p{P}\p{S}]/gu, "");
  // 阈值 3：让「继续」「ok」「好的」这类**没有动作内容**的短句排除。
  // 它们不是「判不出来要保守召回」，而是根本没有可召回的东西——强行为它们
  // 召回，只会把注入行变成每回合的固定噪声，反而稀释真正需要召回时的信号。
  if (meaningful.length < 3) return "exclude";
  return "uncertain";
}

/**
 * 判断本回合是否进入双源召回（`34 §6`）。
 *
 * `enter` 与 `uncertain` 都返回 `true`：§6 不确定处理禁止按无约束处理，
 * 故「判不出来」时的安全方向是**召回**而不是跳过。
 * 只有明确命中 §6 排除条件（纯读取/纯查询）才返回 `false`。
 *
 * @param {string} text 本回合用户消息文本
 * @returns {boolean}
 */
export function shouldRecall(text) {
  const verdict = classifyEntry(text);
  return verdict === "enter" || verdict === "uncertain";
}

/**
 * @deprecated 用 `shouldRecall` —— 「事实消费进入条件」是 `02 §9.2` 的概念，
 * 本模块判的是 `34 §6` 的时点判据，两者不是一回事（见 `classifyEntry` 注释）。
 * 保留此别名仅为兼容既有导入，行为已切到 `shouldRecall`。
 */
export function enterFactConsumption(text) {
  return shouldRecall(text);
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
    if (result.overBudget === true) {
      // 保底一条导致超额：必须说清「预算极小、只给了保底项」，
      // 否则读者会以为这么多就是全部相关项。
      lines.push(`（预算极小（上限 ${result.budget?.limitBytes ?? "?"} 字节）已超额，仅保底给出首项（实际 ${result.budget?.usedBytes ?? "?"} 字节）。**未列出的部分不代表不存在**，需要时请扩大检索。）`);
    } else {
      lines.push(`（超出预算已裁剪：上限 ${result.budget?.limitBytes ?? "?"} 字节，实际用 ${result.budget?.usedBytes ?? "?"} 字节。未列出的部分不代表不存在。）`);
    }
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
  // **区分两种「不进」**（归因不得混同）：
  //   - 取不到用户消息（`currentUserText` 返回空串）→ 是**输入缺失**，不是 §6 排除。
  //     报成 excluded-by-34-6 会让人以为「系统判断这是纯读取」，从而不去查为什么
  //     取不到输入——那正是「验证手段在骗我」的形态。
  //   - 取到了但不满足 §6 进入条件 → 才是 excluded-by-34-6。
  if (typeof userText !== "string" || userText.trim() === "") {
    return { inject: false, reason: "no-user-text" };
  }
  if (!shouldRecall(userText)) {
    return { inject: false, reason: "excluded-by-34-6" };
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
