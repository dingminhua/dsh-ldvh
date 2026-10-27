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

import {
  BASELINE_BUDGET_SHARE_DIVISOR,
  BASELINE_YIELD_BELOW_BYTES,
  INJECTION_EXCLUDED_TYPES,
  recallForAction,
} from "./source-recall.js";

/** 注入行可见摘要（Human 侧折叠时看到的短标签）。 */
export const RECALL_SUMMARY = "双源召回 · dsh-ldvh · 行动前候选";

/**
 * 沉默阈值：**候选条数**少于这个数就不注入（避免每回合刷空行）。
 *
 * ── 「排序分」与「是否注入」是两件事（2026-10-27，第 3 步）─────────────
 *
 * 这条阈值**只数条数，不看分数**。必须如此，理由有三：
 *
 * 1. **排序分是候选集内的相对量**，不具跨回合可比性。本项目 `source-recall.js`
 *    的 `hits` 自 BM25 引入后是 `Σ idf × 饱和(tf)`——idf 取决于**当次候选集的
 *    N 与 df**。同一份事实，换个查询集，分数就变；把它当阈值输入等于让「是否
 *    注入」取决于恰好还有哪些别的候选被选中。
 * 2. **同分极常见**。实测「在 Git Gate 再加一条校验」里 4 条候选并列在
 *    tier1/BM25 相近区间，名次由 path 字典序决定。若用分数判「要不要注入」，
 *    等于让 UUID 字母序决定有没有召回。
 * 3. **外部项目已实测这条路走不通**：`dsh-auto-memory` 的 `recall-fusion.js`
 *    文件头明确写「融合分数只用于排序；『是否注入』的决策必须使用**绝对分数**
 *    与**校准阈值**比较，rank-space 分数本身仍是候选集内的相对量，**不承担
 *    决策职责**」；其 M7 报告更给出否证——单阈值策略精确率 0（`denseTop=0.834`
 *    时触发的全是闲聊）。调研 R-f8b248ce F4「回声陷阱」记录了这一点。
 *
 * 故本模块的职责切分是**固定**的：
 *   · `source-recall.js` 产出的 `hits`／排序 → **只决定谁排在前面**；
 *   · 本模块的决策 → 只看「有没有候选」（条数）+ `34 §6` 三态进入判据（语义）。
 * 三态 gate 是本项目比外部实现更稳的部分，**不因引入加权而改动**。
 * 下方 `DECISION_KEYS` 把这条切分声明为可机械校验的事实。
 */
export const MIN_HITS = 1;

/**
 * 注入决策**允许**读取的输入项（闭集）。
 *
 * 这不是装饰性常量：`recall-injection.test.mjs` 有一条守卫用例，用**分数注入**
 * 的方式验证「把排序分改到任意极端，决策结果不变」。若将来有人把 `hits` 或
 * BM25 分数接进决策路径，该用例不会变红——所以额外把这份清单作为**声明式
 * 契约**写在这里，使「决策读了什么」可以被人一次性核对（`00 §5.6` 据实声明）。
 *
 * 现行决策输入（**只有这两项**）：
 *   · `candidateCount`——候选条数（`specs.length + facts.length`）；
 *   · `baselinePresent`——决策基线是否有内容（`22 §12` 义务召回，与词法无关）。
 *
 * **2026-10-27 更正**（独立审核轻微项 16）：本清单一度列了 `entryVerdict` 与
 * `recallAvailability`，但 `decideInjection` 从不读取它们、调用方也不传——
 * 声明与实现不符。那两个判断发生在**更上游**（`shouldRecall` / `recallForAction`
 * 的 ok 分支），不在本函数内。清单只列本函数真正读的键，否则「声明式契约」
 * 就变成装饰。
 *
 * **不在清单内**：`hits`、BM25 加权分、tier、path、任何排序键。
 */
export const DECISION_KEYS = Object.freeze([
  "candidateCount",
  "baselinePresent",
]);

/**
 * 是否注入的**纯决策函数**（2026-10-27，第 3 步抽出）。
 *
 * 抽出的理由是可测性，不是风格：原先该判断内联在 `buildRecallInjection` 里，
 * 而整链路运行时基线恒非空（`22 §12` 义务召回几乎总有 active ADR），短路分支
 * 根本走不到——于是「把排序分接进决策」这种破坏**测不出来**（实测破坏版仍
 * 65/65 全绿，守卫形同虚设）。抽成纯函数后可独立注入任意候选集与分数。
 *
 * **输入严格取自 `DECISION_KEYS`**（candidateCount / baselinePresent / 未来
 * 若需要的 entryVerdict、recallAvailability）。**不接收任何排序键**——调用点
 * 也不传，故「用分数决策」在类型层面就做不到，而不是只靠约定。
 *
 * @param {{candidateCount:number, baselinePresent:boolean}} input
 * @returns {boolean} 是否注入
 */
export function decideInjection(input) {
  const count = Number.isFinite(input?.candidateCount) ? input.candidateCount : 0;
  const baselinePresent = input?.baselinePresent === true;
  // 有候选 → 注入；无候选但有基线内容 → 仍注入（22 §12 义务召回不得靠词法运气）。
  return count >= MIN_HITS || baselinePresent;
}

/**
 * 默认单次注入预算（**字节**，不是字符）。
 *
 * **命名注**（2026-10-24）：原名为 `RECALL_CHAR_BUDGET`，但它的实际用法是传给
 * `budgetBytes` 按 UTF-8 字节计算——名字说 CHAR、用法算 BYTE，同一份文件里
 * `RECALL_RENDER_CHAR_LIMIT` 又真的按字符计（`line.length`）。两个「CHAR」不同义，
 * 中文一字三字节，极易让维护者按字符估算而严重低估（2400 字节只合 800 汉字）。
 * 故改名为 `RECALL_BYTE_BUDGET`，并在两条用例里校验二者单位不同。
 *
 * 与 guidance 的 1500 分开计——两者是不同的注入面。
 *
 * 定值依据（实测，2026-10-24）：`limit: 3` 时三条规范的候选卡约 1400–1500 字节、
 * 三条事实约 870–910 字节，合计约 **2300 字节**。原定 900 字节导致**每一条**都被
 * 裁到只剩 1–2 项且 `truncated` 恒为 true——预算过紧时它不再起「防超量」作用，
 * 反而使召回常态性不完整。
 * 故定为 2400：足以容纳 3 规范 + 3 事实，仍对更大结果形成硬上限
 * （`fd133f0d` A3 要求预算为机械约束，不是无上限）。
 */
export const RECALL_BYTE_BUDGET = 2400;

/**
 * **决策基线（F1）段的字节上限**。
 *
 * 与 `RECALL_BYTE_BUDGET` 的关系：这是**既有注入面预算内部的子分配**，
 * 不是新的预算边界——总预算仍是 2400 字节，基线只占其中一段（同 `specBudget`
 * 按 60% 切分候选预算的既有做法）。
 *
 * 为什么需要它：`22 §12` 要求 F1 无条件枚举全部 active ADR，而 ADR 数量会增长
 * （本仓 6 条、约 267 字节；若涨到 30 条即约 1400 字节）。没有上限时基线会
 * 挤占词法候选的预算，使召回失去「按需列出相关项」的功能；有上限而不披露
 * 则违反 `02 §9.1`「不得静默截断」。故：定上限 + 超出时如实计数披露。
 *
 * 定值依据：600 字节约可容纳 12–14 条标题（实测单条约 45 字节），
 * 覆盖 ADR 从当前 6 条增长到十余条的量级；同时保留约 75% 预算给候选区。
 *
 * 变更须走受控提交（`10 §5.3`「体量以固定常量承载，变更走受控提交」）；
 * 提高该上限属「改变引导面注入形式或预算边界」，须 Human 决定（`10 §9.1` 第 2 项）。
 * 本段的引入本身即经 Human 决定（2026-10-25 会话内批准方案 A）。
 */
export const ADR_BASELINE_BYTE_BUDGET = 600;



/**
 * **渲染后文本**的硬上限（UTF-16 码元）。
 *
 * 与 `RECALL_BYTE_BUDGET` 的区别：那个约束的是**候选数据**的字节量，
 * 这个约束的是**最终注入的这段文字**。二者不重合——同批数据的渲染长度
 * 取决于标题长短、命中理由、是否带 partial/来源/边界提示等，实测同一批
 * 候选从 802 到 1167 字符不等。
 *
 * 为什么需要它：引导面在 `10:241` 有「未超 LDVH 侧常量预算」的核对项，
 * 而召回这一面此前只有数据预算、没有文本预算——即**渲染层可以无界增长**
 * （项目语料变大、标题变长、命中理由变多时）。这不是新增预算边界
 * （那属 `10:261` 的 Human 决定事项），而是给已声明的 2400 预算补上
 * 它在渲染端的对应约束。
 *
 * ── 2026-10-27 修正：改为**由字节预算动态导出**，不再是单值 1600 ────────
 *
 * **缺陷（Human 指出）**：档位已从旧的 2400 字节改成 10240／20480／… 的档位集合，
 * 但本常量仍是写死的 1600 字符，于是它成了新的天花板——limit 调到 24 也只渲染
 * 约 15 条，20480 字节只用到 3228（**16%**）。档位调高，效果几乎不变。
 *
 * **修法**：字符上限不再独立取值，而由**本档的字节预算**推导——预算里有几字节
 * 就给几字节对应的字符量。判据用一个**保守的字节/字符比**，而不是假设全中文：
 * 中文一字 3 字节、ASCII 1 字节，本语料标题与路径以中文为主（实测渲染 1580 字符
 * = 3281 字节，约 2.08 字节/字符）。取 **BYTES_PER_CHAR_CONSERVATIVE = 2.0**
 * 略严于实测值，使「汉字为主」的文本不会超出，同时不再无谓砍掉 ASCII 较多的行。
 *
 * 这同时消除了一个**单位混用隐患**（本文件早期注释已提过）：`RECALL_BYTE_BUDGET`
 * 按字节算、`RECALL_RENDER_CHAR_LIMIT` 按字符算，两个「上限」不同义，极易误估。
 * 现在字符上限只是字节预算的函数，二者永不脱节。
 */
export const BYTES_PER_CHAR_CONSERVATIVE = 2.0;

/** 旧的单值上限（仅作为**未给字节预算时**的兜底，保持向后兼容）。 */
export const RECALL_RENDER_CHAR_LIMIT = 1600;

/**
 * 由字节预算导出渲染字符上限。
 *
 * @param {number|null} budgetBytes 本档字节预算；null/非法 → 退回旧单值（兼容直调路径）
 * @returns {number} 字符上限
 */
export function renderCharLimitFor(budgetBytes) {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) return RECALL_RENDER_CHAR_LIMIT;
  return Math.floor(budgetBytes / BYTES_PER_CHAR_CONSERVATIVE);
}

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
  "搜", "搜索", "检索", "统计", "数一下", "有几", "多少", "是什么", "有哪些",
  "告诉我", "show", "list", "read", "find", "search", "grep", "cat",
  // **「为什么」「解释」「说明」不在此列**（2026-10-24 移出）：
  // 它们看似在「问」，实为**诊断**——问「为什么这里不对」之后多半就要改。
  // 排除条件（34 §6）要挡的是「看看/列一下/查一下」这类**只为取信息**的动作，
  // 不是挡「这东西怎么了」这类**导向修的动作**。实测把它们算作纯读取时，
  // 常见诊断问句被判 exclude 而完全不进入召回。
  // 判成 uncertain 而非 enter 也符合 34 §6：不确定时**不得**当成无约束。
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
 * 宿主装配进 `messages` 批次的**上下文注入行**的 `source.kind` 清单。
 *
 * **为什么必须显式排除**（2026-10-27 实测，缺陷根因）：宿主的批次里
 * `role: "user"` 的不只有真实用户输入——运行时上下文、技能目录、工作区指令、
 * 时间上下文都由宿主以 `role: "user"` 装入，只以 `source.kind` 区分。
 * 旧实现「从尾部倒找第一条非本插件的 user 消息」，在**首回合**必然命中
 * time-context（它排在批次末尾），于是召回查询词变成
 * 「Time sampled while preparing turn 1, step 1: …」，命中的永远是含
 * 「turn」字样的那条经验（`pitfall-c4b28410`，命中理由「适用范围命中：turn」）。
 * 证据：三个会话的首回合召回注入行，与该会话用自己的 time-context 文本
 * 本地复算的结果**逐字节相同**（3/3）；用真实用户消息复算则不同。
 *
 * **判据方向是「排除已知的非用户上下文」而非「只认 kind === user」**：
 * 直接调用本函数的测试与旧宿主上的消息可能不带 `source`，若只认
 * `kind === "user"` 会把它们一并判成非用户输入，使取词恒为空——
 * 那是把一个静默漏取换成另一个静默漏取。排除清单只列出**已实际观察到**
 * 的宿主上下文 kind；未见过的 kind 仍按用户消息处理（保守取用）。
 */
export const HOST_CONTEXT_SOURCE_KINDS = Object.freeze([
  "time-context",
  "runtime-context",
  "skill-catalog",
  "agent-instructions",
  "compact-checkpoint",
]);

/**
 * 只有这个 kind 算「真实用户输入」。
 *
 * ── 为什么要从黑名单改成白名单（2026-10-27，实测事故）──────────────────
 *
 * 原实现用 `HOST_CONTEXT_SOURCE_KINDS` **排除已知的非用户上下文**，未见过的
 * kind 一律当用户消息。这个方向**失败时是开放的**：宿主新增一种通知，它就会被
 * 当成用户查询。
 *
 * 实测事故（本会话某一回合）：用户问的是中文「判断一下当前召回机制运作是否
 * 符合设计」，而注入的命中词是 `model`／`by`／`the`／`changed`／`session`／
 * `workbuddy`——**一个都不在用户问题里**。定位到 `currentUserText()` 取到的是
 * 宿主插入的 `[model changed: …]` 通知。
 *
 * 枚举本机三日内实际出现过的 `message.source.kind`，共 **11 种**，而名单只覆盖
 * 5 种——漏掉的 5 种是：
 *   · `model-selection`（`[model changed: …]`，本次命中源）
 *   · `tool-jobs`（后台任务通知）
 *   · `subagent-settled`（子代理结束通知）
 *   · `plugin:dsh-subagent-default-model`（子代理系统提示词）
 *   · `user-approval`（审批策略变更通知）
 * 漏一个就放行一个，而 kind 集合由宿主决定、可随时新增——**黑名单注定追不上**。
 *
 * 故改为白名单：`kind === "user"` 才是用户输入。
 *
 * ── 为什么不担心「漏取」──────────────────────────────────────────────
 * 原注释担心：直接调用的测试或旧宿主消息可能不带 `source`，只认 `user` 会把它们
 * 判成非用户输入、使取词恒为空（把一个静默漏取换成另一个静默漏取）。该顾虑成立，
 * 故 `isUserInputSource` 对「无 `source` / 无 `kind`」保留**按用户处理**的兜底，
 * 只对「明确带了非 user 的 kind」排除。实测真实用户消息 67 次全部带
 * `kind: "user"`，兜底只是兼容面，不是主路径。
 *
 * 两种失败形态的取舍也要说清：漏取 → 该回合不召回（`reason: "no-user-text"`，
 * 可观察、不污染上下文）；误取 → 召回完全跑偏且**每回合都注入错内容**。
 * 后者危害更大，故宁可 fail closed。
 */
export const USER_SOURCE_KIND = "user";

/**
 * 判定一条消息是否**真实用户输入**。
 *
 * @param {unknown} source `message.source`
 * @returns {boolean}
 */
export function isUserInputSource(source) {
  if (source === null || typeof source !== "object") {
    // 无 source：旧宿主或直调测试的形态 —— 按用户输入处理（不做静默漏取）。
    return true;
  }
  const kind = source.kind;
  if (typeof kind !== "string" || kind === "") {
    // 有 source 但无 kind：同样无法据此排除，保守按用户处理。
    return true;
  }
  return kind === USER_SOURCE_KIND;
}

/**
 * 从 pre-step 载荷的 messages 里取出**本回合用户消息**文本。
 *
 * 载荷结构由 `10 §5.3` 定义为 `{agent, messages, turn, step, signal}`。
 * `messages` 是本回合装配的批次（不含历史），故末条**真实用户**消息即本回合输入。
 *
 * 排除两类非用户输入（两者都带 `role: "user"`）：
 *   1. 本插件自己注入的行（否则会拿注入结果当查询）；
 *   2. 宿主装配的上下文行——按 `isUserInputSource` 的**白名单**判定
 *      （只有 `kind === "user"` 接受；无 source 时才兜底按用户处理）。
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
    // **白名单判定**（2026-10-27）：见 `USER_SOURCE_KIND` 的实测事故说明。
    // 黑名单方向失败开放——宿主新增一种通知就会被当成用户查询。
    if (!isUserInputSource(message.source)) continue;
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
  // **本句是全行唯一的「候选性/未命中」权威声明**（2026-10-25 去冗余）：
  // 此前「候选不是结论」「未命中不代表无相关」在基线段尾、三态行、截断行
  // 各复述一遍（实测同一语义出现 3–4 次、约 360 字节）。现统一在此声明一次，
  // 其余各处只报**本次特有的事实**（几条、哪条源未读、裁去几条），不复述语义。
  lines.push("以下由确定性匹配取得，是**候选**不是结论：命中不等于适用（02 §9.2／34 §13）；**未命中也不代表无相关**；**常驻列出者同样不证明适用**。是否适用须自行判断。");
  // **能力边界须让读者看见**：词法匹配只能对上「字面相近」的东西。
  // 实测（2026-10-24 复测）：用 Pitfall 自己的「症状段」去召回它自己，23/23 = 100%
  // （22 条靠 tier 1 适用范围、1 条靠 tier 4 正文）。旧值 43%（13/30）是第 46 轮
  // **之前**（正文只匹配前 1200 字符时）的测量，全文匹配后已失效。
  // 故 `23 §12` 的「故障调查」消费点不能只靠本行的召回结果，跨层要语义判断。
  // 只在**含事实候选**时才提示（纯规范命中时该边界不影响使用），控制篇幅。
  if (facts.length > 0 && result?.limitations?.lexicalOnly === true) {
    // **不引用具体百分比**：数字会随实现演进失效，而本行每回合都注入，
    // 过时数字会被反复放大（实测旧值 43% 与现状 100% 相差巨大）。
    // 保留结构性边界即可——它不因实现改进而变假。
    // 去冗余：第 2 行已声明「未命中也不代表无相关」，此处只保留**词法匹配**这一
    // 特有边界（换个说法就会漏），不再复述「不代表不存在」。
    lines.push("（**能力边界**：字面词法匹配，换个说法就会漏——尤其症状与机制表述常不重合，**未命中不代表没有同类教训**，查故障时请自行按机制检索。）");
  }
  // **决策基线（F1）**：无条件列出全部 active ADR——独立于词法候选区（`22 §12`
  // 义务召回原则；`02 §9.1` F1「枚举指定对象集合」）。**为何必须常驻**：
  // 法定效力决策（`22 §1`：违背 active ADR 视同违背规范源）若只靠词法命中，
  // 可见性就取决于当回合用词；实测「每次回复先称呼老丁」在「改成异步的」上
  // 零召回。故本段不受 `- ` 裁剪循环影响（用 `·` 前缀，与候选行区分），
  // 自身有独立字节上限并如实披露截断。
  const baseline = result?.decisionBaseline;
  const baselineItems = Array.isArray(baseline?.items) ? baseline.items : [];
  if (baselineItems.length > 0 || baseline?.sourceUnreadable === true) {
    // **极小预算的退化形态先判**：此时整段压成一行（段头、计数、入口、适用性
    // 否定都在这一行里），故不得再输出独立段头与独立声明——否则又超回去。
    const baselineLimitBytes =
      typeof result?.budget?.limitBytes === "number" ? result.budget.limitBytes : null;
    const totalBudgetTooSmall = baselineLimitBytes !== null && baselineLimitBytes > 0
      && baselineLimitBytes < BASELINE_YIELD_BELOW_BYTES;
    if (totalBudgetTooSmall && baselineItems.length > 0) {
      // **极小预算下基线整体让位（如实登记，非静默）**：预算 < 1200 时固定声明
      // （约 720 字节）加三态/截断披露行已顶满，实测 800 预算下加任何基线痕迹
      // 都会超（单行形态 898、并入披露行 870，均 > 800）。故此时不输出基线文本，
      // 改由**数据层**如实承载：`decisionBaseline.items` 与 `reservedBytes` 仍在
      // 返回值里，调用方与测试可机械观察「基线存在但未在注入面展开」。
      // 取舍理由：`10:241`「注入内容未超 LDVH 侧常量预算」是硬核对项；
      // 极小额预算下让基线让位，是「预算可守」优先于「小预算下也逐条列全」。
      // 生产常量 2400 与测试矩阵 1200–4000 均不受影响（基线正常展开）。
    } else {
    lines.push(`【决策基线 · active ADR（22 §12 义务披露）】`);
    if (baseline?.sourceUnreadable === true && baselineItems.length === 0) {
      // 与三态同口径：读不到 ≠ 没有。绝不静默留空。
      lines.push("· 事实源不可读，基线未取得——**不表示本项目没有 ADR**（34 §12）。");
    } else {
      // 逐条按字节上限收敛；超出的如实计数披露（`02 §9.1`：不得静默截断）。
      //
      // **上限须随总预算缩放**（2026-10-25，修复 800 字节用例暴露的真实冲突）：
      // 固定 600 字节的基线在总预算 800 时会与固定声明（720 字节）直接对撞——
      // 实测 1179 > 800。基线是义务披露，但**披露本身也要能被装下**；
      // 故实际上限取「常量的上限」与「总预算的一部分」的较小者，
      // 极小预算下退化为「计数 + 取全量入口」而不是逐条标题（内容按预算收敛，
      // 披露义务不减：仍如实说明有几条、去哪取）。
      const limitBytesForBaseline =
        typeof result?.budget?.limitBytes === "number" ? result.budget.limitBytes : null;
      const scaledCap = limitBytesForBaseline !== null && limitBytesForBaseline > 0
        // 基线最多占注入预算的 1/3，余下留给固定声明与候选区（共享常量）。
        ? Math.floor(limitBytesForBaseline / BASELINE_BUDGET_SHARE_DIVISOR)
        : ADR_BASELINE_BYTE_BUDGET;
      const effectiveCap = Math.min(ADR_BASELINE_BYTE_BUDGET, scaledCap);
      let usedBytes = 0;
      let shown = 0;
      let omitted = 0;
      for (const item of baselineItems) {
        const line = `· ${item.title}${item.status ? `［${item.status}］` : ""}`;
        const lineBytes = Buffer.byteLength(line, "utf8") + 1;
        if (shown > 0 && usedBytes + lineBytes > effectiveCap) {
          omitted += 1;
          continue;
        }
        lines.push(line);
        usedBytes += lineBytes;
        shown += 1;
      }
      if (omitted > 0) {
        lines.push(
          `（基线按字节上限 ${effectiveCap} 列出前 ${shown} 条，另有 ${omitted} 条未列出；` +
            `**未列出不代表不存在**，用 ldvh_adr_list 取全量。）`,
        );
      }
      // 适用性声明不可省：基线常驻**不等于**每条都适用于本回合（`02 §9.2`／34 §13）。
      // 适用性长声明已由第 2 行承载；此处只留极短复述——基线紧邻其条目，
      // 读者最容易在此误读为「应当遵守」（22 §1 法定效力），故不可完全省略。
      lines.push("（基线只保证「看得见」，**不证明适用**。）");
    }
    }
  }
  if (specs.length > 0) {
    // **来源披露**（01 §10.3）：语料由回退来源应答时，必须如实标注，
    // 不得把回退来源表述为项目自著语料。读者据此知道「这些规则来自源仓库/
    // 插件包，而非本项目自著」——两者的成员条件与核对义务不同。
    const sourceView = result?.sourceView;
    if (sourceView?.specsAreProjectAuthored === false) {
      const tierLabel =
        sourceView.specs?.tier === "source-repo" ? "插件源仓库" :
        sourceView.specs?.tier === "package" ? "插件包内副本" : "外部来源";
      lines.push(
        `规范源（语料来自**${tierLabel}**，非本项目自著；其成员条件核对归源仓库。` +
          `下列相对路径在本项目根下**读不到**，须用绝对路径读取）：`,
      );
    } else {
      lines.push("规范源：");
    }
    // **路径须可直接读取**（2026-10-24 修）：语料来自回退来源时，`path` 是相对
    // **源仓库**的相对路径，按本项目根去读会失败（实测回退到源仓库时
    // `specs/34-…md` 在项目根下不存在）。此时显示 `absolutePath`。
    const preferAbsolute = result?.sourceView?.specsAreProjectAuthored === false;
    for (const spec of specs) {
      const shown = preferAbsolute && typeof spec.absolutePath === "string" ? spec.absolutePath : spec.path;
      // **判断依据前置**（2026-10-24）：读者要判断「这条为什么相关」，
      // 而路径（尤其事实侧的 UUID 文件名）对人零信息量、却排在理由之前。
      // 实测：单条规范卡 114 字符里路径占 67（59%），读者须先读完
      // `ldvh-base/pitfalls/pitfall-86f03312-6d12-47f2-…md` 才看到命中理由。
      // 故顺序改为：标题 → **命中理由** → 路径（路径仍保留，供打开文件）。
      lines.push(`- ${spec.title} — ${spec.hitReason}（${shown}）`);
    }
  }
  if (facts.length > 0) {
    lines.push("事实源：");
    for (const fact of facts) {
      const status = typeof fact.status === "string" && fact.status !== "" ? `/${fact.status}` : "";
      // **摘录必须出现在渲染行里**（`02 §9.1` F2「有界确定性摘录」）。
      // 数据层有 excerpt 而渲染层不显示，读者依然无法筛选——F2 的分层意义就丢了。
      // 摘录取数据层的 `excerpt`（已是有界确定性截断），此处不再二次加工。
      const excerpt = typeof fact.excerpt === "string" && fact.excerpt !== "" ? `\n  ↳ ${fact.excerpt}` : "";
      // 同规范卡：**命中理由前置**，路径后置（理由才是读者判断的依据）。
      // 注意「摘录另起一行」——若把路径拼在摘录之后，它会跟到换行后的末尾，
      // 与摘录挤在同一行（实测缺陷：路径出现在摘录行尾，读者看不出归属）。
      lines.push(`- [${fact.type}${status}] ${fact.title} — ${fact.hitReason}（${fact.path}）${excerpt}`);
    }
  }
  if (specs.length === 0 && facts.length === 0) {
    lines.push("本次未命中候选。这不证明「无相关约束」——确定性匹配会漏（换个说法就漏），必要时请自行扩大检索。");
  }
  // **`02 §9.1`**：截断/partial 必须可观察，且不得声称完整。
  // 除既有「超出预算已裁剪」外，这里把**具体被丢弃的是谁**也说出来——
  // 只说「有东西被裁掉」没用，读者要知道「没看到什么」。
  const droppedTotal =
    (result?.unchecked?.specs?.length ?? 0) + (result?.unchecked?.facts?.length ?? 0);
  // **只保留一条截断说明**：`partial` 与 `truncated` 在数据层是同一个值
  // （`partial: truncated`），此前渲染层为它输出了两条不同措辞的提示
  // （「排得靠后」与「超预算已裁剪」），既重复又互相矛盾。现由下方
  // `truncated` 分支统一说明**真实原因**，此处仅在部分场景补充「具体是谁被丢」。
  if (
    result?.partial === true &&
    droppedTotal > 0 &&
    result?.overBudget !== true &&
    result?.truncated !== true
  ) {
    const names = [
      ...(result.unchecked.specs ?? []).map((s) => `规范「${s.title}」`),
      ...(result.unchecked.facts ?? []).map((f) => `事实「${f.title}」`),
    ].slice(0, 3);
    lines.push(
      `（本次为 **partial**：另有 ${droppedTotal} 条候选未列出（${names.join("、")}${droppedTotal > 3 ? " 等" : ""}）。` +
        `未列出只表示排得靠后，**不代表不相关**——需要时请调大 limit 或缩小动作范围。）`,
    );
  }
  if (result?.truncated === true) {
    // **区分裁剪的真实原因**（此前一律说「超出预算已裁剪」，而实测多数情形
    // 根本没超预算——例如 used 2330 < limit 2400 却仍打这句话，属**误报**）。
    // 裁剪有三种来源，只有第二种与预算有关：
    //   1. `limit`（条数上限）——结果按条数截断；
    //   2. 预算（字节上限）——放不下更多；
    //   3. 保底——预算极小到连首项都放不下，仍然给出（此时才超额）。
    const usedBytes = result.budget?.usedBytes ?? 0;
    const limitBytes = result.budget?.limitBytes ?? 0;
    // **判据：还有没有候选是因为「放不下」而被丢的**——不是看用量百分比。
    // 实测反例：预算 1200、用量 674（56%）却已放不下任何一条事实（单条 586，
    // 674+586>1200）。用「是否 ≥95%」判会误判成条数限制。
    // 正确判据：未列出的候选里，是否存在「若预算足够本可加入」的——
    // 即 `unchecked` 非空且其首条大小超过剩余空间。
    // **两侧口径必须一致**（2026-10-24 修）。
    //
    // `source-recall.js` 的预算估算已改为「渲染行字节 + 预留渲染开销」，
    // 而这里仍按「总预算 − 候选行用量」算剩余空间、并按 `JSON.stringify` 估
    // 下一条大小——两处口径不一致会误判归因。
    //
    // 实测：预算 1200 时 `usedBytes=474`，按老算法剩余 726「够放」→ 归因成
    // 「受条数上限（limit=99）限制」；而实际可用 = 1200 − 720(渲染开销) = 480，
    // 已用 474，**只剩 6 字节**，确实是预算放不下。
    //
    // 故此处同样扣除渲染开销，并用与数据侧一致的「行字节」估算下一条。
    const RENDER_OVERHEAD_BYTES = 720;
    const remaining = limitBytes - RENDER_OVERHEAD_BYTES - usedBytes;
    const estimateLineBytes = (item) => {
      const title = typeof item?.title === "string" ? item.title : "";
      const reason = typeof item?.hitReason === "string" ? item.hitReason : "";
      const path = typeof item?.path === "string" ? item.path : "";
      const excerpt = typeof item?.excerpt === "string" ? item.excerpt : "";
      return Buffer.byteLength(`${title}${reason}${path}${excerpt}`, "utf8") + 8;
    };
    const nextDropped = result.unchecked?.specs?.[0] ?? result.unchecked?.facts?.[0];
    const nextSize = nextDropped === undefined ? 0 : estimateLineBytes(nextDropped);
    // 注：`unchecked` 里存的是精简卡（title+path），不是完整候选，故用它做
    // 精确大小判断不可靠；这里改用**是否有被预算挡住的迹象**：
    // 两源都有命中却有一源结果为 0，且剩余空间小于一条常规卡（约 400 字节）。
    // **两源都要检查**（2026-10-24 修）。原实现只看事实侧
    // （`factsReturned === 0`），而「规范侧有命中却返回 0」是同样强的证据。
    // 实测：limit=99、预算 1200 时 `specHits=12` 但 `specsReturned=0`（60% 的
    // 规范配额放不下任何一条），此时渲染却报「受条数上限（limit=99）限制」——
    // **归因错误**：limit=99 根本不构成限制，真实原因是规范侧被预算挡掉。
    const oneSourceEmpty =
      ((result.counts?.factHits ?? 0) > 0 && (result.counts?.factsReturned ?? 0) === 0) ||
      ((result.counts?.specHits ?? 0) > 0 && (result.counts?.specsReturned ?? 0) === 0);
    // 判据收紧：**有一源命中却返回 0** 本身就是「放不下」的强证据——
    // 若真是条数限制，limit=99 时两源都该有条目。此时不必再猜剩余空间。
    // （实测：limit=99、预算 1200 → specs=1、facts=0、remaining=526，
    //   而单条事实 586 > 526，确实是放不下；「剩 526<400」判断太粗会漏。）
    // 三个彼此独立的「放不下」迹象，任一成立即为预算受限：
    //   a) 已超额（保底）；
    //   b) 有一源有命中却返回 0（真条数限制下不会如此）；
    //   c) 剩余空间已不足一张常规卡（实测最小卡约 200 字节）。
    const blockedByBudget =
      result.overBudget === true ||
      (oneSourceEmpty && (result.counts?.specHits ?? 0) > 0) ||
      remaining < Math.max(nextSize, 200);
    if (result.overBudget === true) {
      // 保底导致超额：必须说清「预算极小、只给了保底项」。
      lines.push(`（预算极小（上限 ${limitBytes} 字节）已超额，仅保底给出首项（实际 ${usedBytes} 字节）。**未列出的部分不代表不存在**，需要时请扩大检索。）`);
    } else if (blockedByBudget) {
      // 真实原因是预算：可能用量百分比不高，但已放不下下一条。
      // 确实是被预算挡住了（用量贴近上限）。
      lines.push(`（受预算限制已裁剪：上限 ${limitBytes} 字节，实际用 ${usedBytes} 字节。未列出的部分不代表不存在。）`);
    } else {
      // 预算还很宽松 —— 说明是 **limit（条数）** 挡住的，如实说 limit。
      // **`34 §11` 第 2 项三要素须同行**（第四十一次审核 Minor-2/3）：截断来源、
      // 实际用量与「未返回的部分不代表不存在」。此前末者被移到三态行承接，要素
      // 未丢但可追溯性变弱——读者读到这条截断行时，须当行即知「没列出的不是没有」。
      lines.push(`（受条数上限（limit=${result.budget?.limit ?? "?"}）限制，仅列出前 ${(result.specs?.length ?? 0) + (result.facts?.length ?? 0)} 条；预算尚有余量（实际用 ${usedBytes}/${limitBytes} 字节）。未返回的部分不代表不存在，调大 limit 可看到更多。）`);
    }
  }
  // **三态取值与未读取源须在注入面披露**（第六次审核 N-5）：34 §12 要求
  // 「召回范围的完整度须以三态交还」「取值须与未检查范围逐类对应」，而注入
  // 路径此前只渲染截断说明、从不渲染 `recallCompleteness`——AI 在注入上下文中
  // 无从核对 §6 零命中退出路径的 complete 前提。`complete` 时不加行（稳态安静，
  // 与截断说明只在有事发生时输出同一纪律）；`partial`/`unavailable` 必须出声。
  const completeness = result?.recallCompleteness;
  if (completeness === "partial" || completeness === "unavailable") {
    const notRead = Array.isArray(result?.uncheckedRange?.sourceNotRead)
      ? result.uncheckedRange.sourceNotRead
      : [];
    // **N-8（第七次复审）+ 观察 B（第八次复核）：「被过滤挡掉」也是 34 §12 的
    // 逐类清单项**（「哪些来源未读取、哪些候选被类型／状态过滤挡掉、哪些因预算
    // 或条数未返回」——后者由截断归因行承载，前两者在此承载）。按**非零类别
    // 分列**：excludedByTypeWhitelist 是未登记类型（02 §9.2：中间产物不参与
    // 「无相关」的判定），语义与类型/状态过滤不同，不得并入同一标签。
    // 只报数量与类别；逐条清单在数据层 uncheckedRange.excludedBy*，注入面
    // 不复制（预算纪律）。
    const ur = result?.uncheckedRange;
    const filterParts = [];
    if (Array.isArray(ur?.excludedByTypeFilter) && ur.excludedByTypeFilter.length > 0) {
      filterParts.push(`${ur.excludedByTypeFilter.length} 条被类型过滤`);
    }
    if (Array.isArray(ur?.excludedByStatus) && ur.excludedByStatus.length > 0) {
      filterParts.push(`${ur.excludedByStatus.length} 条被状态过滤`);
    }
    if (Array.isArray(ur?.excludedByTypeWhitelist) && ur.excludedByTypeWhitelist.length > 0) {
      filterParts.push(`${ur.excludedByTypeWhitelist.length} 条未登记类型不参与`);
    }
    const filteredNote = filterParts.length > 0 ? `；另 ${filterParts.join("、")}` : "";
    lines.push(
      `（本次召回完整度：**${completeness}**${notRead.length > 0 ? `；未读取的源：${notRead.join("；")}` : ""}${filteredNote}。` +
        (completeness === "unavailable"
          // 语义声明已由第 2 行统一承载；此处只报**本态特有的处置约束**。
          ? "**「未命中」不构成「无相关」的证据**（34 §12），不得据此按零命中路径继续（§16.1 第 7 项）。"
          : "未取得的部分不代表不存在；「未命中」不构成「无相关」的证据（34 §12）。") +
        "）",
    );
  }
  // **两道渲染层硬约束，最终文本须同时满足**（2026-10-25，N-5 引出重构；
  // N-6/N-7 修正裁剪方向）：
  // ① 字符硬上限 RECALL_RENDER_CHAR_LIMIT——渲染面自身的绝对上限；
  // ② 字节预算 limitBytes（`10:241`「未超 LDVH 侧常量预算」）——数据侧按
  //    「候选行估算 + 720 字节固定开销预留」装填，但**条件披露行**（截断说明、
  //    三态完整度行）只在渲染时才产生、未计入预留，实测预算 1200 时注入达
  //    1260 字节。渲染文本的真实字节只有这里知道，故兜底放这里。
  // **统一裁剪纪律（N-6）**：只从尾部裁「- 」开头的候选行，固定声明与披露行
  // （三态完整度行、截断归因行）永不裁剪，且如实注明裁了几条（34 §12 三态
  // 与截断披露不得静默省略；02 §9.1 不得静默截断）。旧实现的字符上限路径
  // 「从头部保留、尾部整段丢弃」会把排在末尾的披露行连同候选一起裁掉，
  // 且说明行把被丢弃的**披露**误称为**候选**——两条路径纪律相反，现统一。
  const limitBytes = typeof result?.budget?.limitBytes === "number" ? result.budget.limitBytes : null;
  // 为「如实注明」说明行预留空间。实测最坏说明行（字符上限+字节预算双归因
  // 含预留披露、三位数条数）约 257 字节／111 字符；预留取 280 字节／120 字符
  // ——宁可少放一条候选，不得超限后声称未超（`10:241`）。
  const NOTE_RESERVE_CHARS = 120;
  const NOTE_RESERVE_BYTES = 280;
  // **字符上限由本档字节预算导出**（2026-10-27）：档位抬高时它随之抬高，
  // 不再把 10240 的预算卡在 1600 字符（≈3200 字节）上。
  const charLimit = renderCharLimitFor(limitBytes);
  const trimmed = [...lines];
  const joined = () => trimmed.join("\n");
  const overChars = () => joined().length > charLimit - NOTE_RESERVE_CHARS;
  const overBytes = () =>
    limitBytes !== null && limitBytes > 0 &&
    Buffer.byteLength(joined(), "utf8") + NOTE_RESERVE_BYTES > limitBytes;
  let droppedByRender = 0;
  // 归因记录**裁剪期间实际生效的约束**（裁完再判会把「因 A 裁到 B 也满足」误报成 B）。
  let charTriggered = false;
  let byteTriggered = false;
  while (overChars() || overBytes()) {
    if (overChars()) charTriggered = true;
    if (overBytes()) byteTriggered = true;
    let idx = -1;
    for (let i = trimmed.length - 1; i >= 0; i -= 1) {
      if (trimmed[i].startsWith("- ")) { idx = i; break; }
    }
    if (idx === -1) break; // 已无候选行可裁；固定与披露文本如实带出，不静默删
    trimmed.splice(idx, 1);
    droppedByRender += 1;
  }
  if (droppedByRender > 0) {
    const reasons = [];
    if (charTriggered) reasons.push(`字符上限 ${charLimit}`);
    // **观察 A（第八次复核）**：预算内含说明行预留（NOTE_RESERVE_BYTES），
    // 不写明会让读者把「为披露留空间」误读成「超了预算才裁」。
    if (byteTriggered) reasons.push(`字节预算 ${limitBytes}，含披露行预留 ${NOTE_RESERVE_BYTES} 字节`);
    // **最终条数须如实**：上方「仅列出前 N 条」说明行取的是数据层条数，
    // 渲染层再裁后该 N 已过时——本行给出实际列出的条数，使两行合读不矛盾。
    const finalCount = trimmed.filter((l) => l.startsWith("- ")).length;
    const fullNote =
      `（**渲染层按硬约束（${reasons.join("／")}）裁去 ${droppedByRender} 条候选**，现列出 ${finalCount} 条；` +
      `未列出的不代表不存在，需更多请调大 limit 或缩小动作范围。）`;
    // **地板情形的紧凑说明行**（第八次复核观察 C 的明示取舍之机械承载）：
    // 候选行裁光后固定声明+披露行仍可能顶破预算（实测 800 字节下 807）——
    // 预留机制管不到「零候选」地板。此时改用紧凑说明行：保留 `02 §9.1` 强制
    // 要素（约束归因、裁去条数、实际条数、「不代表不存在」），舍去「含披露行
    // 预留」精度细节——披露底线优先于说明行冗长度。紧凑行仍放不下时如实
    // 超预算带出（固定与披露文本不静默删，见上）；生产常量 2400 与测试矩阵
    // 800–4000 均不触及该残余。
    const compactReasons = [];
    // **须报实际生效的上限**（2026-10-27，独立审核严重项 1）：此处原先写死
    // `RECALL_RENDER_CHAR_LIMIT`（=1600），而字符上限自本轮起由预算导出
    // （`renderCharLimitFor`）。实测 `budgetBytes=1200` 时注入文本声称
    // 「字符上限 1600」，而 `result.render.limitChars` 报 600——**注入行自己
    // 在说谎**，违反 `02 §9.1`「截断……必须可观察」的据实要求。
    // 保留一条最小说明：本条与 `renderCharLimitFor` 脱节会让披露失真。
    if (charTriggered) compactReasons.push(`字符上限 ${renderCharLimitFor(limitBytes)}`);
    if (byteTriggered) compactReasons.push(`字节预算 ${limitBytes}`);
    const compactNote =
      `（渲染层按硬约束（${compactReasons.join("／")}）裁去 ${droppedByRender} 条候选，` +
      `现列出 ${finalCount} 条；未列出的不代表不存在。）`;
    trimmed.push(fullNote);
    if (limitBytes !== null && limitBytes > 0 && Buffer.byteLength(trimmed.join("\n"), "utf8") > limitBytes) {
      trimmed[trimmed.length - 1] = compactNote;
    }
  }
  // **最终总预算收口**（2026-10-25，第四十次审核 M-1 修复）。
  //
  // 上面的裁剪循环只裁 `- ` 候选行；候选裁光后 `idx === -1` 直接 break，
  // **固定声明 + 基线段 + 三态/截断披露行仍可能顶破预算且无人披露**——
  // 实测预算 1200、query「页面白屏了」时注入 1364 字节（超 164），而数据层
  // `overBudget=false`、注入文本还写着「实际用 415 字节」，读者无从得知真实量。
  // 这违反 `10:241`「注入内容未超 LDVH 侧常量预算」与 `02 §9.1`「不得静默截断」。
  //
  // 收口规则（固定文本与三态披露**永不删**——那是 `34 §12` 的披露底线）：
  //   1. 仍超预算 → **基线整段让位**（它是本行里唯一可让的内容块；
  //      义务披露降级为一句可查的痕迹，不静默消失）；
  //   2. 让位后仍超 → 如实带出并标注超出量（不再假装守住了预算）。
  if (limitBytes !== null && limitBytes > 0) {
    const bytesNow = () => Buffer.byteLength(trimmed.join("\n"), "utf8");
    if (bytesNow() > limitBytes) {
      // 找出基线段的行区间（段头以「【决策基线」起，到紧随其后的最后一个
      // 非基线行之前；基线行以 `· ` 或「（基线」开头）。
      const startIdx = trimmed.findIndex((l) => l.startsWith("【决策基线"));
      if (startIdx !== -1) {
        let endIdx = startIdx + 1;
        while (
          endIdx < trimmed.length
          && (trimmed[endIdx].startsWith("· ") || trimmed[endIdx].startsWith("（基线") || trimmed[endIdx].startsWith("【决策基线"))
        ) endIdx += 1;
        const removed = endIdx - startIdx;
        const baselineCount = baselineItems.length;
        trimmed.splice(startIdx, removed);
        // **降级痕迹**：只留一行，说明基线存在但因预算未展开（不静默消失）。
        trimmed.splice(
          startIdx,
          0,
          `（决策基线未展开：${baselineCount} 条 active ADR 属 22 §12 义务披露，本次因字节预算 ${limitBytes} 不足未列出；` +
            `用 ldvh_adr_list 取全量。**常驻不等于适用**。）`,
        );
      }
    }
    // 让位后仍超：如实带出超出量（`00 §5.6` 不得声称超出依据的事）。
    //
    // **但极小预算下不再加这一行**：预算低于让位阈值时，超出的是固定声明与
    // 三态披露本身（`34 §12` 披露底线，既有的「披露优先于极小预算」取舍），
    // 加一行只会让超出更多（实测 800 下加此行使 698 → 1176）。该情形已在
    // 三态行与截断行如实说明，不属「基线导致的超支」，故不在此重复披露。
    const finalBytes = bytesNow();
    if (finalBytes > limitBytes && limitBytes >= BASELINE_YIELD_BELOW_BYTES) {
      trimmed.push(
        `（**本次注入 ${finalBytes} 字节，超出预算 ${limitBytes} 共 ${finalBytes - limitBytes} 字节**：` +
          `固定声明与三态披露为 34 §12 披露底线不予裁剪，已让出决策基线段仍不足；` +
          `请提高预算（属 Human 决定事项）或缩短单条标题。）`,
      );
    }
  }
  return trimmed.join("\n");
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
export async function buildRecallInjection({ userText, projectRoot, budgetBytes, limit } = {}) {
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
      // **声明范围**：这些类型不进自动注入（`31 §10` 2026-10-27 修订）。
      // 用 `excludeTypes` 而非 `types` 白名单：后者是「本次只看这几类」（被排除者
      // 进 `excludedByTypeFilter`、算未检查范围），前者是「这些类型不归本路径看」
      // （其消费入口在主动查）。二者混用会把职责边界报成召回缺陷。
      // 完整理由见 `INJECTION_EXCLUDED_TYPES` 的定义处注释。
      excludeTypes: INJECTION_EXCLUDED_TYPES,
      // `limit` 可覆盖（此前硬编码为 3 且不接受入参，测试传 limit=1 被静默忽略，
      // 导致「条数限制」的提示显示 limit=3 与实际调用不符）。
      limit: Number.isInteger(limit) && limit > 0 ? limit : 3,
      budgetBytes: Number.isInteger(budgetBytes) ? budgetBytes : RECALL_BYTE_BUDGET,
    });
  } catch (error) {
    // 召回失败不拦回合（它是输入侧，不是闸门）；如实标出原因，不假装「无相关」。
    return { inject: false, reason: `recall-failed:${error instanceof Error ? error.message : String(error)}` };
  }
  if (result?.ok !== true) {
    return { inject: false, reason: `recall-unavailable:${result?.error?.code ?? "unknown"}` };
  }
  const total = (result.specs?.length ?? 0) + (result.facts?.length ?? 0);
  // 决策走**纯函数** `decideInjection`（见其定义处）：把「决策读了什么」变成
  // 可独立注入测试的接口。此前这段逻辑内联在长函数里，只能整链路跑——
  // 而整链路里基线恒非空，短路分支根本进不去，于是「把分数接进决策」这种
  // 破坏**测不出来**（实测：破坏版仍 65/65 全绿）。抽出后守卫用例才有分辨力。
  // **零命中短路的例外：决策基线非空时仍须注入**（2026-10-25，Human 决定方案 A）。
  //
  // 旧行为「一条都没命中就不注入」的理由是 `02 §9.2` 要防「无条件注入」——那对
  // **词法候选**成立（候选的意义就在「本次相关」，无命中即无内容）。但 F1 基线
  // 不是候选：`22 §12` 的义务召回要求「相关行动开始前必须召回并核对 active ADR」，
  // 其可见性不得取决于当回合用词（实测「每次回复先称呼老丁」在无关消息上零召回）。
  // 若在此短路，基线就被词法运气重新挡在门外，方案 A 等于没做。
  //
  // 故：基线有内容（或事实源不可读须披露）→ 仍注入，但**只带基线**（`specs`/
  // `facts` 为空，渲染层自然不会输出候选区）。这条不构成「无条件注入」：
  // 34 §6 的进入条件仍在更上游把关（纯读取回合不进本函数）。
  const baselineHasContent =
    (result?.decisionBaseline?.items?.length ?? 0) > 0 ||
    result?.decisionBaseline?.sourceUnreadable === true;
  if (!decideInjection({ candidateCount: total, baselinePresent: baselineHasContent })) {
    // 一条都没命中、且无基线可披露 → 不注入。
    // 不注入不等于「无相关」，故这里只在返回值里说明，不写进上下文。
    return { inject: false, reason: "no-hits" };
  }
  const text = renderRecallRow(result);
  // **渲染裁剪须可观察**（`02 §9.1`「截断……必须可观察」/ `10:241` 预算核对）。
  //
  // 实测缺口（2026-10-24）：渲染层的硬上限会按行裁剪，提示语里也写明了，
  // 但 `result` 上**没有对应字段**——调用方与测试无法机械观察「这次渲染被裁过」，
  // 只能去正则匹配那段中文提示。现补一个布尔与计数，使该事实可编程判定。
  // **N-7（第七次复审）**：统一裁剪后说明行文案变了（「渲染层按硬约束…裁去 N 条
  // 候选」），旧正则只认字符上限文案，会把字节兜底裁剪漏报成 truncated:false。
  // 正则须与 renderRecallRow 的说明行同步——两处同文件相邻，改动时一并核对。
  const renderChars = text.length;
  const droppedMatch = /裁去 (\d+) 条候选/.exec(text);
  const renderTruncated = droppedMatch !== null;
  result.render = {
    chars: renderChars,
    // **须报实际生效的上限**（2026-10-27）：字符上限已由预算导出，若仍写死
    // `RECALL_RENDER_CHAR_LIMIT`，这个观察字段就会**说谎**——实测它在档 10K 下
    // 报 1600，实际生效 5120，调用方据此判断「还能不能多放」必然算错。
    limitChars: renderCharLimitFor(result?.budget?.limitBytes ?? null),
    truncated: renderTruncated,
    // 裁去的候选条数（未裁为 0）——使「裁了几条」也可编程判定，不必解析中文。
    droppedCandidates: renderTruncated ? Number(droppedMatch[1]) : 0,
    // 说明：这一步只裁**渲染文本**，不动候选数据；数据侧的裁剪由
    // result.truncated / partial / unchecked 承载，两者是不同的事。
    note: renderTruncated
      ? "渲染文本触硬约束（字符上限／字节预算）已按行裁去部分候选行；固定声明与披露行未裁；候选数据本身未因此减少，调大 limit 未必能显示更多，需先缩短标题/命中理由或提高上限（后者属 Human 决定事项，10:261）"
      : "渲染文本未触硬约束",
  };
  return { inject: true, text, digest: text, result };
}
