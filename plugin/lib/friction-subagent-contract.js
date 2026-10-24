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
/**
 * 判定态闭集（2026-10 修订：由三态扩为四态）。
 *
 * **为什么扩**：观察与账目分两层后，「这条观察归属哪里」有三种可能，加上「没有发现」
 * 共四态。原三态里 `new-obstacle` 同时承担「新建账目」，现在它不再新建账目——观察材料
 * 一律先进缓冲，只有攒够 N 条才晋升为账目。
 *
 * | 态 | 含义 | 落地动作（§9） |
 * |---|---|---|
 * | `same-obstacle` | 与**既有 open 账目**同一阻碍 | 第 4 项：对既有账目补充级更新 |
 * | `same-observation-group` | 与**缓冲中某个 pending 组**同一阻碍 | 第 2 项：追加进该组；若达 N 则第 3 项晋升 |
 * | `new-observation` | 账本与缓冲都没有的**新阻碍**（构成一次观察） | 第 2 项：开一个新组（count 1，留在缓冲） |
 * | `no-discovery` | 本次材料没有构成系统性阻碍的现象 | 无动作 |
 */
export const VERDICTS = Object.freeze([
  "same-obstacle",
  "same-observation-group",
  "new-observation",
  "no-discovery",
]);

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
          "四态之一：same-obstacle=与既有 open 账目是同一阻碍；same-observation-group=与缓冲中某个 pending 观察组是同一阻碍；new-observation=账本与缓冲都没有的新阻碍；no-discovery=本次新增内容中没有构成系统性阻碍的现象。",
      },
      target_uid: {
        type: "string",
        description:
          "verdict=same-obstacle 时必填：被命中的既有 open 账目 object_uid（UUIDv4）。其余三态填空字符串。",
      },
      group: {
        type: "string",
        description:
          "verdict=same-observation-group 时必填：命中的观察组键（从给你的观察组清单里原样复制）。verdict=new-observation 时必填：你为该阻碍新起的稳定键（小写 kebab-case，如「ci-slow-build」，此后同一阻碍都用它）。其余两态填空字符串。",
      },
      title: {
        type: "string",
        description:
          "verdict=same-observation-group 或 new-observation 时必填：该阻碍的短标题（≤30 字）。**这两态都要填**——因为你这一条可能正好是该组攒够 N 条的那一条，届时它会被晋升为账目，标题就用这一条。其余两态填空字符串。",
      },
      phenomenon: {
        type: "string",
        description:
          "同上两态必填：单句现象陈述（非结论，如「CI 平均 8 分钟」而非「CI 太慢」）。其余两态填空字符串。",
      },
      basis: {
        type: "string",
        description:
          "同上两态必填：入账依据（可归因性 + 修了会更好的预期）。只在晋升时使用，但每次都填以免晋升那一条恰好缺它。其余两态填空字符串。",
      },
      attribution: {
        type: "string",
        description:
          "同上两态必填：**归因陈述**——该阻碍的根源落在哪个子系统/规范/流程（如「plugin/lib/lifecycle.js 的返回值丢弃」或「11 §9 的闭集措辞」）。摩擦的根源常是规范/工具/流程本身而无对象身份，故这是自由文本。**不得省略、不得写「暂缺」**：省略会使晋升出的账目缺归因（本机制此前的实现缺陷，95/97 条机械入账缺该字段）。其余两态填空字符串。",
      },
      impact: {
        type: "string",
        enum: ["light", "medium", "heavy"],
        description:
          "同上两态必填：影响评级。其余两态填 \"light\"（占位，落地侧按 verdict 忽略）。",
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
    required: ["verdict", "target_uid", "group", "title", "phenomenon", "basis", "attribution", "impact", "quote", "reason"],
    additionalProperties: false,
  };
}

/**
 * 组装交给子代理的提示词（§8.4 执行体：零上下文派生，依调度侧交付的材料判断）。
 *
 * 参数（全部为**机械前提**，由调度方提供，不得由子代理自行取得）：
 *   - `threshold`：固定阈值 N（11 §9 内嵌为 3）；
 *   - `candidates`：既有 **`open`** 账目的候选投影（uid/title/phenomenon/status）——2026-10 修订后
 *     账本里已无 `observing`（观察材料在 11 §12bis.1 的缓冲里）；
 *   - `observationGroups`：缓冲中既有 `pending` 组的投影（group/pending_count/phenomenon）
 *     ——这是**观察层**的查重对象，缺它同一阻碍永远攒不到 N；
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
 * @param {{threshold: number, candidates?: Array, observationGroups?: Array}} ctx
 *        - 机械前提（阈值、账本候选、观察组）。
 * @returns {string} 该任务的提示词段。
 */
export function buildDiscoveryPromptSection({ threshold, candidates = [], observationGroups = [] } = {}) {
  // 账本侧：只有 open 账目（观察态已退出闭集）。
  const ledgerList = candidates.length === 0
      ? "（本账本当前没有 open 账目——任何阻碍都还不能与既有账目比对）"
      : candidates
          .map((c) => `- ${promptObjectRef(c)} [${c.status}]｜现象：${c.phenomenon ?? "（未投影）"}`)
          .join("\n");

  // 观察侧：缓冲里已有的 pending 组。**这一层必须给出**——否则同一阻碍每次都
  // 会被判成新组，聚合永远到不了阈值（11 §9 第 3 项）。
  const groupList = observationGroups.length === 0
      ? "（观察缓冲当前没有待晋升的组——本次若观察到阻碍，只能是 new-observation）"
      : observationGroups
          .map((g) => `- \`${g.group}\`｜已有 ${g.pending_count} 次观察｜现象：${g.phenomenon ?? "（未投影）"}`)
          .join("\n");

  return [
    "**要判断的事情**：本次观察材料中是否出现了**系统性阻碍**；若出现，它归属哪里。",
    "",
    "**你只能做判断，不能做决定**：本机制没有主控，你的产出不取得授权或完成效力"
    + "（04 §8.2 第 4 条），也不得产生需要 Human 决定的结论（§8.2 第 2 条）。具体地："
    + "你**不得**判断某笔摩擦「值不值得修」「要不要销账」「要不要废弃」，也不得改影响"
    + "评级——那些是必须外送 Human 的判断项（§9）。",
    "",
    "**两层结构（这是本次任务的形状，请务必理解）**：",
    "- **账本层**：`open` 账目是**已经攒够、待修的阻碍**。它们已是事实对象。",
    "- **观察层**：观察缓冲里的组是**还没攒够的证据**，**不是账目**。同一阻碍的每次出现"
    + "各自一条，按 `group` 聚合；当某组的待晋升条目达到 N=" + String(threshold)
    + " 条时，机械层会把它们**晋升为一条新的 `open` 账目**。",
    "",
    "**因此：你的判断不会直接创建账目。** 观察层只负责把这次观察归到正确的组；"
    + "攒够与否、是否晋升、晋升后的账目长什么样，都由机械层按 N 与组计数决定。"
    + "**你不需要也不得自己数条目数**。",
    "",
    "**判定的四态**：",
    "- `same-obstacle`：本次材料与**既有某条 open 账目**是同一阻碍 → 必填 `target_uid`（该账目的 uid）。"
    + "机械层会对那条账目做补充级更新（计数 +1）。",
    "- `same-observation-group`：本次材料与**观察缓冲中某个已有组**是同一阻碍 → 必填 `group`"
    + "（从下方组清单里原样复制组键）。",
    "- `new-observation`：本次材料构成一个**账本与缓冲都没有**的阻碍 → 必填 `group`"
    + "（你为它起一个稳定键，小写 kebab-case，此后同一阻碍都用它）。",
    "- `no-discovery`：本次材料中**没有**构成系统性阻碍的现象 → 其余字段填空字符串"
    + "（`impact` 填 \"light\" 占位）。",
    "",
    "**关于 `title`/`phenomenon`/`basis`/`attribution`/`impact`**：`same-observation-group`"
    + " 与 `new-observation` **两态都要填齐**。原因很实际——**你这一条可能正好是该组攒够"
    + " N 条的那一条**，届时它会被立即晋升为账目，标题、现象、入账依据与归因就取自你这份"
    + "产出。缺任何一项都会使晋升失败。`attribution` 是**必填**（该阻碍的根源落在哪个"
    + "子系统/规范/流程），不得写「暂缺」。",
    "",
    "**你要输出的字段**：`verdict`（上述四态之一）、`target_uid`、`group`、`title`、"
    + "`phenomenon`、`basis`、`attribution`、`impact`、`quote`、`reason`。"
    + "各态的必填字段见上；`quote` 与 `reason` 在材料非空时都必填。逐条说明见输出 schema。",
    "",
    "**本账本的 open 账目（账本层查重对象）**：",
    ledgerList,
    "",
    "**观察缓冲中已有的组（观察层查重对象）**：",
    groupList,
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
export function validateDiscoveryVerdict(structured, { candidates = [], observationGroups = [], windowText = null } = {}) {
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  if (typeof structured !== "object" || structured === null) {
    return failure("discovery/verdict_malformed", `structured output is not an object (got ${JSON.stringify(structured)})`);
  }
  const {
    verdict,
    target_uid: targetUid,
    group,
    title,
    phenomenon,
    basis,
    attribution,
    impact,
    quote,
    reason,
  } = structured;

  if (!VERDICTS.includes(verdict)) {
    return failure("discovery/verdict_out_of_set", `verdict ${JSON.stringify(verdict)} is not in the closed set ${JSON.stringify([...VERDICTS])}`);
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return failure("discovery/reason_missing", "reason is required and must be non-empty (it must point back to this run's window)");
  }

  // D1 的核心：逐字引证 + 机械核对（11 §11 水位段——切分依据不得由 AI 判断）。
  // 空窗口（本次没有材料）是唯一免引证的情形；非空窗口下四态都须引证。
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
      "a non-empty verbatim quote is required for same-obstacle/same-observation-group/new-observation — without it the landing side cannot tell whether the verdict derives from this run's window (11 §11 水位段)",
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

  // 观察层的两态（same-observation-group / new-observation）：都要 `group`，且都要
  // title/phenomenon/basis/attribution——因为**这一条可能正是攒够 N 的那一条**，
  // 届时要立刻用它晋升为账目（§9 第 3 项）。若只在 new-observation 时要求这些字段，
  // 晋升那一条恰好可能缺标题或归因。
  const isObservation = verdict === "same-observation-group" || verdict === "new-observation";
  if (isObservation) {
    if (typeof group !== "string" || group.trim().length === 0) {
      return failure(
        "discovery/group_missing",
        `verdict=${verdict} requires a non-empty group — it is the aggregation key the threshold is computed on (11 §9 第 3 项); without it the group can never accumulate to N`,
      );
    }
    if (verdict === "same-observation-group") {
      const known = observationGroups.some((g) => g.group === group.trim());
      if (!known) {
        return failure(
          "discovery/group_unknown",
          `group ${JSON.stringify(group)} is not among the observation groups supplied this run (${observationGroups.length} supplied) — a verdict may only join a group it was shown`,
        );
      }
    }
    for (const [field, value] of [["title", title], ["phenomenon", phenomenon], ["basis", basis], ["attribution", attribution]]) {
      if (typeof value !== "string" || value.trim().length === 0) {
        return failure(`discovery/${field}_missing`, `verdict=${verdict} requires a non-empty ${field}`);
      }
    }
    if (!["light", "medium", "heavy"].includes(impact)) {
      return failure("discovery/impact_out_of_set", `verdict=${verdict} requires impact in light/medium/heavy (got ${JSON.stringify(impact)})`);
    }
    if (title.trim().length > 30) {
      return failure("discovery/title_too_long", `title must be ≤ 30 characters (got ${title.trim().length}) — 26 §8`);
    }
  }


  return { ok: true, value: { verdict, target_uid: targetUid?.trim?.() ?? "", group: group?.trim?.() ?? "", title: title?.trim?.() ?? "", phenomenon: phenomenon?.trim?.() ?? "", basis: basis?.trim?.() ?? "", attribution: attribution?.trim?.() ?? "", impact, quote: typeof quote === "string" ? quote : "", reason: reason.trim() } };
}
