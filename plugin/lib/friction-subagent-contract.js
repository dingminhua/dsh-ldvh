/**
 * dsh-ldvh — 摩擦发现的子代理契约：提示词与结构化输出 schema
 *   (specs/11 §9 第 1 项的语义判断，经宿主 outputSchema 承载).
 *
 * 权威与边界：specs/11 §9、§5.2。本模块**只承载两样东西**——
 *
 *   1. 交给派生出的受管辖隔离子代理的**提示词**（它以零上下文派生，判断所需
 *      输入由调度侧机械交付——窗口原文材料与既有账本候选，11 §7.1「执行体与上下文供给」，
 *      上下文供给」段，Human 决定 2026-10-12）；
 *   2. 它的**结构化输出 schema**（由宿主在提交层强制，见下）。
 *
 * 本模块**不做判断、不碰账本、不写文件**：判断由子代理（LLM）做出，落地由
 * friction-discovery.js 的闭集完成，本模块在两者之间只提供契约文本。
 *
 * ## 为什么用 outputSchema
 *
 * specs/11 §9 第 1 项的语义查重按 §8.2 第 1 条后半句**不由机械校验保障**——
 * 它是登记为 gap 的语义判断。但「子代理按结构提交」这件事**可以**升为机械校验：
 * 宿主 `outputSchema` 在**提交层**强制（实测 2026-10-11：越界的枚举值、多余字段
 * 都交不出来；不合规对象根本到不了调用方）。故本 schema 把三态与各态必填字段
 * 做成机械可判，使「子代理说了什么」至少形状可信。
 *
 * **本 schema 不保证判断正确**：它只管字段名、枚举、必填性与类型。把
 * `verdict` 填成 `same-obstacle` 而实际是另一件阻碍，schema 一律放行——那是
 * 语义误判，属 §8.4 第 2 项「反向护栏」登记的已知失效面（处置为按 26 §17 第 6
 * 项撤销误判递增）。**不得据本 schema 的通过主张判断内容可靠。**
 */

/** 三态判断的闭集（schema 的 `enum` 与下方校验共用同一来源，防二者漂移）。 */
export const VERDICTS = Object.freeze(["same-obstacle", "new-obstacle", "no-discovery"]);

import { verifyQuotation, renderWindowText, WINDOW_OPEN, WINDOW_CLOSE } from "./friction-window.js";
import { promptObjectRef } from "./object-reference.js";

/**
 * 给子代理的结构化输出 schema。
 *
 * 形状为 object root，只用宿主支持的 JSON Schema 子集（type / properties /
 * required / additionalProperties / items / enum / description）——JSON Schema
 * 扩展（oneOf 跨态约束、$ref 等）不在此列，故三态**各自的必填字段**用
 * `description` 说明 + 落地侧校验承载，而不是靠条件 schema（那些不被支持）。
 */
export function discoveryOutputSchema() {
  return {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: [...VERDICTS],
        description:
          "三态之一：same-obstacle=本次观察与既有某条账目是同一阻碍；new-obstacle=构成本账本尚未记录的阻碍；no-discovery=本次新增内容中没有构成系统性阻碍的现象。",
      },
      target_uid: {
        type: "string",
        description:
          "verdict=same-obstacle 时必填：被命中的既有账目 object_uid（UUIDv4）。其余两态填空字符串。",
      },
      title: {
        type: "string",
        description:
          "verdict=new-obstacle 时必填：阻碍的短标题（≤30 字）。其余两态填空字符串。",
      },
      phenomenon: {
        type: "string",
        description:
          "verdict=new-obstacle 时必填：单句现象陈述（非结论，如「CI 平均 8 分钟」而非「CI 太慢」）。其余两态填空字符串。",
      },
      basis: {
        type: "string",
        description:
          "verdict=new-obstacle 时必填：入账依据（可归因性 + 修了会更好的预期）。其余两态填空字符串。",
      },
      impact: {
        type: "string",
        enum: ["light", "medium", "heavy"],
        description:
          "verdict=new-obstacle 时必填：影响评级。其余两态填 \"light\"（占位，落地侧按 verdict 忽略）。",
      },
      quote: {
        type: "string",
        description:
          "必填：**逐字引证**——从本次给你的材料里原样复制一段（≥8 个字），它是你得出该 verdict 的直接依据。不得改写、不得概括、不得引用材料里没有的话；落地侧会机械核对该引证是否真出现在本次材料中，不在即判定该判断不成立。",
      },
      reason: {
        type: "string",
        description:
          "必填：判定理由——说明你如何从该引证得出该 verdict。",
      },
    },
    required: ["verdict", "target_uid", "title", "phenomenon", "basis", "impact", "quote", "reason"],
    additionalProperties: false,
  };
}

/**
 * 组装交给子代理的提示词（§8.4 执行体：零上下文派生，依调度侧交付的材料判断）。
 *
 * 参数（全部为**机械前提**，由调度方提供，不得由子代理自行取得）：
 *   - `threshold`：固定阈值 N（11 §9 内嵌为 3）；
 *   - `candidates`：既有 `open`/`observing` 账目的候选投影（uid/title/phenomenon/status）；
 *   - `window`：本次运行的**水位区间**（自上次成功运行以来新增的会话内容范围）。
 *     其取值只来自宿主会话记录的位置标识（§8.4「观察范围的切分」）——
 *     **不由子代理判断哪些是新的**，它只在该区间内作判断。
 *
 * 提示词明确三件约束，逐条对应规范：
 *   ① 只判断区间内的内容（§8.4 水位段：防同一段内容被反复计数）；
 *   ② 不做价值判断、不决定修不修（§8.4「必须外送 Human 的判断项」+ §8.2 第 2 条）；
 *   ③ 产出经结构化工具提交（宿主 outputSchema 强制，非文本约定）。
 */
/**
 * `friction-discovery`（摩擦发现）任务的**提示词段**——只含该任务自己的判断要求。
 *
 * ## 与公共段的分工（2026-10-11 多任务拼接）
 *
 * Human 改定「一次派发做多件事」后，提示词由**一段公共部分 + 每任务一段**拼成
 * （见 `aux-task-registry.js` 的 `buildCompositePrompt`）。本函数只产出**任务段**：
 * 该任务要判断什么、三态各自何意、输出哪个字段。**材料、材料边界、既有账本、
 * 产出方式**都属公共部分（`buildSharedPromptSection`），因为它们在任务之间
 * **完全相同**，每任务各拼一遍既膨胀又可能措辞漂移。
 *
 * ## 本段的措辞不许与公共段重复
 *
 * 尤其**引证规则**：公共段已给出材料的确切边界与「引证不成立即判断不成立」。
 * 任务段若再写一遍（哪怕措辞略有不同），执行体会按更宽松的那个理解——而引证
 * 核对是按材料正文做字符串比对的，措辞漂移直接使引证被拒（实测该类拒绝占失败
 * 的大多数）。故本段只**引用**该规则，不重述。
 *
 * @param {{threshold: number, candidates?: Array}} ctx - 机械前提（阈值、候选账本）。
 * @returns {string} 该任务的提示词段。
 */
export function buildDiscoveryPromptSection({ threshold, candidates = [] } = {}) {
  const list = candidates.length === 0
      ? "（本账本当前没有 open/observing 账目——任何新发现的阻碍都只能是 new-obstacle）"
      : candidates
          .map((c) => `- ${promptObjectRef(c)} [${c.status}]｜现象：${c.phenomenon ?? "（未投影）"}`)
          .join("\n");

  return [
    "**要判断的事情**：本次观察材料中，是否存在与既有账本比对后属于下列三态之一的**系统性阻碍**。",
    "",
    "**你只能做判断，不能做决定**：本机制没有主控，你的产出不取得授权或完成效力"
    + "（04 §8.2 第 4 条），也不得产生需要 Human 决定的结论（§8.2 第 2 条）。具体地："
    + "你**不得**判断某笔摩擦「值不值得修」「要不要销账」「要不要废弃」，也不得改影响"
    + "评级——那些是必须外送 Human 的判断项（§8.4）。",
    "",
    "**阈值**：本账本的阈值固定为 N=" + String(threshold) + "：某条账目 occurrence.count "
    + "达到该值时才会由机械通道从 observing 转为 open。**你不需要也不得自己数 count**"
    + "——计数与流转由机械层完成。",
    "",
    "**判定的三态**：",
    "- `same-obstacle`：本次材料的内容与**既有某条账目**是同一阻碍 → 必填 `target_uid`（该账目的 uid）。",
    "- `new-obstacle`：本次材料的内容构成一个**账本尚未记录**的阻碍 → 必填 `title`/`phenomenon`/`basis`/`impact`。",
    "- `no-discovery`：本次材料中**没有**构成系统性阻碍的现象 → 其余字段填空字符串（`impact` 填 \"light\" 占位）。",
    "",
    "**你要输出的字段**：`verdict`（上述三态之一）、`target_uid`、`title`、`phenomenon`、"
    + "`basis`、`impact`、`quote`、`reason`。三态各自的必填字段见上；`quote` 与 `reason` "
    + "两态下都必填（材料非空时）。字段的逐条说明见输出 schema。",
    "",
    "**本任务的既有账本（查重比对对象）**：",
    list,
  ].join("\n");
}

/**
 * 提示词的**公共段**——对全部任务只出现一次的部分。
 *
 * 含四样东西，它们在任务之间完全相同：
 *   ① 身份与上下文供给声明（零上下文派生 + 机械交付，11 §7.1「执行体与上下文供给」
 *      供给」段，Human 决定 2026-10-12）；
 *   ② **材料的确切边界**（11 §11 水位段：切分落在机械侧）；
 *   ③ 本次观察材料正文；
 *   ④ 产出方式（结构化工具提交）。
 *
 * ## 为什么必须只有一份
 *
 * 材料可能上万字（实测主控会话材料 10 万+ 字符），每任务各拼一遍会随任务数线性
 * 膨胀；更要紧的是**一致性**——同一段边界规则若出现两次就可能有两种措辞，而
 * 执行体会按更宽松的那个理解。引证核对是按材料正文做字符串比对的，措辞漂移
 * 直接使引证被拒（实测该类拒绝占失败的大多数）。
 *
 * ## 材料边界为什么不能省
 *
 * 执行体以**零上下文**派生（2026-10-12 修订前为 fork 继承全量上下文），材料是它
 * 的唯一观察依据。实测（2026-10-11，fork 时代）：10 次运行中 3 次因引证落在材料
 * 外被机械核对拒绝，多为引了**工具输出或工具输入**——两者**从不进窗口**（窗口
 * 只收 user/message 与 assistant/message），是执行体最容易误取的一类。故公共段
 * 用两行标记把材料**完整包住**，并逐类列明「不在材料里的内容」，使「在不在材料
 * 里」成为可机械指认的问题。
 *
 * 渲染走**单一来源**（`friction-window.js` 的 `renderWindowText`）——核对侧用的是
 * 同一函数去掉标记的正文，两处不得各自拼装（否则任何漂移都会使所有引证无故
 * 被拒，且与「引错地方」无从区分）。
 *
 * @param {{window?: object, taskCount?: number}} ctx
 * @returns {string} 公共段正文。
 */
export function buildSharedPromptSection({ window: windowRange, taskCount = 1 } = {}) {
  const items = Array.isArray(windowRange?.items) ? windowRange.items : [];
  const windowText = items.length === 0
      ? "（本次窗口为空——没有任何新增内容可供判断。此时**每一件都只能**报对应的\"无发现\"态，且 `quote` 必须为空字符串；不得凭你可见的其他上下文编造发现。）"
      : renderWindowText(items);
  const truncatedNote = windowRange?.truncated === true
      ? "\n**注意**：本次材料因长度上限被**截断**过——你只能就所见部分判断，且须在 reason 中如实说明存在截断。"
      : "";

  const taskLine = taskCount > 1
    ? "你本次要完成**多件事**（见下方各事项段），每件都要给出自己的结论。"
    : "你本次要完成**一件事**（见下方事项段）。";

  return [
    "你是 LDVH 的**空闲辅助执行体**（specs/11 §7.1 派生的受管辖隔离子代理）。",
    "你以**零上下文**派生（spawn）——你看不到发起会话的任何内容；你判断所需的全部输入由调度侧**机械交付**（下方材料与既有账本候选，11 §7.1「执行体与上下文供给」段）。",
    taskLine,
    "",
    "## 你只能依据本次材料判断（重要）",
    "**下面「本次观察材料」是本次运行的唯一观察依据。**「系统性」不靠单次运行的全量语境承载——它由既有账目比对与跨运行的累计计数结构性承载（11 §9 自动动作闭集第 1/2/4 项）；你只需判断**本次材料中是否出现阻碍现象**。",
    "你的判断必须**逐字引证**材料中的原文（`quote` 字段），落地侧会机械核对该引证是否真出现在材料里；**引证不在材料中即判定该判断不成立**。",
    "**「逐字」包含 Markdown 标记本身**：材料里的 `**加粗**`、`` `行内代码` ``、列表符号、标点与空白都是原文的一部分，复制时须**连标记一起复制**，不得剥除、不得重排、不得改用你自己的排版——剥掉 `**` 或反引号后的文本在材料里**并不存在**，会被判为「引证不在材料中」。",
    "",
    "### 材料的确切边界（照着找，别猜）",
    `本次材料被两行标记**完整包住**：起于 \`${WINDOW_OPEN}\`、止于 \`${WINDOW_CLOSE}\`。**只有夹在这两行之间的内容算材料**——这两行本身不算，也不要引它们。`,
    "材料只含主控会话中**用户与助手的自然语言往来**（`user:` 与 `assistant:` 两种行）。**不在材料里的内容一律不可引**，具体地说：",
    "- ❌ **工具调用与工具输出的一切内容都不在材料里**：命令回显、文件内容、grep/search 结果、报错堆栈；**工具输入**同样不在——你在命令里写的字符串（尤其是 heredoc 里内嵌的长文本）读起来像行文，却是命令参数；",
    "- ❌ **更早轮次的对话**不在材料里（已被上一次运行处理过；材料只含水位之后的新增内容）；",
    "- ❌ **你自己的知识、规范条文、记忆**不在材料里。",
    "- ✅ 只有标记之间、以 `[turn N]` 起头、标着 `user:` 或 `assistant:` 的正文才是可引内容。",
    "",
    "**若你确信某个阻碍很重要、但材料里没有能支持它的原文**：这说明本次运行的观察范围未覆盖它。此时你**不得**为了让它入账而编造或改写引证——那会被机械否掉。正确做法是**照实报**：要么在材料内找一个能支持同判断的引证，要么报对应的「无发现」态。**不要为了让结论成立而挑一句「差不多」的话充数。**",
    "材料为空时只能报「无发现」，且 `quote` 填空字符串；**材料非空时，即使结论是「无发现」也必须引证一段材料原文**（否则「恒报无发现」与正确运行无从区分）。",
    truncatedNote,
    "",
    "## 本次观察材料",
    windowText,
    "",
    "## 产出方式",
    "用结构化输出工具提交你的结论。**不要用纯文本作答**——只有工具提交算数。",
    "你的输出是一个对象，**每个事项占一个自己的顶层字段**（字段名见各事项段）。",
    "字段必须符合给定 schema：三态各自的必填字段见字段说明；不合规的对象**交不出来**（宿主在提交层拦截）。",
    "`quote` 必须是材料中的**逐字原文**（≥8 个字，且连 `**`／反引号等 Markdown 标记一并复制）；`reason` 说明你如何由该引证得出结论。",
  ].join("\n");
}

/**
 * 兼容入口：单任务（`friction-discovery`）的完整提示词。
 *
 * 多任务派发已改走 `aux-task-registry.js` 的 `buildCompositePrompt`（公共段一次 +
 * 各任务段依次）。本函数**保留**是因为它是单任务情形的**等价形态**，且既有测试
 * 与诊断路径都按它构造——删掉会使那些路径各自拼装提示词，正是要避免的漂移。
 *
 * 其正文由上面两个函数拼成，**不再自成一份文本**：这样「单任务」与「多任务」
 * 两条路径共用同一份措辞，不会出现「N=1 时行为等价于旧行为」的断言落空。
 */
export function buildDiscoveryPrompt({ threshold, candidates = [], window: windowRange } = {}) {
  // 刻意**不**调用 registry 的 buildCompositePrompt：那会造成
  // `registry → contract → registry` 的循环导入。单任务情形的拼接只是「公共段 +
  // 一个任务段」，两行即可，故在此内联——正文仍来自上面两个函数，不另起一份。
  const shared = buildSharedPromptSection({ window: windowRange, taskCount: 1 });
  const section = buildDiscoveryPromptSection({ threshold, candidates });
  return [shared, "", "## 本次要做的一件事", "", "### 事项 1／1：friction-discovery", section].join("\n");
}

/**
 * 对子代理的结构化结论做**落地前校验**（§8.4 第 6 项：未通过即 fail-closed）。
 *
 * 为什么宿主已有 schema 校验、这里还要再校验一遍：schema 保证的是**形状**，
 * 而「三态各自的必填字段」是**跨字段的语义约束**（例如 same-obstacle 必须带
 * target_uid 且该 uid 应在候选内），宿主支持的 schema 子集里没有条件约束
 * （无 oneOf/if-then 的可用面），故这一层只能由落地侧承担。
 *
 * 返回 `{ ok: true, value }` 或 `{ ok: false, error }`。
 */
export function validateDiscoveryVerdict(structured, { candidates = [], windowText = null } = {}) {
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  if (typeof structured !== "object" || structured === null) {
    return failure("discovery/verdict_malformed", `structured output is not an object (got ${JSON.stringify(structured)})`);
  }
  const { verdict, target_uid: targetUid, title, phenomenon, basis, impact, quote, reason } = structured;

  if (!VERDICTS.includes(verdict)) {
    return failure("discovery/verdict_out_of_set", `verdict ${JSON.stringify(verdict)} is not in the closed set ${JSON.stringify([...VERDICTS])}`);
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return failure("discovery/reason_missing", "reason is required and must be non-empty (it must point back to this run's window)");
  }

  // D1 的核心：逐字引证 + 机械核对（11 §11 水位段——切分依据不得由 AI 判断）。
  // 提供了 windowText 才做核对；未提供时**只**校验 quote 存在，且调用方不应
  // 在这种情况下落地（会在 lifecycle 里被拦，见 friction-landing 的调用点）。
  // 复核发现④的修复：**非空窗口**下的 `no-discovery` 也必须引证。
  // 早先的写法对 no-discovery 免引证，于是「恒报无发现」这一失效**完全不可见**
  // ——它每次都推进水位、永不入账，而从记录上看不出任何异常。要求它至少引证一段
  // 材料原文，使「它确实看过材料」成为可核对的机械事实（引证还必须真在窗口内，
  // 见下方 verifyQuotation）。
  // 空窗口（本次没有材料）是唯一的例外：那时无从引证，且此时 quote 必须为空。
  // 判据：**本次确实提供了窗口材料**（`windowText` 为字符串）时，无论三态都须引证。
  // 未提供窗口（`windowText === null`）时只做形状校验——那是「调用方未启用核对」
  // 的旧调用面，不是「材料为空」。
  const windowProvided = typeof windowText === "string";
  const windowIsEmpty = windowProvided && windowText.trim().length === 0;
  if (verdict === "no-discovery") {
    if (typeof quote !== "string") {
      return failure("discovery/quote_missing", "quote must be a string (empty only when the window itself is empty)");
    }
    if (windowProvided && !windowIsEmpty && quote.trim().length === 0) {
      return failure(
        "discovery/quote_missing",
        "no-discovery over a non-empty window still requires a verbatim quote — without it, a verdict that always answers 'no discovery' (never recording anything) is indistinguishable from correct operation",
      );
    }
  } else if (typeof quote !== "string" || quote.trim().length === 0) {
    return failure(
      "discovery/quote_missing",
      "a non-empty verbatim quote is required for same-obstacle/new-obstacle — without it the landing side cannot tell whether the verdict derives from this run's window (11 §11 水位段)",
    );
  }
  if (typeof quote === "string" && quote.trim().length > 0 && windowText !== null) {
    const checked = verifyQuotation(quote, windowText);
    if (!checked.ok) return failure(checked.error.code, checked.error.message);
  }

  if (verdict === "same-obstacle") {
    if (typeof targetUid !== "string" || targetUid.trim().length === 0) {
      return failure("discovery/target_uid_missing", "verdict=same-obstacle requires a non-empty target_uid");
    }
    // 命中的目标必须在**本次交给它的候选**之内：防它凭空指向一条本次没见的账目
    // （那会使落地侧无从核对，且绕开「只作用于本次运行读取到的账目」的边界）。
    const known = candidates.some((c) => c.object_uid === targetUid.trim());
    if (!known) {
      return failure(
        "discovery/target_uid_unknown",
        `target_uid ${JSON.stringify(targetUid)} is not among the candidates supplied this run (${candidates.length} supplied) — a verdict may only point at a ledger entry it was shown`,
      );
    }
  }

  if (verdict === "new-obstacle") {
    for (const [field, value] of [["title", title], ["phenomenon", phenomenon], ["basis", basis]]) {
      if (typeof value !== "string" || value.trim().length === 0) {
        return failure(`discovery/${field}_missing`, `verdict=new-obstacle requires a non-empty ${field}`);
      }
    }
    if (!["light", "medium", "heavy"].includes(impact)) {
      return failure("discovery/impact_out_of_set", `verdict=new-obstacle requires impact in light/medium/heavy (got ${JSON.stringify(impact)})`);
    }
    if (title.trim().length > 30) {
      return failure("discovery/title_too_long", `title must be ≤ 30 characters (got ${title.trim().length}) — 26 §8`);
    }
  }

  return { ok: true, value: { verdict, target_uid: targetUid?.trim?.() ?? "", title: title?.trim?.() ?? "", phenomenon: phenomenon?.trim?.() ?? "", basis: basis?.trim?.() ?? "", impact, quote: typeof quote === "string" ? quote : "", reason: reason.trim() } };
}
