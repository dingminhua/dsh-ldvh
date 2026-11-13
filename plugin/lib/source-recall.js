// source-recall.js —— 行动前召回规范源与事实源（双源召回系统的取得环节）
//
// ## 这个模块在干什么
//
// 34 §7「输入来源」逐字：
//   「规则来源为规范源（经 01 §10 的 L0–L4 读取取得）；事实来源为事实源（经 02 §9
//    的 F0–F4 召回取得）；决定来源为 Human 决定记录与各事实类型中的决定类对象；
//    授权来源为 00 §3 与各授权程序。输入来源的读取深度须与风险层相称（03 §6.1）。」
//
// 34 §8.1 第 2 项（适用识别）逐字：
//   「从来源中**找出**与当次行动相关的规则、事实、决定与授权，并给出每一项的适用
//    依据（为何相关、覆盖哪一段行动）。」
//
// ## 本模块与 `34 §8.1` 第 2 项「找出」的区别（v5 更正，2026-10-24；序号随 34 号改名后 §8.1 插入「双源召回」为第 1 项而顺延）
//
// 本模块**只实现** `34 §8.1` 第 1 项（**双源召回**：取得候选），**不实现**第 2 项（**适用识别**）。二者不同：
//
// | | `34 §8.1` 第 2 项「找出」 | 本模块（第 1 项「双源召回」） |
// |---|---|---|
// | 输入 | **已取得的来源**（经 `01 §10`／`02 §9` 取得） | 一个动作描述字符串 |
// | 产出 | 相关项 **+ 适用依据**（「为何相关、覆盖哪一段行动」） | 候选 + **命中词** |
// | 性质 | 语义判断（`00 §4`），属 34 的职责 | 词法匹配，属引导面（`10 §5.3`） |
//
// **「命中词」不构成「适用依据」**：命中词只说明字面相近，不说明「为何相关、
// 覆盖哪一段行动」。故本模块的产出是 34「找出」的**输入候选**，不是它的替代。
//
// 本模块**不判定适用**——34 §13 明文「召回的命中不等于适用」；判适用是 34 的
// 后续工作，不由召回代劳。
//
// ## 为什么不建索引、不上向量
//
// **直接依据是 `02`**（事实源，本模块的 basis）：
//   · `02 §10.2` 只读路径·候选发现：「允许分页和确定性过滤；不修改事实源，**不建立持久索引**」；
//   · `02 §16` 红线第 3 项：「**不建立持久搜索索引**、关系图副本、全局事务、
//     统一状态机或第二事实源」。
//
// 同一设计意志在 `34 §17` 第 1 项也有表述（「不为本系统建立全量规则索引、实时规则
// 同步或规则依赖图——识别按需从来源读取，不预建索引」），但那是**双源召回系统**的
// 红线；本模块引用它只为说明同一取舍，**规范依据仍取 `02`**。
//
// 仓内两份独立调研（`0b3471af` A3、`fd133f0d` A2）得出同一结论：**零依赖启发式
// 起步（tokenize/jaccard）而非向量**。`fd133f0d` F7 记录 Mem0 实测图增益仅约 2%。
// 故本模块：现读现解析、确定性匹配、按层排序不算分、无持久索引、无向量。
//
// ## 为什么匹配是「分层布尔」而不是打分
//
// 打分（权重/相似度）不可解释，且会在决定/规则场景里制造假阳性。故按**层**排序：
// 命中越精确的字段，层越前；同层按时间倒序。每一层都产出 `hitReason`，
// 使调用方可核对「为什么这条被认为相关」。
//
// ## 边界
//
// - **不判定适用**（34 §13）：只给候选与理由。
// - **不写任何东西**：纯读，不落盘、不建索引、不回写。
// - **不补漏**：确定性召回会漏（换个说法就漏），漏了不补——这与 02 §9 的取舍一致。
// - **预算硬约束**（`fd133f0d` A3，以 Anthropic 注意力预算为一手依据）：返回内容
//   有字节上限，超了如实标 `truncated`，不静默截断后仍宣称完整。

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
// **结构化 frontmatter 解析**（2026-10-29）：`yaml` 已是本插件直接依赖
// （writer 侧已用），此处不新增依赖。理由见 `parseObjectFrontmatter` 的注释——
// 旧行式解析把块标量与嵌套结构读坏了，使结构维度对召回完全不可见。
import { parse as parseYaml } from "yaml";
// **机器可读召回判据表**（02 §12.4）：类型通道（类型点名／核心语义字段／
// 关系展开）的唯一输入。解析失败的类型一律停用机器判据，不回落默认值。
import { loadRecallCriteria, typeKeyDerivedWords } from "./recall-criteria.js";

// ---------------------------------------------------------------------------
// 分词：中文二元组 + ASCII 词，零依赖
// ---------------------------------------------------------------------------

/** 中文虚字：含任一虚字的二元组不参与匹配（不承载意义，只制造噪声）。 */
/**
 * **按类型的默认候选状态集**（`20–27` 各类型规范分别规定，**不得统一为 active**）。
 *
 * 实测缺陷（2026-10-24）：默认状态原写死 `["active"]`，而多数类型**没有**
 * `active` 这个状态——结果它们**默认一条都召回不到**：
 *
 *   · Spark（20）默认候选是 `open` → 34 条 open 不可见；
 *   · WorkCase（21 §13）是 `draft`+`open` → 36 条全部不可见（它连 active 都没有）；
 *   · Friction（26）是 `open`（+ 当时的 `observing`，2026-10-26 已退出闭集）→ 当时 92 条不可见；
 *   · ADR（22）／Norm（27）是 `active` → 恰好正确；
 *   · Pitfall（23 §12）是 `active` → 恰好正确（2026-11-03 取消 `draft` 后本类型无待确认档）。
 *
 * 合计 **142 条本可召回的事实**默认完全不可见。
 *
 * 逐条依据：
 *   · `20`「默认候选只包含 open Spark；implemented/discarded 不进入普通未处置候选」；
 *   · `21 §13`「默认候选只含 draft 与 open；closed 只在精确引用、证据链反查或历史追溯时展开」；
 *   · `23 §12`「默认候选只含 active」（2026-11-03 修订：`draft` 待确认态已取消，discarded 只在精确引用与历史追溯时展开）；
 *   · `26`「默认候选只含 `open`」（2026-10-26 修订：观察态已退出闭集）；resolved 与 voided 仅在精确引用时展开；
 *   · `22`「默认候选只含 active——当前决策基线就是 active 集本身」；
 *   · `27`「默认候选只含 active——当前生效规范就是 active 集本身」。
 *
 * 未列出的类型沿用 `["active"]`（`24` 未对默认候选另作规定）。
 */
/**
 * **参与匹配的 frontmatter 字段名清单**（导出供漂移检查回指规范）。
 *
 * 为什么要单独列成常量而不是散在 `detail` 数组里：这几项是**从 02 与 20–27
 * 抄来的知识**——字段名一旦在某类型规范里改名（如 `trigger_signal`），代码里
 * 这个字符串就失效，该字段内容对召回永久不可见，且**不会有任何测试报错**。
 * 抽成常量后，`recall-spec-drift.test.mjs` 可以逐项回指原文
 * （与 `precheck-record.spec-drift.test.mjs` 同口径）。
 */
export const MATCHED_FACT_FIELDS = Object.freeze([
  "decision",
  "phenomenon",
  "question",
  "research_question",
  "gist",
  "intent",
  "direction_key",
  "research_purpose",
  "trigger_signal",
  "summary",
  "scope",
  "title",
]);

export const DEFAULT_STATUSES_BY_TYPE = Object.freeze({
  spark: ["open"],
  // **`friction` 于 2026-10-26 修订**：`observing` 已退出 26 §9 状态闭集（观察
  // 材料改由 11 §12bis.1 的本地缓冲承载，不进事实源），故默认候选只含 `open`。
  friction: ["open"],
  // **`research` 须显式声明**（2026-10-24 修）：`24` 原文「默认状态范围
  // `status=active`，`retired` 只在精确引用、调研历史或来源追溯时进入候选」。
  // 此前它在白名单里却**缺这一项**，靠 `?? ["active"]` 的回退值碰巧对了——
  // 但那是巧合而非声明：一旦回退默认值改动，research 会静默改变候选范围，
  // 且无任何测试报错。漂移检查用例发现此缺项。
  research: ["active"],
  adr: ["active"],
  norm: ["active"],
  pitfall: ["active"],
  // **`subgoal` 于 2026-11 新增**（28 §12.4）：默认候选只含 `active`；
  // achieved/retired 仅在精确引用、历史追溯或达成证据汇总时展开。
  subgoal: ["active"],
  // **`devlog` 于 2026-11 新增**（29 §12.4）：默认候选只含 `active`；
  // absorbed/superseded/dropped 三终态不承重，仅在精确引用、历史追溯或
  // 承接核对时展开——它们进入默认候选会稀释当次候选面。
  devlog: ["active"],
});

/**
 * **兜底默认候选状态**（具名常量，2026-11）。
 *
 * `DEFAULT_STATUSES_BY_TYPE` 是「判据表里没有该类型条目」时使用的**显式兜底值**
 * ——它不再是唯一取值来源：取值优先从判据表读（`02 §12.4`「Code 依本契约确定性
 * 读取执行，不从规范自然语言正文抽取判据」）。
 *
 * 为什么仍要保留它：判据表可以缺席（`criteria === null`，如项目内既无自著规范、
 * 三级回退也全失败），也可能某类型还没有规范。此时若没有具名兜底，就只能写死
 * 字面量或让召回整体失效。**但兜底必须是可见的**——`02 §12.4` 禁的是「静默回落
 * 默认值」，不是「不许兜底」；回落的类型逐条登记在 `criteria.fallbackTypes`
 * 与 `gaps` 两处。
 */
export const DEFAULT_STATUSES_FALLBACK = Object.freeze(["active"]);

/**
 * 某类型的**默认候选状态取值策略**（`02 §12.4`）。
 *
 * 返回四形态之一：
 *   · `table`         —— 判据表给出了机械值，直接用（正常路径）；
 *   · `non-candidate` —— 判据表把「默认候选状态」标为「不采用」，该类型**没有候选
 *                        概念**（目前只有 Goal 单例，`specs/25-Goal-项目目标.md`），
 *                        故不进候选池，也**绝不回落**成 active；
 *   · `fallback`      —— 判据表里**没有该类型条目**（该类型还没规范），回落具名兜底；
 *   · `disabled`      —— 判据表里有该类型但**解析失败**（缺表/版本不符/机械值非法）：
 *                        维持 `02 §12.4` 的 fail-closed 路径——停用该类型的机器判据
 *                        并如实报错，**不把回落当作它的补救**（回落会让「表坏了」
 *                        看起来像「表没写」，把故障伪装成正常）。
 *
 * 取值比较沿用既有语义：整值相等、不区分大小写（见 `statusAllowed` 调用方注释）。
 */
export function recallStatusPolicyOf(criteria, type) {
  const entry = criteria?.byType?.get(type) ?? null;
  if (entry !== null) {
    if (entry.values?.notApplicable?.["默认候选状态"] === true) {
      return { kind: "non-candidate", statuses: [] };
    }
    const fromTable = entry.values?.defaultStatuses;
    if (Array.isArray(fromTable) && fromTable.length > 0) {
      return { kind: "table", statuses: fromTable };
    }
  }
  const parseFailed = (criteria?.errors ?? []).some((error) => error.type === type);
  return {
    kind: parseFailed ? "disabled" : "fallback",
    statuses: DEFAULT_STATUSES_BY_TYPE[type] ?? DEFAULT_STATUSES_FALLBACK,
  };
}

/**
 * **已登记事实类型的白名单**（`02 §9.2`「中间产物不进入召回」的落实）。
 *
 * > 中间产物不进入召回：事实源之外的中间产物（如 11 §12bis 的留观缓冲）
 * > **不在 F0–F4 的任何一层里**——它们不是事实对象，故不形成候选卡。
 *
 * 实测缺陷（2026-10-24）：`loadFacts` 只按目录扫 `.md`，**不校验类型是否已登记**。
 * 在 `ldvh-base/observation-buffer/` 下放一条 `fact_type_key: observation-buffer`
 * 的条目，它能作为事实候选被召回——中间产物进入了 F2，等于「因被召回而取得
 * 适用性」的假象，恰是 02 §9.2 明禁的。
 *
 * 白名单来自 `specs/20–29` 段已登记的事实类型（`01 §8.1` 号段归属）。
 * 不在名单内的 `fact_type_key` 一律**不形成候选**。
 *
 * 维护：新增事实类型规范（20–29 段）时须同步此表；两处不一致会让新类型默默
 * 召回不到——故 `source-recall.test.mjs` 有一条用例直接比对 specs 目录与本表。
 */
export const REGISTERED_FACT_TYPES = Object.freeze([
  "spark", "adr", "pitfall", "research", "goal", "friction", "norm", "subgoal", "devlog",
]);

/**
 * **必需优先**的事实类型（`03 §6.1` 标准路径：「完成所需的 **ADR/Pitfall** 召回」）。
 *
 * 为什么是「排序优先」而不是「过滤限定」：过滤会**漏**。
 *   · 过滤（曾试）：默认只召回这两类 → 「加个」这类短指令因只能搜这两类而
 *     召回不到东西（实测 inject 由 true 变 false），属真实退化。
 *   · 排序（现用）：仍召回全部被触发的类型，只是把 ADR/Pitfall 排在同层前面，
 *     确保它们不被 research 等无关类型挤掉（实测「写一个 ADR」曾在 limit=3 时
 *     返回两条 research、一条 adr 都没有）。
 *
 * `03 §6.1` 快通道那条写的是「不遍历**未被当前目标和来源规则触发的**全量规则或
 * 事实」——不该全量遍历，但被触发的仍应召回到。排序满足这一点而不牺牲召回面。
 */
export const REQUIRED_RECALL_TYPES = Object.freeze(["adr", "pitfall"]);

/**
 * **类型不参与排序**（2026-10-31 Human 裁定删除类型等级表）。
 *
 * 历史：本文件曾导出 `RECALL_TYPE_TIERS`（ADR=0／Norm=1／Pitfall=2／Friction=3）
 * 与 `RECALL_TYPE_TIER_OTHER`，作为 `compareFactHits` 的末位键——「证据完全
 * 相同时才看类型」。该机制有三重问题，Human 已裁定删除：
 *
 *   1. **无规范承载**：specs/ 全库没有「类型等级」概念，`02 §9.2` 反而明禁
 *      「建立所有类型共用的相关性分数」；
 *   2. **与义务召回的实现重复**：`REQUIRED_RECALL_TYPES` 已是声明，而该表让
 *      ADR/Pitfall 同分时优先，属同一规则的第二个实现；
 *   3. **收益不抵成本**：实测其唯一可见效果是「写一个 ADR」等点名查询的次序，
 *      而那个场景的正确做法是**类型点名层**（见 `matchCandidate`），不是排序轴。
 *
 * 删除后的口径：**证据相同时不再有类型轴**——`tier`/`hits`/`weakHit` 全等时
 * 直接落到状态、时间与路径。`REQUIRED_RECALL_TYPES` 保留为**声明性常量**
 * （`03 §6.1` 点名要求「完成所需的 ADR/Pitfall 召回」），**无任何排序消费点**；
 * 其义务由「默认候选状态集 + 不被过滤」与类型点名层承担。
 */

/**
 * **不进自动注入路径**的事实类型（`31 §10` 2026-10-27 修订）。
 *
 * 用途**只是**给注入路径（`recall-injection.js` 的 `buildRecallInjection`）一个
 * 具名常量，使「哪些类型不进注入」可在一处读到、可被测试钉住；`recallForAction`
 * 本身**不读它**——直调路径（AI 主动查、诊断脚本）仍可召回这些类型。
 *
 * ── 为什么不是 `types` 白名单（重要，别合并成一条路径）───────────────
 *
 * 直觉做法是注入时传 `types: ["adr","pitfall","workcase", …]`（正面枚举「要哪些」）。
 * 不采用，有两条据实的理由：
 *
 * 1. **正面枚举会在新增事实类型时静默漏掉它。** 本文件 `REGISTERED_FACT_TYPES`
 *    的维护注释已写明：新增 20–29 段的事实类型须同步该表。若注入路径再维护一份
 *    正面白名单，就是**第二份需要同步的清单**（`01 §11.4` 第二规则源风险）——
 *    新增类型后 `recallForAction` 认得它、注入路径却不给，且这种漏**不出声**。
 *    反面的排除清单则**失败时偏向多给**：新类型默认进入注入范围，最坏是噪音，
 *    不是静默缺失。（此处**不引规范作背书**：`34 §6`「进入信号」讲的是何时进入
 *    召回、不是类型清单该正面还是反面维护；而 `03 §6.1` 快通道那句「已成立的事实
 *    召回时机仍须完成所需召回」反而与「整类排除」方向相反，拿它当依据是自我反驳。
 *    这条理由的效力只来自上述第二规则源风险本身。）
 * 2. **披露语义不同，不能共用同一个字段。** `uncheckedRange.excludedByTypeFilter`
 *    回答的是「**本次**因调用方收窄而没看什么」，是逐次事实；本常量表达的是
 *    「这些类型**恒定**不归本路径看」，其消费入口在别处（`31 §10` 的主动查）。
 *    混用会让披露行把职责边界读成召回缺陷。
 *
 * 故正确做法是**让声明范围本身变小**：注入路径声明「除这些类型之外的全部类型」
 * 都在范围内。本常量表达「哪些类型不在其声明范围内」，实现见 `recallForAction`
 * 的 `excludeTypes` 参数（`scopedFacts`）。
 *
 * ── 依据 ───────────────────────────────────────────────────────────
 *
 * Human 决定（2026-10-27）：「Spark 不进召回，AI 主动查即可，不是必须要知道的
 * 内容，有方便的查询工具即可」。`31 §10` 随之把方向线召回入口改为「由 AI 在
 * 需要时主动查询」。`34 §15.1` 第 5 项把「**扩大**召回的类型范围」列为 Human
 * 决定事项——收窄不在其中，故本收窄无须另经 Human Gate。
 *
 * 主动查的入口是 `ldvh_spark_list`（`plugin/lib/spark-tools.js`），其
 * `keyword`／`priorities`／`serves`／`status` 收窄参数见 `31 §10`。
 *
 * ── DevLog 并入（2026-11-11 修）─────────────────────────────────────
 *
 * `29 §12.1` 的召回时机行逐字写明 DevLog「不进引导面自动注入，AI 主动查询」，
 * 与 spark 同一处置。而此前本常量只含 spark，devlog 仍进候选池——后果有两层：
 * ① 它**本来就不会被交付**（无分节次序），却计入 `counts.factHits` 与「未列出」
 * 的分母，实测同一次召回 112 条命中里含 8 条 devlog，使披露数字比实际职责范围
 * 大 8 条；② `34 §12` 的「职责边界」与「本次漏了什么」两类披露被混为一谈。
 *
 * 该收窄**不属 Human Gate**：`34 §15.1` 第 5 项把「**扩大**召回的类型范围」列为
 * 决定事项，收窄不在其中（与 spark 当初入列的判定同口径）；且此处只是让实现
 * 对齐 29 号已写明的边界，不新设边界。
 *
 * 主动查入口 `ldvh_devlog_list`（`plugin/lib/devlog-tools.js`）。
 */
export const INJECTION_EXCLUDED_TYPES = Object.freeze(["spark", "devlog"]);

/**
 * **被排除事实类型的主动查入口**（`{type: toolName}`）。
 *
 * 与 `INJECTION_EXCLUDED_TYPES` **必须一一对应**：数据层在生成
 * `scopeExcluded.entryByType` 时逐个查表，缺项直接抛错（`01 §11.4` 禁静默回落）。
 * 单列一张表而不是在映射处内联条件，是为了让「新增一个排除类型」时
 * 漏登记入口这件事变成**开发期错误**，而不是运行期一句「须另行查询」。
 */
const SCOPE_EXCLUDED_ENTRY_BY_TYPE = Object.freeze({
  spark: "ldvh_spark_list",
  devlog: "ldvh_devlog_list",
});

/**
 * **通用词**：在本语料里高频出现、本身不锁定主题的词（「任何」「规范」「执行」
 * 「测试」「写」「改」…）。它们**不该单独构成命中依据**，但在真正的主题查询里
 * 是必需的组成部分，故不丢、只降级。
 *
 * 实测依据（2026-10-24，40 条真实 friction 现象陈述 × 3 条结果 = 92 条命中）：
 * 其中 **14 条（15%）只靠通用词命中**，例如「install() 分发器…」靠「任何/执行」
 * 命中了「无关未提交改动阻塞变基致推送延迟」——几乎肯定不相关。
 *
 * 与 `FUNCTION_CHARS` 的区别：那个是**虚字**（的/了/是），连词都不算；
 * 这个是有实义的**高频实词**，只是不足以单独支撑「相关」这个判断。
 */
const GENERIC_TOKENS = new Set([
  "任何", "规范", "写作", "执行", "测试", "验证", "校验", "检查", "工单", "复核", "审核",
  "独立", "写", "改", "回", "做", "用", "说", "看", "有", "无", "时停", "停止",
  "事实", "系统", "机制", "业务", "流程", "结果", "问题", "情况", "内容", "部分",
]);

/**
 * 实义单字动作。**不是虚字**，但常与虚字组成短语（「改一下」「删了」「加个」），
 * 在「含虚字的二元组一律丢弃」的过滤下会被一并吞掉，导致整句话切不出 token。
 *
 * 只收**动作本身**，不收「弄/搞/调/换」这类语义宽泛的单字——那些把噪声请回来。
 *
 * **2026-10-24 回归修正**：初版还收了「成」「回」「立」「新」「开」「生」「设」「升」
 * 「存」「保」「清」「覆」「替」「启」「停」等字，它们**出现在几乎任何句子里**：
 * 「改名**成**双源召回」切出单字「成」，「已经完**成**」切出「成」，「**回**到上一节」
 * 切出「回」。结果查询「把 34 号规范改名成双源召回」时，00 号规范靠 scope 里的
 * 「构**成**」命中，命中理由显示「适用范围命中：成」——单字噪声把假相关送了回来。
 * 单字兜底的**唯一目的**是救「改一下／删了／加个」这类**动词开头**的短指令，
 * 故只收「动作者自己」：改、删、增、建、写、读、查、提、跑、测、审、批、配、装、
 * 卸、修、重、构、部、署、发、布、回（滚）、合（并）、推、拉、取、移、转、拆、分。
 * 注意「回」「合」「推」「拉」这些只在**明确的动作短语**里有意义，故仍保留，
 * 但它们已是真正的动作字，且不再有「成」「新」「开」这类泛字。
 */
const ACTION_CHARS = new Set("改删增建加写读查提跑测审批配装卸修重构部署发布回滚合并推拉取移转拆分");

const FUNCTION_CHARS = new Set(
  "的了是在和与或一个这对就也都是而把被让从到向但并且还又会能要可以不没无这那什么你我他她它们所因如果现之其等该者",
);

/**
 * 把一段文本切成可匹配的 token。
 *
 * - ASCII 词：按非字母数字切，小写化，长度 ≥ 2；
 * - 中文：逐字 + 相邻二元组（bigram）。「预检落实」→ 预检、检落、落实，
 *   使「预检落实记录」与「预检」也能命中——这是零依赖下对中文最有效的做法，
 *   也是 `0b3471af` F3 所指的 tokenize 路线。
 * - 数字与编号（§10.4、03、27）保留，便于按章节号命中。
 *
 * 短于 2 字的中文单字不单独成 token，避免「的」「了」这类噪声。
 */
export function tokenize(text) {
  if (typeof text !== "string" || text === "") return [];
  const tokens = new Set();
  // ASCII 词与数字/编号
  for (const m of text.toLowerCase().matchAll(/[a-z0-9][a-z0-9._-]*/g)) {
    if (m[0].length >= 2) tokens.add(m[0]);
  }
  // 中文取**二元组**（bigram），单字仅在无二元组时兜底。
  //
  // 实测教训一：单字参与匹配时「的/一/本/是」命中一切。
  // 实测教训二：二元组里仍有纯虚字组合（「一个」「可能」「可以」）与跨词噪声
  // （「建一」「板的」「的取」）命中一切。
  //
  // **2026-10-27 修正（本函数最大的漏检来源）**：原实现「二元组含虚字就整组丢弃」，
  // 把**跨越虚字的实词对**也一并扔了。实测 12 条真实查询里 4 条一个 token 都切不出
  // （「是不是应该」「现在应该做什么」「我要的是这个」「为什么会这样」→ 召回直接
  // 返回 `recall/no_tokens`）；同口径对照 dsh-auto-memory 的 CJK 2-gram 是 0/12。
  // 差别不在算法范式，而在这里：它**不丢 gram**，只把虚字词在**打分时**降权。
  //
  // 现行规则：
  //   1. **纯虚字二元组**（两端都是虚字，如「一个」「的是」）仍不进——它确实命中一切；
  //   2. 两端都是实词的二元组（「白屏」「校验」）= **强证据**；
  //   3. 含**且仅含一个**虚字的二元组（「为什」「里不」「条校」）= **弱证据**：
  //      仍进集（否则实词会被成片吞掉），但**不得单独构成命中**——它跨词，
  //      实测「为什么这里不对」只靠这层就命中了一条与题意无关的 research。
  //      弱证据的降权不是新机制：`weakHit` 档位已按「是否只有通用词/单字」分档，
  //      此处把「一端为虚字」并入同一档（详见 matchCandidate 的 specific 判定）。
  //   4. 单字仍不参与（虚字单字更不参与）——理由同教训一。
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjk) {
    for (let i = 0; i + 1 < run.length; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (FUNCTION_CHARS.has(bigram[0]) && FUNCTION_CHARS.has(bigram[1])) continue;
      tokens.add(bigram);
    }
    // 长度为 1 的 run 取不到二元组，此时单字才有区分度，才单独成 token；
    // 但虚字单字（的/了/是…）仍不进——它只制造噪声（实测曾让「的」进命中理由）。
    if (run.length === 1 && !FUNCTION_CHARS.has(run)) tokens.add(run);
    // **实义动词单字兜底**：「改一下」「删了」「加个」这类短语，二元组因含虚字
    // 全被丢弃后一个 token 都不剩（实测 15 个常用动词短语里 11 个切空），
    // 召回直接 no_tokens。这类单字是**动作本身**，不是虚字，必须留住。
    // 只从写动作清单里取（不是任意单字），避免把噪声请回来。
    for (const ch of run) {
      if (ACTION_CHARS.has(ch)) tokens.add(ch);
    }
  }
  return [...tokens];
}

/**
 * 一个 token 是否是**弱证据**：含虚字的二元组（「为什」「里不」「条校」）。
 *
 * 与 `weakHit` 的关系：二者是同一降权轴的两段，不是两套机制。`weakHit` 管的是
 * 「命中的是什么档」（单字 / 通用词），本函数管的是「这个词本身跨不跨词」。
 * 二者统一在 `matchCandidate` 里合成：**只要命中的全是弱证据，就不算强命中**。
 *
 * 为什么需要它（2026-10-27 实测）：把「含虚字即整组丢弃」放宽为「两端皆虚才丢」后，
 * 「为什么这里不对」切出「为什／这里／里不」三条跨词噪声，于是**本该如实报
 * no_tokens 的无主题句被注入了**，还命中一条与题意无关的 research。放宽是必要的
 * （否则实词成片被吞），但必须同时把这类词降为弱证据，否则精度会倒退。
 *
 * 参数是**已经小写化的 token**：ASCII 词恒为强证据（虚字表只含中文）。
 */
export function isWeakToken(token) {
  if (typeof token !== "string" || token.length !== 2) return false;
  if (!/[\u4e00-\u9fff]/.test(token)) return false;
  return FUNCTION_CHARS.has(token[0]) !== FUNCTION_CHARS.has(token[1]);
}

// ---------------------------------------------------------------------------
// 语料 token 缓存（2026-10-31 加）
// ---------------------------------------------------------------------------

/**
 * **语料的 token 化结果缓存**（进程内，2026-10-31 加）。
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * 实测（本仓，2026-10-31）：`recallForAction` 单次调用 **760ms**，其中
 * `tokenize` 占 CPU **44%**、`docFreqOf` 7.4%、`corpusStatsOf` 5.8%。
 * 根因是**同一份语料被反复重算**：
 *   · `loadFacts`/`loadSpecs` 每次调用都重读盘 + 重解析 YAML（274 文件 = 78ms
 *     读 + 155ms 解析）；
 *   · `corpusStatsOf` 与 `docFreqOf` 各自对**每份**候选调一次 `tokenize`；
 *   · `matchCandidate` 内部又对 4 个 section 各调一次 `tokenize`。
 * 即同一份正文一次召回里被切了 **6 遍**，而语料在两次召回之间并不变。
 *
 * 测试侧的代价直接可见：`test/source-recall.test.mjs` 单文件 **87s**、
 * `test/recall-injection.test.mjs` **62s**，二者合计占全量套件（117s）的大半，
 * 而它们只是在反复算同一份语料的 token。
 *
 * ── 缓存的是什么 ─────────────────────────────────────────────────────
 * **只缓存「派生计算」，不缓存「权威内容」**：
 *   · 缓存内容：分词结果、文档频率表、BM25 语料统计。
 *   · **不缓存**：语料正文本身（`text`/`body`/`fullText`）——它每次都从盘上重读。
 * 故本缓存**不建立任何持久索引**（`34 §17` 第 1 项、`02 §16` 第 3 项禁的是
 * 持久搜索索引；本缓存是进程内、随进程消亡、不落盘、不跨会话复用）。
 *
 * ── 失效判据：内容哈希，不是 mtime ─────────────────────────────────────
 * 键 = **语料全部载体内容的 SHA-256**。任一载体被改（增/删/改）即换键。
 * 用内容哈希而非 mtime/size 的理由与 `git-gate-runner.js` 的 lint 缓存同源：
 * mtime 在 checkout 与并行写入下不可靠，而本缓存一旦陈旧就会给出**过期的召回
 * 结果**——那比慢更糟。
 *
 * 代价：每次召回须读一遍全部载体算哈希。实测 306 个文件**并行读 18ms +
 * 哈希 10ms = 28ms**，相对 760ms 可忽略。
 *
 * ── 安全边界 ─────────────────────────────────────────────────────────
 * 1. **只缓存派生值**，权威内容每次重读（见上）。
 * 2. **缓存对象不得被调用方改写**：本模块产出的候选对象全程只读（已核：
 *    `lib/` 内无任何一处改写候选字段；各 writer 改写的是它们自己的
 *    frontmatter 对象，不是本模块的产物）。
 * 3. **按目录路径分键**：不同项目、不同语料来源（`01 §10.3` 三级回退）各有
 *    自己的键，不会互相串用。
 * 4. **不可用即重算**：任何一步失败（读不到、哈希失败、目录消失）都退回
 *    「本次现算」——fail-closed 的方向是「多算一次」，不是「跳过」。
 */

/**
 * 一个候选的**分词结果**（按 section 切分）。
 *
 * 形状：`{ scope, detail, title, body, narrow, wide }`
 *   · `scope`/`detail`/`title`/`body`——各 section 的 token 数组；
 *   · `narrow`——窄面（scope+detail+title）的 token **Set**；
 *   · `wide`——全匹配面（scope+detail+title+body）的 token **Set**。
 *
 * **为什么窄面/宽面可由各 section 的 token 求并**：`tokenize` 是
 * **段内**的——它按「连续中文 run」取二元组，不跨段拼接处产生二元组。
 * 实测（2026-10-31，全语料 602 组对照）`tokenize(A+"\n"+B)` 与
 * `tokenize(A) ∪ tokenize(B)` **零差异**，故段内 token 之并即拼接串的 token。
 * 该等价性由 `test/source-recall.test.mjs` 的「tokenize 段内性」用例守住。
 */
const TOKEN_CACHE = new WeakMap();

/**
 * 取一个候选的分词结果，必要时计算并记住。
 *
 * 用 WeakMap 挂在**候选对象**上而非用「路径 → token」的全局表：候选对象
 * 本身每次召回都重新构造（正文每次重读），故 WeakMap 不会跨召回命中——
 * **这只省掉同一次召回内部的重复切词，不跨召回复用**。
 *
 * 跨召回的复用由下面的 `CORPUS_CACHE` 承担（它缓存的是**语料级的 df/BM25
 * 统计**，以及语料级的 token 汇总）。
 */
export function tokenSetOf(candidate) {
  let entry = TOKEN_CACHE.get(candidate);
  if (entry !== undefined) return entry;
  const scope = typeof candidate.scope === "string" ? candidate.scope : "";
  const detail = typeof candidate.detail === "string" ? candidate.detail : "";
  const title = typeof candidate.title === "string" ? candidate.title : "";
  const bodyText = candidate.bodyText ?? candidate.body;
  const body = typeof bodyText === "string" ? bodyText : "";
  const scopeTokens = tokenize(scope);
  const detailTokens = tokenize(detail);
  const titleTokens = tokenize(title);
  const bodyTokens = tokenize(body);
  const narrow = new Set([...scopeTokens, ...detailTokens, ...titleTokens]);
  const wide = new Set([...narrow, ...bodyTokens]);
  entry = {
    scope: scopeTokens,
    detail: detailTokens,
    title: titleTokens,
    body: bodyTokens,
    narrow,
    wide,
    // **各 section 的 Set 形态**：`intersect` 要的是「查表」而非「数组扫描」，
    // 而正文 section 的 token 动辄数千个——每次重建 Set 是可观的开销
    // （实测 intersect 占优化后 CPU 的 9.1%）。
    scopeSet: new Set(scopeTokens),
    detailSet: new Set(detailTokens),
    titleSet: new Set(titleTokens),
    bodySet: new Set(bodyTokens),
  };
  TOKEN_CACHE.set(candidate, entry);
  return entry;
}

/**
 * 语料的**内容指纹**：全部载体内容的 SHA-256。
 *
 * 取**内容**而非 mtime/size：见本节开头的说明。任一载体增删改即换键。
 * 读取失败即抛——上层据此退回「现算」。
 */
async function corpusFingerprintOf(files) {
  const hash = createHash("sha256");
  // 排序后哈希：保证键与 readdir 的返回顺序无关（同一份语料恒得同一键）。
  const sorted = [...files].sort();
  for (const file of sorted) {
    const content = await readFile(file);
    hash.update(`${file}\0`);
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * **已解析语料的缓存**：`<dir> → <fingerprint> → 解析结果`。
 *
 * 键含**内容指纹**，故语料一改即自动换键，不存在陈旧读。
 * 命中的收益：不重做 YAML 解析（实测 274 个事实文件解析 155ms）。
 *
 * **为什么可以共享解析结果对象**：本模块产出的候选对象全程只读——已核
 * `lib/` 内无任何一处改写候选字段（各 writer 改写的是它们各自的
 * frontmatter 对象，不是本模块的产物）；测试侧亦无改写。
 * 故共享对象不会带来跨调用污染。
 */
const PARSED_CORPUS_CACHE = new Map();

/**
 * 读一个语料目录的全部 `.md` 文件，返回 `[{ dir, name, text }]`。
 *
 * `dir` 是**相对语料根的子目录路径**（顶层文件为 `""`），`name` 是文件名。
 * 事实源用它取类型目录名（`adrs`/`frictions`/…），规范源不用（`dir` 恒为 `""`）。
 *
 * **并行读**：实测 274 个文件串行读 78ms、并行读 18ms。
 */
async function readCorpusFiles(dir, { recursive, skipTopLevelFiles }) {
  const out = [];
  const walk = async (current, rel) => {
    const entries = await readdirOrEmpty(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!recursive) continue;
        await walk(full, rel === "" ? entry.name : `${rel}/${entry.name}`);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      // **顶层文件不属于「按类型子目录组织」的语料**（事实源的 `goal.md` 是
      // Goal 单例载体，不是某一事实类型的对象）。原实现只扫子目录，故顶层
      // 文件从不进入语料——这里显式保持该边界，否则会凭空多出一条「类型名为
      // 空」的伪候选（实测多出 1 条：274 → 275）。
      if (rel === "" && skipTopLevelFiles) continue;
      out.push({ dir: rel, name: entry.name, path: full });
    }
  };
  await walk(dir, "");
  // **排序口径**：先按子目录、再按文件名——与原实现（先排目录、再排目录内文件）
  // 完全一致，故载入顺序与既有行为逐字相同。
  out.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const texts = await Promise.all(out.map((entry) => readFile(entry.path, "utf8")));
  return out.map((entry, index) => ({ ...entry, text: texts[index] }));
}

/**
 * 取一个语料目录的解析结果，必要时解析并缓存。
 *
 * @param {string} dir 语料目录
 * @param {boolean} recursive 是否递归子目录（事实源为 true，规范源为 false）
 * @param {(files: Array<{path: string, name: string, text: string}>) => any} parse 解析器
 * @param {{skipTopLevelFiles?: boolean, cacheSalt?: string}} [options] 缓存盐进键
 * @returns {Promise<any>} 解析结果（同一份语料恒得同一对象）
 */
async function cachedCorpus(dir, recursive, parse, { skipTopLevelFiles = false, cacheSalt = "" } = {}) {
  const files = await readCorpusFiles(dir, { recursive, skipTopLevelFiles });
  if (files.length === 0) return parse(files);
  let fingerprint;
  try {
    fingerprint = await corpusFingerprintOf(files.map((entry) => entry.path));
  } catch {
    // **读不到即现算**：fail-closed 的方向是「多算一次」，不是「跳过」。
    return parse(files);
  }
  // **缓存盐**（2026-10-31）：事实源的解析结果现在依赖 `specs/` 的判据表
  // （`detail` 只由「核心语义字段」构成，02 §12.4）。只用事实源指纹做键时，
  // 改判据表不会让事实缓存失效，`detail` 会永久停在旧字段集上——那是「规范
  // 改了、代码看着也对、行为却没变」的静默漂移。故把判据表指纹并入键。
  const cacheKey = `${fingerprint}\u0000${cacheSalt}`;
  const byFingerprint = PARSED_CORPUS_CACHE.get(dir);
  if (byFingerprint !== undefined && byFingerprint.get(cacheKey) !== undefined) {
    return byFingerprint.get(cacheKey);
  }
  const parsed = parse(files);
  if (byFingerprint === undefined) {
    PARSED_CORPUS_CACHE.set(dir, new Map([[cacheKey, parsed]]));
  } else {
    byFingerprint.set(cacheKey, parsed);
    // 只留当次指纹一份：陈旧版本留着既占内存，又可能在下次误用。
    // （指纹进键，命中仍须完全一致，故保留旧版也不会读到陈旧内容——
    //   这里只是不让 Map 无限增长。）
    if (byFingerprint.size > 4) {
      const oldest = byFingerprint.keys().next().value;
      if (oldest !== cacheKey) byFingerprint.delete(oldest);
    }
  }
  return parsed;
}

/**
 * 两个 token 集的交集大小（不打分做排序，只用于「是否有交集」与命中理由）。
 *
 * **`b` 已是 Set 时不复制**——它可能是数千 token 的正文集，复制一次的成本
 * 与匹配本身同阶（实测 intersect 曾占优化后 CPU 的 9.1%）。
 * 语义不变：`intersect` 只取交集**成员**，不关心 `b` 的顺序。
 */
function intersect(a, b) {
  const set = b instanceof Set ? b : new Set(b);
  return a.filter((t) => set.has(t));
}

// ---------------------------------------------------------------------------
// 载入
// ---------------------------------------------------------------------------

/**
 * `readdir` 的容错版：目录不存在时返回空数组。
 *
 * **为什么**：`loadSpecs`/`loadFacts` 面对的是「受辖项目」，而受辖不等于必有语料——
 * 新建项目、语料尚未建立、或只建了一半（有 `specs/` 无 `ldvh-base/`）都是
 * 正常状态。`02 §9.2` 也没有「没有语料即错误」这种规定。故这里把「目录不存在」
 * 与「目录为空」同等对待：都是「没有候选」，由调用方如实报告零命中，
 * 而不是每回合抛一次 ENOENT 让上层去 catch。
 */
async function readdirOrEmpty(dir, options) {
  try {
    return await readdir(dir, options);
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * 目录是否**存在且可读**（区别于「存在但为空」）。
 *
 * **为什么需要它**（2026-10-25 第五次审核 M-21）：`recallCompleteness` 的三态判定
 * 须按 34 §12 区分「源不可读」与「源可读但零对象」——前者使「未命中」失去证据
 * 资格（unavailable/partial），后者是诚实的零命中（complete 可成立，§6 的零命中
 * 退出路径正为此设）。旧判定用 `specs.length + facts.length === 0` 近似「不可读」，
 * 把两种情形混为一谈：规范源三级回退全失败但事实源有对象时报 `complete`（危险），
 * 两源可读但为空（新建项目）时报 `unavailable`（挡死了合法的零命中路径）。
 */
async function isReadableDir(dir) {
  try {
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 旧的**行式** frontmatter 解析器（保留：规范源仍用它）。
 *
 * ── 为什么不整体替换它（2026-10-29）──────────────────────────────────
 *
 * 它有三个已实测的缺陷，全部来自「把 YAML 当 key: value 逐行读」：
 *
 * 1. **块标量被读成字面量**：`summary: |` 之下多行正文被压成字符串 `"|"` 或 `"|-"`。
 *    全库 46 条对象的 summary 因此对召回**完全不可见**（真实内容平均 1099 字），
 *    候选卡上的「有界确定性摘录」也一度显示成 `↳ |-`。同理 24 条 WorkCase 的
 *    `scope` 变成 `"|-"`，使其**整个 tier 1（适用范围层）不可命中**。
 * 2. **嵌套结构被压平**：`relations: [{relation_key, target:{object_uid}}]` 读成
 *    `"relation_key: informs"`（target 整段丢失）；`occurrence` 读成空串；
 *    `plan` 的步骤键值互相粘连。49 条带关系的对象因此对召回零贡献。
 * 3. **多行值被空格拼接**：`key:\n  - a\n  - b` → `"a b"`，行边界消失，
 *    无法再分辨「是一个值还是两个值」。
 *
 * 但**规范源不能换**（见 `loadSpecs`）：它的 frontmatter 是嵌套在 `ldvh_spec:`
 * 下的，本函数靠「取第一层 key + 再按缩进抓一次」两段式取到所需字段，且规则
 * 文本本身没有依赖块标量与嵌套数组。换成 YAML 会改变 `pick()` 的行为面，
 * 而规范源侧的漂移由 `recall-spec-drift.test.mjs` 守护——不在本次改动范围内。
 *
 * 故：**事实源走 YAML（`parseObjectFrontmatter`），规范源保持本函数**。
 * 这不是「两套并存」的债，而是两块语料的形状不同：事实源有闭集 schema 与嵌套
 * 结构，规范源只有扁平的 `ldvh_spec` 块。
 */
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (m === null) return {};
  const out = {};
  let cur = null;
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
    if (kv !== null) { cur = kv[1]; out[cur] = kv[2].trim(); continue; }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item !== null && cur !== null) {
      out[cur] = `${typeof out[cur] === "string" ? out[cur] : ""} ${item[1].trim()}`.trim();
    }
  }
  return out;
}

/**
 * 事实对象的**结构化** frontmatter 解析（YAML，`02 §7` 的公共身份字段 +
 * 20–27 各类型的闭集字段）。
 *
 * ── 为什么必须结构化（2026-10-29 实测，见 `parseFrontmatter` 注释）────────
 *
 * 事实源的字段不是「一段文本」，而是**分类承载**：`priority` 是闭集 `P0–P3`（20 §8），
 * `serves` 是 SG-n 锚点（20 §6 / 21 §8），`direction_key` 是方向键（27 §8），
 * `relations` 是 `{relation_key, target:{object_uid}}` 的边（03 §7.2），
 * `occurrence` 是 `{count, first_at, last_at}`（26 §8）。这些**只有解析成结构
 * 才能被判断**——读成字符串后，「heavy 的未决摩擦」与「正文里恰好出现 heavy」
 * 无法区分，而这正是本模块此前对结构维度完全失明的机制来源。
 *
 * ── 依赖与失败姿态 ─────────────────────────────────────────────────
 *
 * `yaml`（^2.8.1）**已是本插件的直接依赖**（`plugin/package.json`，writer 侧
 * `adr-writer` / `friction-writer` / `goal-writer` 早已在用 `parseYaml`），
 * 故此处不引入新依赖、不引入第二规则源。
 *
 * 解析失败**不抛出、不静默**：退回旧的行式解析器并如实置 `__yamlError`，
 * 使调用方能披露「该对象的字段未被结构化读取」。理由：一个载体格式损坏
 * 不应让整个召回不可用（那会使「零命中」冒充「无相关」，`34 §12` 最危险
 * 的误读）；但也不能假装读到了（`02 §9.2` 不得把零结果当无约束）。
 *
 * @param {string} text 载体全文
 * @returns {{data: object, yamlError: string|null}} `data` 恒为对象
 */
function parseObjectFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (m === null) return { data: {}, yamlError: null };
  let data;
  try {
    data = parseYaml(m[1]);
  } catch (error) {
    return {
      data: parseFrontmatter(text),
      yamlError: error instanceof Error ? error.message : String(error),
    };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    // 合法 YAML 但形状不是映射（如整块是一个数组或标量）——按失败处理，
    // 不把它当空对象，否则「读不出」会伪装成「没有字段」。
    return {
      data: parseFrontmatter(text),
      yamlError: `frontmatter 不是映射（得到 ${Array.isArray(data) ? "array" : typeof data}）`,
    };
  }
  return { data, yamlError: null };
}

/**
 * 取一个可能为多行的**文本字段**的字符串值。
 *
 * 为什么要这个 helper 而不是 `String(x ?? "")`：
 *   · 旧行式解析器给出的可能是 `"|"` / `"|-"` 字面量（块标量未被解析）——
 *     那是**解析残留**，不是内容，绝不能进匹配面或候选卡摘录；
 *   · YAML 已解析时给的是真实多行字符串。
 * 两者都要归一成一个可匹配、可摘录的串，且**块标量残留一律视为无内容**。
 */
function textField(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (/^[|>][-+0-9]*$/.test(trimmed)) return "";
  return trimmed;
}

/**
 * 状态的**准入等级**：数字越小越优先。用于排序，防止「未准入的草稿」仅因更新
 * 而压掉「已准入的权威对象」。
 *
 * 背景（2026-10-27 实测）：加入「最后更新时间」作次级键后，调用方一旦放宽
 * `statuses`（如复核草稿时传 `["active","draft"]`），新写的 draft 会凭时间
 * 新鲜排到 active 之前——实测「校验验证」查询变成清一色草稿，权威的 active
 * 全部被挤出。**新 ≠ 更权威**，故状态等级须先于时间比较。（2026-11-03 起
 * Pitfall 已无 `draft`；`draft` 仍是 WorkCase 的初始态，本分级照旧适用。）
 *
 * 分级依据：`active`／`open` 是各类型规范定义的「当前生效」态（见
 * `DEFAULT_STATUSES_BY_TYPE`）；`draft`／`pending` 是**尚未准入**（2026-11-03 起
 * Pitfall 不再产生 `draft`，该档现只由 WorkCase 等类型使用）；其余
 * （retired／resolved／voided／discarded／implemented）是终态或已退出。
 */
export function statusRank(status) {
  if (status === "active" || status === "open") return 0;
  if (status === "draft" || status === "pending") return 1;
  return 2;
}

/**
 * 事实候选的**排序比较器**（纯函数，导出供单测）。
 *
 * 输入是 `{fact, index}` 包裹体（`fact` 为候选卡，`index` 为 collect 的产出序）。
 * 抽出为独立函数的原因：**原先是内联箭头函数，无法单测**。而内联导致了一个
 * 真实的 NaN bug（见下）只能靠「某条查询恰好错序」偶然发现——把它变纯函数后，
 * 可以用合成样本直接验证每一层键。
 *
 * ── 排序键（自上而下，全序、确定性）──────────────────────────────────
 *
 * 1. `weakHit`——强命中先于弱命中（证据更厚的先看）。
 * 2. `tier`——命中落在哪个字段（编号 > 适用范围 > 内容 > 标题 > 正文）。
 * 3. `hits`——跨层命中的 idf 加权厚度（降序）。**是权重，只用于排序，不做裁决**。
 * 4. `statusRank`——已准入（active/open）先于未准入（draft/pending），
 *    防「新草稿凭新鲜压掉权威对象」。
 * 5. `updatedAt`——同分时较新的先看（Human 裁定；实测多为惰性键，见下）。
 * 6. `path`——仅为稳定输出。
 *
 * **没有类型轴**（2026-10-31 Human 裁定删除 `typeRank` 族）：证据相同即同序，
 * 类型不参与比较。
 *
 * ── 一个必须记住的教训（2026-10-27）────────────────────────────────
 * 上一版此处误写成 `a.weakHit`／`a.tier`／`a.hits`（元素其实是 `{fact, index}`），
 * 三者都是 `undefined` → `undefined - undefined = NaN` → 而 `NaN !== 0` 为真
 * → 比较器**恒返回 NaN**。V8 对返回 NaN 的比较器不保证任何次序，排序退化为
 * 实现相关的乱序（实测「写一个 ADR」时 spark 排到 adr 前，两者证据完全相同）。
 * 这类 bug 不抛错、既有测试还偶然通过。故本函数**保证任何合法输入都返回有限数**。
 *
 * @param {{fact: object, index: number}} a
 * @param {{fact: object, index: number}} b
 * @returns {number} 负数 / 0 / 正数
 */
export function compareFactHits(a, b) {
  const fa = a?.fact ?? {};
  const fb = b?.fact ?? {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  // ── 排序键（自上而下）────────────────────────────────────────────────
  //
  // 1. `weakHit`——强命中先于弱命中。**仍是第一键**：弱命中（只靠单字/通用词）
  //    即便类型等级最高也不该抢名额。实测反例见 `RECALL_TYPE_TIERS` 的注释
  //    （6 条 ADR 靠「回」字压掉真正相关的 Pitfall）。
  // 2. `tier`——命中落在哪个字段（编号 > 适用范围 > 内容 > 标题 > 正文）。
  // 3. `hits`——跨层命中的 idf 加权厚度（降序）。只用于排序，不做裁决。
  // 4. `statusRank`——已准入先于未准入。
  // 5. `updatedAt`——同分时较新的先看。
  // 6. `path`——仅为稳定输出。
  //
  // ── 「必需类型优先」不再是排序键（2026-10-31 Human 裁定）─────────────
  //
  // 本函数曾以 `typeRank`（ADR > Norm > Pitfall > Friction > 其它）作末位键，
  // 并在此处记有一条死代码教训。Human 已裁定删除该族常量（理由见文件头
  // `RECALL_TYPE_TIERS` 删除处的注释）：类型不是证据，**证据相同时不再有类型轴**。
  // `REQUIRED_RECALL_TYPES` 仍是声明性常量，但**无排序消费点**——`22 §12` 的
  // 义务召回由「默认候选状态集 + 不被过滤」与 `matchCandidate` 的类型点名层承担。
  //
  // 曾经另一个候选实现是 `rank = (f) => REQUIRED_RECALL_TYPES.includes(f.type) ? 0 : 1`；
  // 它当年就已证明是死代码，删除 `typeRank` 后**不得**把它捡回来充当替代——
  // 那只是把同一条类型轴换个名字。
  const byEvidence = Number(fa.weakHit === true) - Number(fb.weakHit === true);
  if (byEvidence !== 0) return byEvidence;
  const evidence =
    num(fa.tier) - num(fb.tier) ||
    num(fb.hits) - num(fa.hits);
  if (evidence !== 0) return evidence;
  return (
    statusRank(fa.status) - statusRank(fb.status) ||
    String(fb.updatedAt ?? "").localeCompare(String(fa.updatedAt ?? "")) ||
    String(fa.path ?? "").localeCompare(String(fb.path ?? "")) ||
    num(a?.index) - num(b?.index)
  );
}

/** ISO-8601 秒级带毫秒的时间戳（本仓事实源 frontmatter 的固定形态）。 */
const ISO_TS = /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z/g;

/**
 * 取对象的**最后更新时间**（= `created_at` 与 `change_log[].at` 的最大值）。
 *
 * 用途：作为排序的**次级键**（匹配程度相同时才比），见 `recallForAction` 的
 * 排序键说明。
 *
 * **为什么不用文件 mtime**：mtime 随克隆、检出、备份、`git checkout` 而变，
 * 同一份语料在不同机器/不同时刻会给出不同排序，违反 `02 §9` 的「同输入同输出」。
 * 存在 frontmatter 里的时间戳是**语料自身的内容**，跨环境稳定、可复算。
 *
 * **为什么不用 `parseFrontmatter` 的结构化值**：该解析器把 `key:\n  - item`
 * 压成**空格连接的字符串**（见其实现），`change_log` 因此是一行长文本。
 * 故此处用正则从中提取全部 ISO 时间戳再取最大——不改解析器（它被规范源
 * 侧共用，改动面大），也不影响既有字段。
 *
 * @param {Record<string,string>} fm 解析后的 frontmatter
 * @returns {string} ISO 时间戳；取不到时返回空串（空串在排序中排在最后）
 */
export function updatedAtOf(fm) {
  if (fm === null || typeof fm !== "object") return "";
  const stamps = [];
  const created = typeof fm.created_at === "string" ? fm.created_at.trim() : "";
  if (ISO_TS.test(created)) stamps.push(created);
  ISO_TS.lastIndex = 0;
  const log = typeof fm.change_log === "string" ? fm.change_log : "";
  for (const m of log.matchAll(ISO_TS)) stamps.push(m[0]);
  // 同一格式的 ISO 字符串可直接字典序比较（长度固定、时区统一为 Z）。
  stamps.sort();
  return stamps.length === 0 ? "" : stamps[stamps.length - 1];
}

/**
 * 载入规范源 `specs/`。
 *
 * 规范源的 frontmatter 是嵌套在 `ldvh_spec:` 下的，本函数把它拍平取所需字段：
 * `spec_key` / `spec_id` / `title` / `positioning` / `scope` / `basis`。
 * 另取正文标题行，使章节标题也可参与匹配（如「预检落实记录」）。
 *
 * **现读现解析**，不建持久索引（34 §17 第 1 项）。
 */
/**
 * **有界确定性摘录**（`02 §9.1` F2 要求「有界确定性摘录」）。
 *
 * 「有界」：硬截断到 EXCERPT_MAX_CHARS，不因内容而异。
 * 「确定性」：只做**截断与空白折叠**，不摘要、不改写、不选句——同一输入必得同一
 * 输出，故可复算、可核对（`02 §9` 禁止用 AI 输出裁决内容；摘要是改写，此处不做）。
 *
 * 为什么需要它：F2 的用途是「筛选少量候选并**选择 F3**」。只给 title + path，
 * 读者无法筛选，只能逐个打开全文——F2 就失去了分层意义。
 */
const EXCERPT_MAX_CHARS = 120;

/**
 * 通用召回接口（`recallForAction`）的默认字节预算。
 *
 * **与注入路径的兜底常量 `RECALL_BYTE_BUDGET`（2400）是两个不同的常量**——本接口面向
 * CLI／诊断脚本等直接调用方，候选预算较宽；注入路径受引导面**档位**约束
 * （`INJECTION_BUDGET_TIERS`，生产默认档 10240 字节），须更紧。
 * 两者**故意不同**，不可互相代入（历史上测试曾把二者当同一个数而断言失败）。
 *
 * 之所以具名：34 §11 要求「上限须以具名常量承载，不得是运行期猜测」。字面量
 * `4000` 散落在调用处时，既无法从一处追溯预算是多少，改预算时也看不出改了哪一处。
 * **变更走受控提交**（`10 §5.3`「体量以固定常量承载，变更走受控提交」）；
 * 提高该上限须 Human 决定（34 §15.1 第 5 项）。
 */
export const RECALL_DIRECT_BYTE_BUDGET = 4000;

/**
 * **渲染固定开销的字节估算**（`10:241` 预算核对用）。
 *
 * 覆盖：标题行 + 候选声明行 + 能力边界行 + 分段标题（「规范源：」「事实源：」）。
 * 实测约 445 字节（37+172+236），取 720 留余量。
 *
 * **为何放在本文件**：`recall-injection.js` 从本模块 import（依赖方向如此），
 * 故共享常量必须定义在下层。第十次审核 Minor：此前两个文件各写一份字面量
 * （720 / 180 / 1200 / 3 共 4 处），极易左右漂移——现统一从此处取。
 */
export const RENDER_FIXED_OVERHEAD_BYTES = 720;

/**
 * **基线段让位阈值**（字节）：总预算低于此值时，渲染层不输出基线段、本模块也不预留。
 *
 * 依据：固定开销（720）+ 三态/截断披露行（约 300）已接近该值，再输出基线必顶破
 * 预算（实测 800 下任何基线形态都超：单行 898、并入披露行 870）。
 */
export const BASELINE_YIELD_BELOW_BYTES = 1200;

/**
 * **基线段可占注入预算的比例分母**（3 = 最多占 1/3）。
 *
 * 基线是义务披露，但不得吃掉候选区全部份额——ADR 增长时宁可截断基线
 * （并如实披露）也要留住词法候选。
 */
export const BASELINE_BUDGET_SHARE_DIVISOR = 3;

/**
 * ── **L0 常驻枚举**（Human 决定 2026-11-04；2026-11-11 重订为两类 + 经验按需）──
 *
 * Human 的原话是「排序就是 ADR、事实规范、经验，这三个的 L0 是必须注入的，
 * 其他根据预算安排」。故注入面常驻的是**三类事实对象的 L0 标识**，按
 * ADR → 事实规范（Norm）→ 经验（Pitfall）的次序分配，其余事实类型仍走词法候选。
 *
 * **为什么不覆盖元规范**（同日订正）：此前一段实现把 `specs/`（元规范）的标题
 * 全量常驻，理由是「词法匹配对规范侧 0/29」。那是**另一件事**：元规范已有既有的
 * 载体发现与读取通道（`01 §10` 的 L0–L4 读取、`ldvh_read_specification_candidates`），
 * 引导面亦已按 `01 §10.4` 注入规范锚点。在注入面再复制一份元规范标题清单，是
 * 在既有通道之外发一份可能漂移的第二索引，且不属 Human 所指的「事实规范」。
 * 故本组常量只覆盖事实源侧的三类对象，元规范目录整段撤除。
 *
 * **为什么必须是全量而不是词法候选**（`pitfall-8b3c5705` 同型结论）：依赖词法
 * 匹配的面不能保证某个已知对象进入注入位——换个说法就漏。而这三类对象是
 * 「AI 行动前必须核对」的东西：ADR 属法定效力决定（`22 §1`／`22 §12` 义务召回）、
 * 事实规范界定项目自身要求（`27 §10` 义务召回）、经验是不得重蹈的已知陷阱
 * （`23 §12` 的遵守预检消费点）。三者的可见性若取决于当回合用词，义务召回就悬空。
 *
 * **本段是索引，不是候选**（`01.Att.03 §4`：L0 的直接用途是「发现、去重与精确
 * 定位」，「不能单独证明」列含「与当前事项相关、规则适用」）。故：
 *   · 不带命中理由（它不是被匹配出来的）；
 *   · 不占 `limit` 名额（它不是「本次可能相关的 N 条」之一）；
 *   · 段头逐字写明类型与 active 口径，段尾声明「不证明适用」；
 *   · 与候选行使用不同的行首（`·` 而非 `- `），结构上就进不了候选裁剪池。
 *
 * **字段只到 L0 为止**：ADR 带状态（`22 §12` F1 的 title+status）、Norm 带
 * `direction_key`（`27 §10` F1 的 direction_key+title）、经验只带标题。三类均
 * **不带** scope／正文／decision——那是 F2/F3 的内容，常驻会给注入面造成无谓的
 * 字节压力，且会把索引做成第二份语料。
 */
// **2026-11-11 Human 决定**：「ADR 和事实规范的索引不能减少，经验应该是按需给出索引」
// （`34 §8.4` 已按此重订）。故常驻段由三段缩为两段，`pitfall` 移出本数组——
// 它不再逐条列标题，改为一行按需入口（`PITFALL_ON_DEMAND_*` 见下）。
//
// **为什么不是把 `pitfall` 从段定义里整段删掉**：本文件多处按下标/按类型引用段，
// 保留段头与入口常量可供按需行复用；且段序、份额计算都在此数组上派生，
// 少一个元素即自动少一份份额——这是本决定**顺带释放预算**的实现路径。
export const L0_SEGMENT_ORDER = Object.freeze(["adr", "norm"]);

/** 经验按需入口的工具名（`34 §8.4`「入口须可用」要求它真实存在且能取全量）。 */
export const PITFALL_ON_DEMAND_ENTRYPOINT = "ldvh_pitfall_list";

/**
 * 经验按需行的段头与措辞。
 *
 * `34 §8.4` 为该通道立了三项强制要求，逐条对应本常量的构成：
 *   1. **总数须真实** —— 由调用点传入精确计数，不得写死、不得估算；
 *   2. **入口须可用** —— `PITFALL_ON_DEMAND_ENTRYPOINT` 是真实工具；
 *   3. **不得声称已核对** —— 措辞是「共 N 条，取全量用 X」，绝不写成
 *      「已检查 N 条」或「无相关问题」（那会把索引读成结论，`34 §13`）。
 */
export const PITFALL_ON_DEMAND_HEADER = "【经验 · active Pitfall（23 §12 按需索引）】";

/** 各段的段头（逐字含类型与 active 口径；`adr` 沿用既有措辞以保引用稳定）。 */
export const L0_SEGMENT_HEADERS = Object.freeze({
  adr: "【决策基线 · active ADR（22 §12 义务披露）】",
  norm: "【事实规范 · active Norm（27 §10 L0 枚举）】",
  pitfall: "【经验 · active Pitfall（23 §12 L0 枚举）】",
});

/** 各段的取全量入口（段尾披露「另有 N 条未列出」时一并给出）。 */
export const L0_SEGMENT_ENTRYPOINTS = Object.freeze({
  adr: "ldvh_adr_list",
  norm: "ldvh_norm_list",
  pitfall: "ldvh_pitfall_list",
});

/**
 * **常驻索引可占「固定开销与基线之外」剩余预算的比例分母**（3 = 至多三分之一）。
 *
 * 与 `BASELINE_BUDGET_SHARE_DIVISOR` 同一条方法论，但主体从「ADR 基线」扩到
 * 「Norm 段」：常驻段优先于词法候选，却不得把候选区吃干——
 * 否则 `34 §8.1` 第 1 项的「双源召回」会退化成「双源清单」（只剩常驻段，不再有
 * 按本次动作匹配的候选）。
 *
 * **为什么是 3 而不是 2**（2026-11-04 实测）：分母取 2 时，2400 档 L0 占 586 字节、
 * 候选只剩 714，且规范候选先吃 60% 后首条事实卡（549 字节）放不下——事实侧归零，
 * 正是「规范占满预算致事实恒为 0」这条既有用例抓的形态。改 3 之后同一档 L0 占
 * 约 430、候选约 870，规范 3 条（约 313）之后仍容得下一条事实卡。
 *
 * 实测（2026-11-04，本仓语料）：Norm 段 201 字节、经验段 48 条标题 2715 字节。
 * 默认档 10240 下份额约 3.0K ⇒ **两段全量装得下**，这正是 Human「必须注入」的
 * 常态；小预算下才会截断并如实披露（`02 §9.1` 不得静默截断）。
 */
export const L0_SHARE_DIVISOR = 3;

/** 段尾声明（无条目被省略时）。刻意压短：它每回合常驻。 */
export const L0_FULL_NOTE = "（L0 索引：只标「有哪些」，不证明适用。）";

/**
 * **规划 L0 常驻枚举**（纯函数，字节账与渲染逐字同源）。
 *
 * 输入按 `L0_SEGMENT_ORDER` 排好的常驻段条目与当次预算，输出「每段实际列出哪些、
 * 省略多少、占多少字节」。之所以在**数据层**决定列到第几条：`usableBudget` 必须
 * 提前扣掉本段，否则候选会按「没有 L0 段」来装填，渲染时再挤进来——正是
 * 2026-10-25 基线落地时踩过的欠预留缺陷（实测多裁 2 条候选且裁剪原因归错）。
 *
 * 装填次序即 Human 指定的次序：ADR 先，其次 Norm；前一段装不下才
 * 轮到后一段。每段超出的部分如实计数披露（`02 §9.1` 不得静默截断）。
 * 经验已于 2026-11-11 移出本序列（`34 §8.4` 重订），改由按需行承载。
 *
 * @param {Array<{type: string, entries: string[], total: number}>} segments 按次序排好的常驻段
 * @param {number|null} budgetBytes 当次注入预算；`null` = 调用方不设字节约束
 * @param {number} reserveBytes 已被固定开销占掉的字节
 * @returns {{segments: object[], bytes: number, yielded: boolean, note: string}}
 */
export function planL0Enumeration(segments, budgetBytes, reserveBytes = 0) {
  const ordered = Array.isArray(segments) ? segments : [];
  const hasBudget = Number.isFinite(budgetBytes) && budgetBytes > 0;
  const remaining = hasBudget ? Math.max(0, budgetBytes - reserveBytes) : Number.POSITIVE_INFINITY;
  const cap = hasBudget ? Math.floor(remaining / L0_SHARE_DIVISOR) : Number.POSITIVE_INFINITY;
  // 整组让位：预算低到连「一段的段头 + 段尾 + 一条」都放不下时，本组不输出任何
  // 行，由调用方把「常驻索引未展开」并入既有披露行（让位不等于静默，
  // `02 §9.1` 不得静默截断——与极小预算下基线让位同一套痕迹纪律）。
  const yieldAll = () => ({
    segments: ordered.map((segment) => ({
      type: segment.type,
      lines: [],
      total: segment.total,
      shown: 0,
      omitted: segment.total,
      bytes: 0,
      yielded: segment.total > 0,
    })),
    bytes: 0,
    yielded: ordered.some((segment) => segment.total > 0),
    note: "",
  });
  if (hasBudget && budgetBytes < BASELINE_YIELD_BELOW_BYTES) return yieldAll();
  if (cap <= 0) return yieldAll();

  let used = 0;
  const planned = [];
  for (const segment of ordered) {
    const header = L0_SEGMENT_HEADERS[segment.type] ?? `【L0 · ${segment.type}】`;
    const entry = L0_SEGMENT_ENTRYPOINTS[segment.type] ?? "对应 list 工具";
    const total = Number.isInteger(segment.total) ? segment.total : segment.entries.length;
    if (total === 0) {
      planned.push({ type: segment.type, lines: [], total: 0, shown: 0, omitted: 0, bytes: 0, yielded: false });
      continue;
    }
    const headerBytes = Buffer.byteLength(header, "utf8") + 1;
    // 段尾两版：全量版短，截断版要报「共几条、去哪儿取全量」。逐条装填时按
    // **最坏**那版判容量，装填完再取真实版本——宁可少列一条，不得列完才发现
    // 段尾放不下（那会静默超预算）。
    const noteOf = (shown) =>
      `（本档预算仅容前 ${shown} 条，共 ${total} 条；全量用 ${entry}。L0 索引不证明适用。）`;
    const worstNoteBytes = Buffer.byteLength(noteOf(total), "utf8") + 1;
    // 连「段头 + 段尾 + 一条」都放不下 ⇒ 本段整段让位，痕迹由调用方并入披露行。
    if (cap - used < headerBytes + worstNoteBytes + Buffer.byteLength(segment.entries[0] ?? "", "utf8") + 1) {
      planned.push({ type: segment.type, lines: [], total, shown: 0, omitted: total, bytes: 0, yielded: true });
      continue;
    }
    const kept = [];
    let segmentUsed = headerBytes + worstNoteBytes;
    for (const line of segment.entries) {
      const size = Buffer.byteLength(line, "utf8") + 1;
      if (used + segmentUsed + size > cap) break;
      segmentUsed += size;
      kept.push(line);
    }
    if (kept.length === 0) {
      planned.push({ type: segment.type, lines: [], total, shown: 0, omitted: total, bytes: 0, yielded: true });
      continue;
    }
    const omitted = total - kept.length;
    const note = omitted > 0 ? noteOf(kept.length) : L0_FULL_NOTE;
    const bytes = headerBytes
      + kept.reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0)
      + Buffer.byteLength(note, "utf8") + 1;
    used += bytes;
    planned.push({
      type: segment.type,
      lines: [header, ...kept, note],
      total,
      shown: kept.length,
      omitted,
      bytes,
      yielded: false,
      note,
    });
  }
  return {
    segments: planned,
    bytes: used,
    yielded: planned.some((segment) => segment.yielded === true),
    note: planned.some((segment) => segment.omitted > 0) ? "partial" : "full",
  };
}

/**
 * 三段 L0 的**枚举输入**（只取身份字段，确定性排序）。
 *
 * 状态取各自类型的默认候选状态（`DEFAULT_STATUSES_BY_TYPE`，与词法候选同源，
 * 故「有词命中时基线 N 条、无词命中时基线 M 条」的漂移不可能出现）。
 * 排序为标题码点序 → 稳定引用（`02 §9` 确定性红线：同一语料两次调用必须给出
 * 同一次序，否则常驻段会毫无理由地抖动）。
 *
 * @param {object[]} facts 事实源全量（或声明范围内的事实）
 * @returns {Array<{type: string, entries: string[], total: number}>}
 */
export function l0EnumerationOf(facts) {
  const all = Array.isArray(facts) ? facts : [];
  return L0_SEGMENT_ORDER.map((type) => {
    const statuses = DEFAULT_STATUSES_BY_TYPE[type] ?? DEFAULT_STATUSES_FALLBACK;
    const picked = all.filter((fact) => fact.type === type && statuses.includes(fact.status));
    picked.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
      || (String(a.ref) < String(b.ref) ? -1 : String(a.ref) > String(b.ref) ? 1 : 0));
    const entries = picked.map((fact) => {
      if (type === "adr") return `· ${fact.title}${fact.status ? `［${fact.status}］` : ""}`;
      // Norm 带 direction_key（`27 §10` F1 口径）：它是遵守预检的稳定入口。
      const directionKey = fact.structural?.directionKey;
      if (type === "norm" && typeof directionKey === "string" && directionKey !== "") {
        return `· ${fact.title}（${directionKey}）`;
      }
      return `· ${fact.title}`;
    });
    return { type, entries, total: entries.length };
  });
}

/**
 * active 经验的真实总数（`34 §8.4` 第 1 项「总数须真实」的唯一计数口径）。
 *
 * **不能从 `l0EnumerationOf` 的结果里找 pitfall 段再兜底 0**（2026-11-11 缺陷）：
 * 该函数只遍历 `L0_SEGMENT_ORDER`（现为 adr/norm），经验已改为按需、不在常驻段里。
 * 故「找不到 pitfall 段」只表示「经验不在常驻枚举」，不表示「本项目没有经验」；
 * 用 `?? 0` 会把「未枚举」说成「本类为空」，直接违反 34 §12 三态与 §8.4 第 1 项。
 * 计数按与词法候选同源的默认状态集，避免第二套判定。
 *
 * @param {object[]} facts 事实源全量（或声明范围内的事实）
 * @returns {number}
 */
export function countActivePitfalls(facts) {
  const statuses = DEFAULT_STATUSES_BY_TYPE.pitfall ?? DEFAULT_STATUSES_FALLBACK;
  return (Array.isArray(facts) ? facts : [])
    .filter((fact) => fact.type === "pitfall" && statuses.includes(fact.status)).length;
}

/** 供渲染层阅读的 L0 常驻段（数据层已规划好行，渲染层只排版，不再做第二次字节决策）。 */
export function l0LinesOf(plan) {
  if (plan === null || typeof plan !== "object" || !Array.isArray(plan.segments)) return [];
  return plan.segments.flatMap((segment) => (Array.isArray(segment.lines) ? segment.lines : []));
}

/**
 * **注入上下文总预算的量化档位**（Human 决定 2026-10-25：10/20/30/40/50 K）。
 *
 * 为什么是「档位」而不是任意数值：`10 §5.3` 要求「体量以固定常量承载，变更走
 * 受控提交」——任意可填的数值会让「预算守住了」失去机械核对基准（审计时看到的是
 * 哪一版？）。档位把可调性（Human 能在设置里选）与可核对性（档位值仍是代码里
 * 受控的常量）同时保住。
 *
 * 为什么单位是 **K 字节**而非字符：两块注入面此前计量单位不一致（引导面按
 * UTF-16 字符、召回面按 UTF-8 字节），中文一字≈3 字节，导致「1500 字符」与
 * 「2400 字节」无法放进同一个盘子判断。统一为字节后，档位才可比。
 *
 * 取值依据（实测 2026-10-25，本仓语料）：
 *   · 引导面 governed 实际 2675 字节；
 *   · 召回面去冗余后 2400 预算下最大 2130 字节、3000 下 2721 字节；
 *   · 两块合计约 4.8–5.4K → 故 10K 档已留约 2 倍余量，足以容纳 ADR 增长与
 *     更长语料；20K 以上属「大语料项目」的宽裕档。
 *
 * **档位值是受控常量**：改档位集合本身须走受控提交 + Human 决定（`34 §15.1`
 * 第 5 项）；运行期只能在已列档位中选择。
 *
 * **档位只管召回面，不与引导面共用台账**（Human 决定 2026-10-25 改定）：
 * 引导面（管辖判定 + 最小规则引导）是**系统固定内容，不随业务变化**，其体量
 * 由它自己的固定常量承载（`GUIDANCE_CHAR_BUDGET`）；召回面随语料增长，由本档位
 * 承载。两块各自独立、互不扣减——曾尝试共用台账（引导先取上限、召回取剩余），
 * Human 裁定不需要：引导面不会变，没有必要为它预留份额。
 */
export const INJECTION_BUDGET_TIERS = Object.freeze({
  10: 10 * 1024,
  20: 20 * 1024,
  30: 30 * 1024,
  40: 40 * 1024,
  50: 50 * 1024,
});

/** 默认档位（10K）：覆盖本仓实测约 5.4K 的两块合计，留约 2 倍余量。 */
export const DEFAULT_INJECTION_BUDGET_TIER = 10;

/**
 * 由**预算档位**推导注入的**条数上限**（2026-10-27 修）。
 *
 * ── 缺陷（Human 指出）────────────────────────────────────────────────
 * 此前 `lifecycle.js` 只把档位解析出的**字节预算**传给 `buildRecallInjection`，
 * **没有传 `limit`**，于是 `limit` 永久取函数默认值 3。实测后果：档位 10（10240
 * 字节）下，`limit=3` 只列出 6 条、用掉 1319 字节 = **13%**——87% 的预算闲置。
 * 而 Human 在设置里选档位的本意正是「按这个体量给结果」，档位高了却拿不到更多
 * 候选，等于设置项空转。实测同一查询：limit=3→1319B、limit=20→8629B。
 *
 * ── 规范依据（不虚构数值）──────────────────────────────────────────────
 * `34 §11`「条数上限的归属」逐字规定：条数上限**不属于 34 号规则**，`02 §9.2`
 * 明禁「所有类型共用的默认数量」，故「条数上限只能由**具体类型来源**（20–27）
 * 或**调用方按当次需要**给出」。此处调用方就是注入路径，其「当次需要」的量化
 * 依据就是 Human 选定的预算档位——这正是规范授权的那条路。
 *
 * `34 §11` 第 1 项要求上限**以具名常量承载**、且「不得是运行期猜测」。
 * 本条满足该要求的方式是：**只有一个除数常量**（`RECALL_LIMIT_BYTES_PER_ITEM`，
 * 实测标定）加**两个上下界常量**（`RECALL_LIMIT_MIN`／`RECALL_LIMIT_MAX`）。
 * 中间的取值是 `预算 ÷ 常量` 的**确定性整数除法**——同预算恒得同条数，
 * 可复算、可审计，不是「随标题长度浮动的猜测」（本式不读任何候选内容）。
 *
 * **为什么不采用「静态档位表」**（第一版做法，已删除）：我一度写成
 * `{10:12, 20:24, …}` 的映射，Human 指出那仍是硬编码，只是把「固定 3」换成
 * 「固定一张表」——预算本该动态决定条数。故改为按预算导出。
 *
 * **为什么除数取 220 而不是 120**（第二版错误，已改回）：120 使 limit 系统性
 * 大于预算真能装下的条数，随后靠渲染层裁剪兜底。表面利用率好看，实为把
 * 「预算换算成行数」当产出目标——独立审核实测其边际精确率仅 1.3%
 * （多出的 150 行里只多 2 条相关）。
 *
 * **limit 是「每侧」上限**（`specHits`／`factHits` 各 slice 一次），故换算
 * 除以 2：一次注入最多 `2 × limit` 条。
 */
/**
 * 单条候选的实测均字节。**用于把预算换算成条数上限**。
 *
 * 取 220（不是 120）：独立审核实测指出，我先前把它改成 120 是错的——那使 limit
 * 系统性大于「预算真能装下的条数」，随后靠渲染层裁剪兜底。表面看利用率高了，
 * 实际是把「预算换算成行数」当成了产出目标；实测边际精确率只有 1.3%
 * （多出的 150 行里只多 2 条相关）。
 *
 * 220 的依据：同一查询 limit 3/5/8/12/20 五档实测单条 209–228B，深层的头部
 * 候选标题更长，均值稳定在 220 附近。故 `预算 ÷ 220` 是「本档大致能装几条」
 * 的保守估计——**宁可少给几条，不靠渲染层事后裁剪**。
 */
export const RECALL_LIMIT_BYTES_PER_ITEM = 220;

/**
 * **条数硬上限：12**（每侧）。预算再大也不超过这个数。
 *
 * ── 定值依据（2026-10-27 第 3 步，实测得出，不是偏好）──────────────────
 *
 * 用自然语言查询集实测「不同 limit 下的精确率」（相关行/返回行）：
 *
 *   limit= 3 → 4/34  = 12%
 *   limit= 6 → 4/67  =  6%
 *   limit=12 → 4/126 =  3%
 *   limit=23 → 4/194 =  2%
 *
 * **相关条数恒为 4，返回行数翻了 5 倍。** 也就是说：把预算花完不会多召回
 * 任何有用内容，只会按比例稀释它——这正是 Human 那句「有价值的信息，还是
 * 为了给而给」的量化形态。
 *
 * 独立审核在同一方向上给出更极端的证据：上线口径从「6 行 / 2.5 KB / 精确率
 * 17.4%」变成「37 行 / 9.6 KB / 精确率 3.5%」，**边际精确率仅 1.3%**
 * （多出的 150 行里只新增 2 条相关）。
 *
 * 故结论是：**预算余额不等于该花的额度。** 预算的意义是「不得超过」，不是
 * 「必须用满」。上限 12 的取法：在实测里精确率还能维持在 3% 以上、且注入
 * 体量（双侧约 24 行）仍在一屏可扫的范围内；再往上只有稀释。
 *
 * **这不是回到「固定 3」的老问题**：小预算（如直调路径的 2400 字节）仍会
 * 给出更少的条数（`recallLimitForBudget` 取 min），预算是上限而非目标。
 * 变的是「预算很充裕时不再无限给」。
 */
export const RECALL_LIMIT_MAX = 12;

/**
 * 按**字节预算**动态给出条数上限（2026-10-27 二次修正，Human 指出）。
 *
 * **为什么不再用档位表**：第一版我写成 `{10:12, 20:24, …}` 的静态映射——那仍是
 * 硬编码，只是把「固定 3」换成了「固定一张表」。Human 指出：预算本来就该**动态**
 * 决定给多少条，不可能为了让表对齐而硬塞。故改为直接由预算推导：
 *
 *   limit = floor(预算 / RECALL_LIMIT_BYTES_PER_ITEM)
 *
 * **依据不是拍脑袋**：`RECALL_LIMIT_BYTES_PER_ITEM = 220` 是实测单条候选的
 * 平均字节（2026-10-27，同一查询在 limit 3/5/8/12/20 五档实测 209–228 字节，
 * 极稳定）。用它做除数，档位变大自然给出更多条数，无需维护任何表。
 *
 * **仍需闸门**：`34 §11` 要求上限「以具名常量承载」且「不得是运行期猜测」。
 * 故保留两个**具名常量**作为上下界（`RECALL_LIMIT_MIN`／`RECALL_LIMIT_MAX`）：
 * 下界防「预算被设得极小导致一条都装不下」，上界防「预算被设得极大导致一次塞
 * 上千条把上下文压垮」。中间的取值由预算线性导出——**这是确定性算术，不是猜测**：
 * 同预算恒得同条数，可复算、可审计（02 §9 红线）。
 *
 * @param {number|null|undefined} budgetBytes 本档字节预算
 * @returns {number} 条数上限（总是返回合法整数；预算缺失时返回下界）
 */
export function recallLimitForBudget(budgetBytes) {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) return RECALL_LIMIT_MIN;
  // **`limit` 是「每侧」上限**（`specHits = allSpecHits.slice(0, limit)`、
  // `factHits = allFactHits.slice(0, limit)`），故一次注入最多 `2 × limit` 条。
  // 换算须按双侧计：`预算 ÷ 单条均字节 ÷ 2`。独立审核指出原式漏了这一步
  // （档 10K 标称 46，实际候选上限 92 条）。
  const raw = Math.floor(budgetBytes / RECALL_LIMIT_BYTES_PER_ITEM / 2);
  return Math.min(RECALL_LIMIT_MAX, Math.max(RECALL_LIMIT_MIN, raw));
}

/** 条数下界：至少给几条（即使预算极小也不返回空）。 */
export const RECALL_LIMIT_MIN = 3;

/**
 * 把档位解析为字节总预算。
 *
 * 未登记档位**不静默回落**：按 `10 §9.1` 的精神，配置值非法时须如实呈现，
 * 不得悄悄用默认值掩盖（否则 Human 以为自己选了 30K，实际生效 10K）。
 *
 * @param {number|string|undefined|null} tier - 档位（K）。undefined/null → 默认档。
 * @returns {{ok: true, tier: number, bytes: number} | {ok: false, reason: string, tier: number, bytes: number}}
 */
export function resolveInjectionBudget(tier) {
  if (tier === undefined || tier === null) {
    return { ok: true, tier: DEFAULT_INJECTION_BUDGET_TIER, bytes: INJECTION_BUDGET_TIERS[DEFAULT_INJECTION_BUDGET_TIER] };
  }
  const key = typeof tier === "string" ? Number(tier) : tier;
  const bytes = INJECTION_BUDGET_TIERS[key];
  if (bytes === undefined) {
    const allowed = Object.keys(INJECTION_BUDGET_TIERS).join("/");
    return {
      ok: false,
      reason: `未登记的预算档位 ${JSON.stringify(tier)}；可用档位：${allowed}（单位 K 字节）`,
      tier: DEFAULT_INJECTION_BUDGET_TIER,
      bytes: INJECTION_BUDGET_TIERS[DEFAULT_INJECTION_BUDGET_TIER],
    };
  }
  return { ok: true, tier: key, bytes };
}

function excerptOf(text) {
  if (typeof text !== "string") return "";
  // 折叠所有空白（含换行）为单空格：摘录是单行展示位，换行会撑破行。
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_MAX_CHARS) return flat;
  return `${flat.slice(0, EXCERPT_MAX_CHARS)}…`;
}

/**
 * 候选卡上的**类型专属结构字段**（`02 §9.1` F2 的投影要素）。
 *
 * 只取**短、闭集、可直接判断**的字段——长文本一律不进（`summary`/`gist`/
 * `phenomenon` 已由 `excerpt` 承载，重复带会吃掉注入预算，而预算是最稀缺资源）。
 *
 * 逐项依据：
 *   · `serves`——20 §12 / 21 §13：「F1 投影含 serves」；
 *   · `priority`——20 §12：「F1 投影含 priority」，Web 列表按它筛选排序；
 *   · `directionKey`——27 §209：「F1 枚举 active Norm（direction_key + title + status）」；
 *   · `occurrenceCount`——26 §8：重复观察的证据量，回答「这笔账攒了几次」；
 *   · `relationKeys`——03 §7.2：该对象声明了哪些边（不展开目标，展开属 F3/F4）；
 *   · `gate1`——21 §8：工单是否已过 Gate 1（`open` 与「待批准」的区别就在这）。
 *
 * **不带的**：`attribution`（长自由文本，判读属 F3）、`attributionRef`（已有
 * `structural` 命中理由覆盖）、`relationTargets`/`refTargets`（关系导航是独立
 * 只读方向，见 24 §244；塞进每张卡会让预算被 uuid 吃光）。
 *
 * @returns {object|null} 没有任何可带字段时返回 `null`（卡上不出现空壳）
 */
function structuralCardOf(candidate) {
  const s = candidate?.structural;
  if (s === null || typeof s !== "object") return null;
  const out = {};
  if (typeof s.serves === "string" && s.serves !== "") out.serves = s.serves;
  if (typeof s.priority === "string" && s.priority !== "") out.priority = s.priority;
  if (typeof s.directionKey === "string" && s.directionKey !== "") out.directionKey = s.directionKey;
  if (Number.isInteger(s.occurrenceCount)) out.occurrenceCount = s.occurrenceCount;
  if (Array.isArray(s.relationKeys) && s.relationKeys.length > 0) {
    out.relationKeys = [...new Set(s.relationKeys)];
  }
  // 工单侧：`gate_1` 是否存在决定「是否已过 Gate 1」，是 21 §14 的关键状态。
  if (candidate.type === "workcase") {
    out.gate1 = typeof candidate.gate1ApprovedAt === "string" && candidate.gate1ApprovedAt !== "";
  }
  return Object.keys(out).length === 0 ? null : out;
}


/**
 * 单个载体的**内容指纹**（FNV-1a over 全文）。
 *
 * 与集合指纹的区别：集合指纹回答「还是不是同一批候选」，**不覆盖内容**；
 * 内容指纹回答「这份载体的内容有没有变」。`02 §9.2` 要求候选卡「带来源与
 * 指纹」，指的是后者——否则调用方无法判断读到的是不是当前版本。
 *
 * 边界：这是**机械可比的摘要**，不证明内容真实、充分或正确（`02 §9.2` 各层
 * 「不能单独证明」列已限定）。算法与集合指纹一致（FNV-1a 32），实现简单可复算。
 */
function contentFingerprintOf(text) {
  const value = typeof text === "string" ? text : "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return {
    kind: "content",
    algorithm: "fnv1a-32",
    value: hash.toString(16).padStart(8, "0"),
    coversContent: true,
    length: value.length,
  };
}

/**
 * 内容指纹的**按对象缓存**（2026-10-31 加）。
 *
 * 指纹是逐字符的 FNV-1a，语料全文 2.1M 字符——每次召回重算全部载体的指纹
 * 实测占 CPU 10.5%（它是「语料级统计缓存」的签名来源）。
 *
 * 用 WeakMap 按**载体对象**缓存：解析结果按内容指纹缓存后，同一份语料在多次
 * 召回之间是**同一批对象**（见 `cachedCorpus`），故指纹可跨召回复用；
 * 语料一改则解析结果换新对象，缓存自然失效。
 */
const CONTENT_FINGERPRINT_CACHE = new WeakMap();

/** 取内容指纹，必要时计算并记住（按载体对象）。 */
function contentFingerprintOfCached(text, owner) {
  if (owner !== undefined && owner !== null && typeof owner === "object") {
    const hit = CONTENT_FINGERPRINT_CACHE.get(owner);
    if (hit !== undefined) return hit;
    const computed = contentFingerprintOf(text);
    CONTENT_FINGERPRINT_CACHE.set(owner, computed);
    return computed;
  }
  return contentFingerprintOf(text);
}

/**
 * 候选集合的确定性指纹（对排序后的路径做 FNV-1a 摘要）。
 *
 * **只覆盖「集合成员」，不覆盖内容**——它回答「还是不是同一批候选」，
 * 不是「内容有没有变」。故 `02 §9.1` 的「指纹」在此如实限定为集合指纹，
 * 不冒称内容指纹（内容级指纹由各载体的受控读取提供）。
 */
function fingerprintOf(candidates) {
  const paths = candidates.map((candidate) => candidate.path).filter((p) => typeof p === "string").sort();
  let hash = 0x811c9dc5;
  const text = paths.join("\n");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return {
    kind: "candidate-set",
    algorithm: "fnv1a-32 over sorted paths",
    value: hash.toString(16).padStart(8, "0"),
    memberCount: paths.length,
    coversContent: false,
  };
}

/**
 * 按 `01 §10.3` 的三级回退解析规范语料来源。
 *
 * > 规范语料来源按三级回退解析：受辖项目根 `specs/` → 插件开发布局的源仓库根
 * > `specs/`（link／开发安装指向源目录，以根规范载体的实际存在辨认）→ 插件包内
 * > `specs/`。三级按序探测，首个实际存在的目录即该次读取的唯一来源视图，
 * > 同一次结果不得跨级混读；来源披露必须如实标注实际应答方，不得把回退来源
 * > 表述为项目自著语料。
 *
 * **依据是 `01 §10.3` 本身**，不是 34：这段引文就是 `01 §10.3` 的原文，三级回退
 * 由该条直接要求。本模块读取规范语料，故须遵循该条的解析规则。
 *
 * **v5 更正（2026-10-24）**：此处原写「`34 §7` 把召回绑到这个入口」，
 * **该表述是错的**，已删。核证如下：
 *   · `34 §7` 原文只说「规则来源为规范源（**经 `01 §10` 的 L0–L4 读取取得**）」——
 *     它规定的是**消费方式**（从 `01 §10` 取），不是说「本系统负责召回」；
 *   · `34 §11` scope 逐字：「**不定义**各事实类型的召回时机（由各类型规范承接）」；
 *   · `34:283`：「召回提供候选与内容，**本系统判定适用**……本系统不重复召回的
 *     进入条件」；
 *   · `02 §9.2` 末段规定召回/预热由 **`10` + `05` + 各类型来源** 承载——34 不在其中。
 * 故「召回绑在 34」属误读：34 是召回的**消费者**，不是所有者。
 * 本模块的规范依据是 `01 §10.3`（语料解析）+ `02 §9.1`（F0–F4）+ `10 §5.3`（入口形式）。
 *
 * **「以根规范载体的实际存在辨认」**：某一级目录存在但里面没有根规范载体时，
 * 不算「实际存在」——空目录不得冒充语料来源。
 *
 * @returns {{dir: string, tier: "project"|"source-repo"|"package"} | null}
 */
export async function resolveSpecsRoot(projectRoot) {
  const candidates = [
    { dir: join(projectRoot, "specs"), tier: "project" },
    // 插件开发布局：本模块位于 `<源码根>/plugin/lib/`，故源码根是 `../..`。
    { dir: join(import.meta.dirname, "..", "..", "specs"), tier: "source-repo" },
    // 包内副本：发布打包时自源仓库复制。
    { dir: join(import.meta.dirname, "..", "specs"), tier: "package" },
  ];
  for (const candidate of candidates) {
    const files = await readdirOrEmpty(candidate.dir);
    // 「根规范载体的实际存在」：至少有一个 .md 文件才算这一级成立。
    if (files.some((file) => file.endsWith(".md"))) return candidate;
  }
  return null;
}

export async function loadSpecs(specsDir) {
  // 目录不存在时返回空数组，不抛 ENOENT。
  // 实测：缺失 `specs/` 的受辖项目（新建项目、语料尚未建立）会让每次召回都抛
  // `ENOENT ... scandir .../specs`。上层虽有 try/catch 只记日志，但那意味着
  // **这类项目每回合都在报错**——而「还没有语料」是正常状态，不是错误。
  //
  // **缓存**：解析结果按「目录 + 语料内容指纹」缓存（见「语料 token 缓存」节）。
  // 正文**每次都从盘上重读**（缓存的是解析产物），且语料一改即换键。
  return cachedCorpus(specsDir, false, (files) => {
  const out = [];
  for (const { name: file, text } of files) {
    const fm = parseFrontmatter(text);
    // 嵌套在 ldvh_spec 下，本仓用两空格缩进；直接按行再抽一次。
    const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const pick = (key) => {
      const direct = fm[key];
      if (direct !== undefined && direct !== "") return direct;
      const m = new RegExp(`^\\s+${key}:\\s*(.+)$`, "m").exec(block);
      return m !== null ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    const headings = [...text.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim());
    out.push({
      source: "spec",
      ref: pick("spec_key") || file.replace(/\.md$/, ""),
      // **稳定引用**（`34 §8.2` 第 2、4 项）：`spec_key` 是规范侧可直达 L4 全文的
      // 标识，其值即 `ldvh_read_specification_content` 的 `responsibility_key`。
      // **不与 `ref` 混用**：`ref` 保留「取不到 spec_key 时退回文件名」的既有语义，
      // 而文件名不是可用的 responsibility_key——把它当稳定引用交付，读者会拿到一个
      // 工具读不到的引用。故此处**只登记真实存在**的 spec_key，缺失时为 null。
      specKey: pick("spec_key") || null,
      specId: pick("spec_id"),
      title: pick("title") || file.replace(/\.md$/, ""),
      positioning: pick("positioning"),
      scope: pick("scope"),
      basis: pick("basis"),
      // `path` 是**相对项目根**的展示路径（本项目自著语料时即真实可读路径）。
      // `absolutePath` 是该载体的实际位置——语料来自 01 §10.3 的回退层级时，
      // `path` 相对当前项目根**读不到**（实测：回退到源仓库时 `specs/34-…md`
      // 在项目根下不存在），读者必须用 `absolutePath` 才能取到正文。
      path: `specs/${file}`,
      absolutePath: join(specsDir, file),
      headings,
      text,
      // **正文（剥离 frontmatter）**：正文层匹配只能用这个，不能用 `text`。
      //
      // 实测缺陷（2026-10-24）：`text` 含 YAML frontmatter，于是查询命中
      // `canonical_path`／`spec_key`／`parent_spec`／`positioning` 这些**字段名**
      // 也被报成「正文命中」——实测各命中 3 份规范，理由写「正文命中：spec_key」。
      // 那是元数据形状，不是规范内容，把它当相关性证据属误报
      // （`02 §9.1`「机械有效不能替代语义相关」）。
      //
      // 注意：`text` 仍保留全文供内容指纹使用（指纹须覆盖完整载体），
      // 只是**匹配**改用 `bodyText`。
      bodyText: text.replace(/^---\n[\s\S]*?\n---\n?/, ""),
    });
  }
  return out;
  });
}

/**
 * 载入事实源 `ldvh-base/`。
 *
 * 每个子目录是一个事实类型（adrs/frictions/norms/pitfalls/researches/sparks/workcases）。
 * 取 `title` / `status` 与类型相关的可匹配字段（scope、decision、phenomenon、question、
 * research_question、gist、trigger_signal 等），外加正文前若干行做补充匹配。
 *
 * **现读现解析**，不建持久索引。
 */
/**
 * 读某一事实类型的**机器判据表**（02 §12.4）。
 *
 * 供 `loadFacts` 在未显式传入判据时自解析：临时语料目录没有 `specs/`，
 * `resolveSpecsRoot` 会按「项目 → 源码仓 → 包内副本」回退，取不到即 `null`。
 * 取不到 = 判据不可用（`null`），调用方据此**停用机器判据并如实披露**，
 * 不回落任何默认字段集。
 */
async function resolveRecallCriteriaForFacts(baseDir) {
  const specsSource = await resolveSpecsRoot(dirname(baseDir));
  if (specsSource === null) return null;
  return loadRecallCriteria(specsSource.dir);
}

/** 核心语义字段取文本：`scope` 允许退回 `scope_boundary`（20 §8 的存量写法）。 */
function coreFieldTextOf(fm, field) {
  if (fm === null || typeof fm !== "object") return "";
  const direct = textField(fm[field]);
  if (direct !== "") return direct;
  if (field === "scope") return textField(fm.scope_boundary);
  return "";
}

export async function loadFacts(baseDir, options = {}) {
  // 同 loadSpecs：事实源目录不存在时返回空数组，不抛 ENOENT。
  //
  // **缓存**：解析结果按「目录 + 语料内容指纹 + 判据表指纹」缓存（见「语料
  // token 缓存」节）。正文**每次都从盘上重读**（缓存的是解析产物），语料或
  // 判据表一改即换键。
  //
  // **判据表**（02 §12.4）：`detail` 不再把 10 个字段压平统一匹配，而是**按
  // 类型取「核心语义字段」行**（见下方 `detail` 构造）。判据表缺失/非法时，
  // 该类型的机器判据整体停用：`detail` 置空（字段语义通道关闭）、`typeNames`
  // 为空（类型点名通道关闭），并把错误挂在对象上供调用方披露——**不猜字段**。
  let criteria = options.criteria;
  if (criteria === undefined) criteria = await resolveRecallCriteriaForFacts(baseDir);
  return cachedCorpus(baseDir, true, (files) => {
  const out = [];
  for (const { dir, name: file, text } of files) {      // **结构化解析**（2026-10-29）：见 `parseObjectFrontmatter` 的注释。
      // `fm` 的形态由此从「全部是字符串」变为「按 YAML 类型」——标量仍是字符串，
      // 但 `relations`/`urls`/`change_log` 是数组、`occurrence` 是对象。
      // 下文所有取字段的地方因此都必须走 `textField()` 收文本，
      // 不能让「数组/对象」直接拼进匹配面（那会拼出 "[object Object]"）。
      const { data: fm, yamlError } = parseObjectFrontmatter(text);
      // 正文（去掉 frontmatter）**全文参与匹配**。
      //
      // **原为前 1200 字截断，2026-10-24 改为全文**，实测依据：
      //   · 抽查 50 条事实，**56% 的正文超过 1200 字符**；
      //   · 某条 Pitfall 正文 4707 字符，而「解决」「规避」「验证」「影响与适用范围」
      //     四节全在 1200 之后——即**整个后半段从未参与匹配**；
      //   · `23 §12` 明确 Pitfall 的价值是「什么会出错、**怎么识别、怎么规避**」，
      //     而「规避」恰在被截掉的区间。实测查询「怎么规避这个坑」在截断版只召回
      //     1 条、全文版召回 5 条（且都是正文真提及「规避」的）。
      //
      // 成本：单次召回 109ms → 142ms（+30%），8 类查询的弱命中占比 5% → 8%
      // （弱命中已被排序压到后面，不占强命中名额）。以 +30% 延迟换取「后半段可见」，
      // 对「按表现匹配已知机制」（`23 §12`「故障调查」）是必要的。
      //
      // 注意：不要为了省这点开销再截断——被截掉的恰是「怎么规避」这类最有用的内容。
      const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
      // **全文**保留，仅供内容指纹使用——指纹必须覆盖完整载体，
      // 否则载体后半部分的变化对指纹不可见（见 `contentFingerprintOf` 的说明）。
      const fullText = text;
      // **结构维度**（2026-10-29 新增）：这些字段此前**读都没读**，故结构维度
      // 对召回完全不可见。每个都在规范里被定为闭集或锚点，即「只有解析成结构
      // 才有意义」的那一类：
      //   · `serves`——SG-n 子目标锚点（20 §6 / 21 §8），F1 投影字段；
      //   · `priority`——P0–P3 闭集（20 §8），Human 侧处置次序；
      //   · `direction_key`——Norm 方向键（27 §8），本身即唯一性键；
      //   · `relations`——`{relation_key, target:{object_uid}}` 边（03 §7.2）；
      //   · `refs`——关联引用型字段（03 §7.2 / 20 §8）；
      //   · `occurrence`——`{count, first_at, last_at}`（26 §8）；
      //   · `attribution`／`attribution_ref`——归因聚合键（26 §8/§11）。
      // 只归一成**可比较的原语**，不做语义判断（那是 34 §8.1 第 2 项的事）。
      const relations = Array.isArray(fm.relations) ? fm.relations : [];
      const relationKeys = [];
      const relationTargets = [];
      // **成对保留**（2026-10-31）：关系展开（F4）需要知道「哪条边的目标是谁」，
      // 而原有的 `relationKeys`/`relationTargets` 是两个平行数组，配对信息已丢。
      // 这里只存**对象型目标**（`object_uid` / 裸字符串）：证据型 `{commit}`
      // 无法解析成对象，不进入展开候选（它会由「目标不可解析」如实报出）。
      const relationEdges = [];
      for (const rel of relations) {
        if (rel === null || typeof rel !== "object") continue;
        const key = textField(rel.relation_key);
        if (key !== "") relationKeys.push(key);
        // 目标三种承载形态（03 §7.2）：`object_uid` 对象型、`{commit}` 证据型、
        // 裸字符串（存量兼容）。全部归一成字符串，供「按目标反查」使用。
        const target = rel.target;
        if (target !== null && typeof target === "object") {
          const uid = textField(target.object_uid);
          const commit = textField(target.commit);
          if (uid !== "") {
            relationTargets.push(uid);
            if (key !== "") relationEdges.push({ relationKey: key, targetUid: uid });
          }
          if (commit !== "") relationTargets.push(commit);
        } else if (typeof target === "string" && target.trim() !== "") {
          relationTargets.push(target.trim());
          if (key !== "") relationEdges.push({ relationKey: key, targetUid: target.trim() });
        }
      }
      const refs = Array.isArray(fm.refs) ? fm.refs : [];
      const refTargets = refs
        .map((r) => (r !== null && typeof r === "object" ? textField(r.object_uid) : textField(r)))
        .filter((r) => r !== "");
      const occurrence = fm.occurrence !== null && typeof fm.occurrence === "object"
        ? fm.occurrence : null;
      // `gate_1`（21 §8/§14）：Gate 1 批准后由 Code 盖戳，`approved_at` 存在
      // 即「已过 Gate 1 授权」。这是工单「open 且在办」与「open 但待批」的
      // 分界，卡上必须能看见（此前完全未读，读者无法从候选卡区分）。
      const gate1ApprovedAt = fm.gate_1 !== null && typeof fm.gate_1 === "object"
        ? textField(fm.gate_1.approved_at) : "";
      // **结构化摘录源**：块标量残留一律视为无内容（`textField` 的判据），
      // 否则候选卡会显示 `↳ |-`（2026-10-29 前实测 46 条如此）。
      // **回退链按类型各自的语义字段取值**（Human 2026-11-11）：
      // `recall_digest` 已从事实源退场，摘录不再有跨类型统一的首选字段，
      // 而是沿本表逐项回退——它们分别是各类型的结论/现象/问题/适用范围。
      const excerptSource =
        textField(fm.summary) || textField(fm.gist) || textField(fm.decision)
        || textField(fm.phenomenon) || textField(fm.research_question)
        || textField(fm.scope) || textField(fm.scope_boundary) || "";
      // 类型名直接取 frontmatter 的 fact_type_key（权威），不从目录名猜单复数——
      // 「researches→research」这类英文变形易错（曾得 "researche"/"workca"）。
      const type = textField(fm.fact_type_key) || dir.replace(/s$/, "");
      // ── 机器判据（02 §12.4）────────────────────────────────────────────
      // `criteriaEntry` 为 `null` 表示该类型的判据表**不可用**（缺表/非法/类型
      // 未登记）：按 partial 口径停用机器判据，而不是猜一套默认字段。
      const criteriaEntry = criteria?.byType?.get(type) ?? null;
      const criteriaErrors = criteriaEntry === null
        ? (criteria?.errors ?? [])
          .filter((error) => error.type === type)
          .map((error) => error.message ?? error.code ?? "判据表不可用")
        : [];
      // **「表坏了」与「表里没写这个类型」必须分开**（2026-11）。两者都导致
      // 该类型的类型点名／核心语义字段／关系展开不可用（`detail` 空、`typeNames`
      // 空），但原因与处置不同：前者是判据表解析失败，须如实报错并停用；
      // 后者是**该类型还没有规范**，须回落具名兜底并在披露里说明不是表损坏。
      // 混成一个 `disabled` 会让读者把「没写」读成「坏了」（反之亦然）。
      const criteriaBroken = criteriaEntry === null
        && (criteria?.errors ?? []).some((error) => error.type === type);
      // **类型点名闭集**（②）：`fact_type_key` 派生词（单数/复数，大小写不敏感
      // 整词）∪ 判据表「类型词别名」白名单。**不含任何开放词表**——历史回归
      // 正是开放词表（`agent` 让 4 条调研冲顶）。判据不可用时集合为空，
      // 该类型不走类型点名通道。
      const typeNames = criteriaEntry === null ? [] : [...new Set([
        ...typeKeyDerivedWords(type).map((word) => word.toLowerCase()),
        ...criteriaEntry.values.typeAliases.map((word) => word.toLowerCase()),
      ])];
      out.push({
        source: "fact",
        type,
        dir,
        ref: textField(fm.object_uid) || file.replace(/\.md$/, ""),
        // **稳定引用**（`34 §8.2` 第 2、4 项）：完整 `object_uid`，可直达 F3
        // （`ldvh_*_read` 的 `object_uid` 参数）。
        // **缺失时给 null，不退回文件名**——`ref` 的退回语义是为内部去重与关系
        // 反查保留的；把文件名当 object_uid 交给读者，工具侧解析不到，等于给了
        // 一个看起来可用、实际取不到的入口（`34 §8.2` 要求「可直达」）。
        objectUid: textField(fm.object_uid) || null,
        title: textField(fm.title),
        status: textField(fm.status),
        scope: textField(fm.scope) || textField(fm.scope_boundary),
        // ── 核心语义字段（02 §12.4「核心语义字段」行）────────────────────
        // 逐类型取判据表列出的 frontmatter 字段，**不再把全部类型字段压平**。
        // 依据（2026-10-31）：压平会让 A 类型的字段词命中 B 类型的候选（例如
        // `decision` 对 friction 也生效），字段结构没有进入路由与触发。
        //
        // `trigger_signal` **恒在**匹配面（`23 §8`「重新审视信号」）：它是字段
        // 语义的一部分。设计 ③「触发信号字面重合」标注层经真实评测集探针实测
        // 0/65 行触发（2026-10-31），按拍板④「按实测命中率决定做不做」**暂缓**，
        // 未随本次交付；`trigger_signal` 留在匹配面的行为不受影响。
        // 判据不可用的类型连它也一并停用——整个字段语义通道关闭。
        // **匹配面的字段来源唯一化**（Human 2026-11-11）：`recall_digest` 已退场，
        // 故本层只剩两类字段——各类型规范召回到判据表登记的 `coreFields`（按类型
        // 各不相同，这是设计本意），以及恒在的通用信号字段 `trigger_signal`。
        // 不再有「跨类型统一关键词面」这一层。
        detail: criteriaEntry === null ? "" : [
          ...criteriaEntry.values.coreFields.map((field) => coreFieldTextOf(fm, field)),
          textField(fm.trigger_signal),
        ].filter((value) => value !== "").join(" "),
        // 供 `matchCandidate` 的类型点名通道与 `recallForAction` 的披露使用。
        typeNames,
        // `machineCriteria` 三态：`ok`（表可用）／`disabled`（**表坏了**，须如实
        // 报错并停用）／`missing`（**表里没有该类型条目**，该类型还没规范：
        // 同样停用机器判据，但归因不同、披露语不同，且默认候选状态回落兜底）。
        machineCriteria: criteriaEntry !== null ? "ok" : (criteriaBroken ? "disabled" : "missing"),
        criteriaError: criteriaErrors,
        trigger: textField(fm.trigger_signal),
        summary: textField(fm.summary),
        // ── 结构维度（供 `matchCandidate` 的结构命中层与候选卡使用）──────
        structural: {
          serves: textField(fm.serves),
          priority: textField(fm.priority),
          directionKey: textField(fm.direction_key),
          disposition: textField(fm.disposition),
          outcome: textField(fm.outcome),
          stoppingReason: textField(fm.stopping_reason),
          attribution: textField(fm.attribution),
          attributionRef: textField(
            fm.attribution_ref !== null && typeof fm.attribution_ref === "object"
              ? fm.attribution_ref.object_uid : fm.attribution_ref,
          ),
          occurrenceCount: occurrence !== null && Number.isInteger(occurrence.count)
            ? occurrence.count : null,
          relationKeys,
          relationTargets,
          relationEdges,
          refTargets,
        },
        // 载体自身可读性：YAML 解析失败时如实带出，由调用方披露（不静默）。
        yamlError,
        // Gate 1 批准时刻（空串=未过 Gate 1），见 `structuralCardOf`。
        gate1ApprovedAt,
        // **最后更新时间**（`created_at` 与 `change_log[].at` 取最大）：
        // 供排序作次级键、并让读者在候选卡上就看见「这条有多旧」。
        // 取不到时为空串——**不伪造当前时间**（那会让旧对象冒充新对象）。
        updatedAt: updatedAtOf(fm),
        // **F2「有界确定性摘录」的来源**（`02 §9.1`）：按类型取最能代表内容的短字段。
        //   · spark → summary（20：完整的当前语义快照）
        //   · workcase → gist（21：给 Human 扫读的一句话要点）
        //   · adr → decision（22：单句决策）
        //   · friction → phenomenon（26：单句现象陈述）
        //   · research → research_question
        //   · pitfall → scope（23：六要素住正文，frontmatter 只有 scope/trigger_signal）
        //   · norm/goal → 无长文本字段，退回 title（不在此处，见卡片层兜底）
        excerptSource,
        path: `ldvh-base/${dir}/${file}`,
        absolutePath: join(baseDir, dir, file),
        body,
        fullText,
      });
  }
  return out;
  }, {
    skipTopLevelFiles: true,
    cacheSalt: criteria === null ? "criteria-unavailable" : `criteria:${criteria.fingerprint}`,
  });
}

// ---------------------------------------------------------------------------
// 分层布尔匹配
// ---------------------------------------------------------------------------

/** 四层：命中越精确的字段，层号越前。只排序，不打分。 */
export const MATCH_TIERS = Object.freeze([
  { tier: 0, field: "specId", label: "规范编号命中" },
  { tier: 1, field: "scope", label: "适用范围命中" },
  { tier: 2, field: "detail", label: "类型正文命中" },
  { tier: 3, field: "title", label: "标题命中" },
  { tier: 4, field: "body", label: "正文片段命中" },
]);

/**
 * **结构命中层**（2026-10-29 新增）：按 frontmatter 的**结构化字段值**命中。
 *
 * ── 为什么必须有这一层 ──────────────────────────────────────────────
 *
 * 本模块此前只做文本匹配，所有结构字段（serves/priority/relations/
 * direction_key）要么没读、要么被拼进 `detail` 当一段等权文本。后果是
 * **查询里的结构化指称无法工作**（2026-10-29 实测，改动前）：
 *
 *   · 贴完整 `object_uid` → **0 命中**（`02 §9.1` F2 明列「稳定引用」为命中维度）；
 *   · 查 `P0`/`P1` → **0 命中**（库内 15 条 P1）；
 *   · 查 `heavy` → 只回 1 条，且是正文恰好含该词的别条（库内 10 条 heavy 全是终态；
 *     `impact` 字段已于 2026-11-02 撤销，此行留作当时的实测记录）；
 *   · 查 `serves=SG-1` → 3 条，其中 1 条 serves 是 SG-2（靠正文蹭上），
 *     而真正声明 SG-1 的有 47 条；
 *   · 按 `relation_key` 值查 → 0 命中（49 条对象带 relations）。
 *
 * 这些**不是新能力**：`02 §9.1` F2 的原文是「按类型、状态、稳定引用、关系、
 * locator 或类型允许字段命中的候选卡」；20 §12／21 §13／24 §244／26 §12／27 §9
 * 也各自写明了本类型的命中维度。条文已写、实现未落。
 *
 * ── 为什么它不违反「不得用关键词权重裁决相关性」（02 §9 红线）──────────
 *
 * 本层判据是**整词相等**（`SG-1` 与 `SG-1`、`P1` 与 `P1`、uid 与 uid），
 * 不是相似度、不是 embedding、不是加权分数。它与既有 tier 0（规范编号整词命中）
 * 同一形态、同一条红线下的同一个豁免：**相等的判定是可复算的确定性事实**。
 * 排序上它取 `tier: 0`——最精确层，与「用户点名了某个编号」同级。
 *
 * ── 为什么字段间不分高下 ────────────────────────────────────────────
 *
 * 一个 token 命中 `serves` 与命中 `priority` 都是「命中了一个结构化字段」，
 * 再在它们之间排序就需要人为权重——那才真正越线。故同层并列，命中理由里
 * **逐一写明命中了哪个字段**，由读者判断该命中有多强。
 *
 * ── 与候选卡的关系 ─────────────────────────────────────────────────
 *
 * 结构命中**只**产生候选（`34 §8.1` 第 1 项），**不**产生适用结论
 * （`34 §13`「召回的命中不等于适用」）。命中 `priority=P1` 只说明这条的
 * 档位是 P1，不说明它对应你这次要改的东西。
 */

/**
 * **纯指称查询**的实义词上限（2026-10-29）。
 *
 * 查询里的实义词（长度≥2、非虚词、非通用词）不超过这个数时，视为
 * 「整句就是一个标识」（`SG-1`、`P1`、一个 uid、`heavy`）——此时结构命中
 * 是查询的**主题**，可取最高层。
 *
 * 取值 1 的依据（实测）：纯指称查询恒为 1 个实义词；带主题的查询实测 5–7
 * （「召回排序的改进 P1」= 5，「把 SG-1 相关的召回排序改进」= 7）。
 * 留到 2 是为了容忍「uid 后面跟一个修饰词」这类短查询，不必精确卡在 1。
 *
 * **超过该值时结构命中降为 `STRUCTURAL_DEFERRED_TIER`**——它仍构成候选，
 * 只是不抢占排序优势。这个区分修的是初版的一个真实回归：夹带结构值时
 * 无关对象会压掉真正相关的条目（实测 4 条探针里 2 条目标被挤出 top3）。
 */
export const STRUCTURAL_BARE_QUERY_MAX_TOKENS = 2;

/**
 * 结构命中在**带主题的查询**里所取的层号。
 *
 * 取 5——比正文层（4）更低，即「结构值只是顺带出现，不构成任何排序优势」。
 * 为什么不是不返回：它确实是一个确定性命中（该对象的 priority 真是 P1），
 * 把它整个丢掉会让「为什么这条没出现」缺少解释（`34 §12` 的未检查范围
 * 要求逐类对应）。故保留候选、让出席位、并在命中理由里写明「不占优先位」。
 */
export const STRUCTURAL_DEFERRED_TIER = 5;

export const STRUCTURAL_MATCH_FIELDS = Object.freeze([
  "object_uid",
  "serves",
  "priority",
  "direction_key",
  "disposition",
  "outcome",
  "relation_key",
  "relation_target",
  "refs_target",
]);

/**
 * `object_uid` **短指称**的标识长度（2026-11-02）。
 *
 * 取 `object_uid` 的前 8 位。**为什么要补这一档（实测）**：本仓语料里
 * 「类型短名 + 前 8 位」这一形态出现 **726 次、去重 186 个对象**
 * （friction 236、workcase 165、spark 124、research 101、pitfall 86、
 * adr 7、norm 6、goal 1）——这是人和 AI 实际写出来的指称形态。
 * 而改造前的结构层**只认完整 36 位 uid**，于是最常用的那种写法恰好查不到：
 * `adr-62d3e2d8` 与裸 `62d3e2d8` 均 0 命中，只有
 * `62d3e2d8-7202-4e13-902e-788ec4bca9ed` 才行。
 *
 * **为什么不是「子串匹配」**：只认**整词恰好等于**「8 位十六进制」或
 * 「类型短名-8 位十六进制」这两种写法。`SG-1` 不命中 `SG-10` 的判据
 * （整值相等）在字段值上原样保留；这一档只把 `object_uid` **这一个字段**的
 * 可接受书写形态从 1 种扩到 3 种，不改变比较方式，也不扩到任何其它字段。
 *
 * **已知边界（如实声明，不主张零风险）**：裸 8 位形态无机械能力区分
 * 「指代对象」与「恰好长得像某对象前缀的其它十六进制串」（如 Git 短提交号）。
 * 实测本仓语料出现的裸 8 位值 288 个，其中 155 个不是任何对象 uid 的前缀
 * （4 个是 Git 提交号、151 个是历史标识或编号），且当前**零前缀碰撞**——
 * 但那是语料现状，不是结构性保证。碰撞真发生时，两个对象会被同一次查询
 * 一并命中，并各自在命中理由里写明命中的是哪种写法，读者可据完整 uid 分辨
 * （`02 §9.1` F2 只要求候选**可筛选**，不要求候选唯一）。
 */
export const SHORT_REF_LENGTH = 8;

/**
 * **短形态命中时附在命中理由末尾的碰撞边界声明**（`34 §8.2`）。
 *
 * 规范要求（逐字）：「实现接受短形态时须同时声明其已知边界：短形态存在前缀
 * 碰撞的可能，碰撞时同一次查询会一并命中多个对象——这属于「候选可筛选」而非
 * 「候选唯一」…实现不得据短形态命中声称该指称无歧义。」
 *
 * `34 §14` 把「候选卡的命中理由原文」列为该条的**可接受依据**——所以声明必须
 * 落在**命中理由里**，只写在源码注释里不算兑现（此前正是这种状态：注释里有、
 * 候选卡上没有）。
 *
 * 措辞同时点明三件事：①短形态是**被接受的一种书写形态**（不是残缺或错误）；
 * ②可能存在前缀碰撞；③碰撞时是「可筛选」而非「唯一」——即读者不得据此断言
 * 指代无歧义。
 */
export const SHORT_FORM_COLLISION_CAVEAT =
  "｜短形态边界：短标识与「类型短名+短标识」只是被接受的书写形态，存在前缀碰撞可能；" +
  "碰撞时同一次查询会一并命中多个对象，属候选可筛选而非指称唯一，不得据此断言该指称无歧义";

/** 完整 `object_uid` 的形态判据——只用于判断「该候选能否提供短形态」，不做合法性校验。 */
// 大小写不敏感：`02 §7.1` 规定的是 canonical UUIDv4 小写文本，但**本判据只决定
// 「能否派生短形态」**，不承担合法性校验（合法性由各类型 writer 的 uid 校验负责）。
// 若这里也严格到只认小写，一个大小写异常的旧对象会「完整 uid 能命中、短形态却
// 派生不出」——同一对象两种写法的支持面不一致，那才是更难解释的状态。
// **故意不校验版本位 4**：仓库存在 v4 遗留对象，它们同样需要短形态命中；
// 本判据的用途是字符串派生，不是 UUID 版本验证。
const FULL_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 判定一个候选的**结构字段**是否被查询 token 整词点名。
 *
 * @param {string[]} actionTokens 已小写化的查询 token
 * @param {object} candidate 载入的候选（`structural` 由 `loadFacts` 提供）
 * @returns {{field: string, value: string}[]} 命中的 (字段, 值) 对；空数组=未命中
 */
export function structuralHits(actionTokens, candidate) {
  const s = candidate?.structural;
  if (s === null || typeof s !== "object") return [];
  const tokens = new Set(actionTokens);
  const hits = [];
  // `form` 只在「同一字段有多种被接受的书写形态」时给出（目前仅 `object_uid`）。
  // 它进命中理由（`34 §8.2`「须写明命中的是哪一种形态」）——**不依赖读者拿卡片上
  // 的完整 ref 去和理由里的串做长度比对**来反推形态，那样义务就有了隐含前提。
  const add = (field, value, form) => {
    if (typeof value !== "string" || value === "") return;
    // 整词相等（小写比较）。**不认子串**：`p1` 不应命中 `p10`，`sg-1` 不应命中 `sg-10`。
    if (tokens.has(value.toLowerCase())) {
      if (form === undefined) hits.push({ field, value });
      else hits.push({ field, value, form });
    }
  };
  // `object_uid`：`02 §9.1` F2 明列的「稳定引用」——贴一条 uid 是最精确的指称。
  //
  // **三种书写形态都认**（2026-11-02，见 `SHORT_REF_LENGTH` 的实测依据）：
  // 完整 36 位、前 8 位、`类型短名-前8位`。三者都是**整词相等**——差别不在此
  // 而在于「被接受的书写形态」有三种，见 `34 §8.2` 对这两种性质的区分。
  const ref = candidate.ref;
  add("object_uid", ref, "完整标识");
  if (typeof ref === "string" && FULL_UID_PATTERN.test(ref)) {
    const short = ref.slice(0, SHORT_REF_LENGTH).toLowerCase();
    add("object_uid", short, "短标识");
    // 类型短名取自候选自身的 `type`（`fact_type_key` 派生），不在本函数里
    // 重新推导类型——那是判据表的事，这里只拼字符串。
    if (typeof candidate.type === "string" && candidate.type !== "") {
      add("object_uid", `${candidate.type}-${short}`, "类型短名+短标识");
    }
  }
  add("serves", s.serves);
  add("priority", s.priority);
  add("direction_key", s.directionKey);
  add("disposition", s.disposition);
  add("outcome", s.outcome);
  // 关系边：key 与 target 都算（「哪些对象声明了 informs」「指向 X 的边有哪些」）。
  for (const key of s.relationKeys ?? []) add("relation_key", key);
  for (const target of s.relationTargets ?? []) add("relation_target", target);
  for (const target of s.refTargets ?? []) add("refs_target", target);
  // **同一个字段多个值只报一次**（如三条 relations 都是 informs）。
  const seen = new Set();
  return hits.filter((h) => {
    const k = `${h.field}\u0000${h.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 计算某个候选集合内各 token 的**文档频率**（出现该 token 的候选数）。
 *
 * 用途：过滤「几乎出现在每一份候选里」的 token。实测（2026-10-24，27 份规范）：
 * 规范 scope 字段中「定义」27/27 = 100%、「适用」26/27 = 96%、「用于」26/27 = 96%
 * ——它们命中**任何**查询，是召回噪声的主要来源。
 *
 * **为什么是按源分算而不是全量算**：同一 token 在两个源里的区分度不同。
 * 跨全量看「规范」只占约七成，但在规范源内部它同时出现在近半数的 scope 里。
 * 用全局阈值会把「在事实源里很有区分度」的词一并削弱，故按集合分算。
 *
 * **此处曾写「跨全量（337 条）看『规范』只占 27%」——那个数字与当时的实测相反，
 * 已删（friction-943940d6）**：2026-11-04 实测总语料 360 条（事实 331 + 规范 29），
 * 含「规范」二字的候选 247 条 = 69%，不是 27%。原注记的「27%」很可能是把
 * 「规范侧 27/27」误抄成了分母。**这一类「写进注释的实测数字」的问题不在写错
 * 本身，而在于它没有任何判据守护**——测试不读它，故它会静默过时或写错。故本处
 * 不再写具体条数，只写方向（「约七成」）；要精确值请当场复算，勿引用注释。
 *
 * **这不是权重、不是学习参数**：它只产生一个**布尔保留/丢弃**，不参与排序打分的
 * 数值运算。阈值是固定常量，可复算（同一集合、同一公式）。
 */
/** BM25 参数（Lucene 经典默认；冻结常量，调整即需重测并更新注释数字）。 */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/** 语料统计形状守卫：缺失时退回纯计数（单元测试直接调 matchCandidate 的路径）。 */
function isCorpusStats(v) {
  return v !== null && typeof v === "object"
    && v.docFreq instanceof Map && Number.isFinite(v.total) && Number.isFinite(v.avgdl) && v.avgdl > 0;
}

/**
 * 由候选集算出 BM25 需要的语料统计（N、df 表、平均文档长度）。
 *
 * **token 来源**：`tokenSetOf(c).wide`（缓存的段内 token 之并），
 * 与「窄面 = scope+detail+title、全匹配面 = 再加 body」的口径一致——
 * 见「语料 token 缓存」节里关于 `tokenize` 段内性的实测（602 组对照零差异）。
 */
function corpusStatsOf(list) {
  const docFreq = new Map();
  let total = 0;
  let tokenSum = 0;
  for (const c of list) {
    const toks = tokenSetOf(c).wide;
    total += 1;
    tokenSum += toks.size;
    for (const t of toks) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  return { docFreq, total, avgdl: Math.max(1, tokenSum / Math.max(1, total)) };
}

export const HIGH_DF_RATIO = 0.6;

/**
 * 由候选集算出**两口径**的文档频率表（窄面 / 全匹配面）。
 *
 * **窄面**（scope+detail+title）——判「这个词在**这条讲什么**的自述里是否普遍」；
 * **全匹配面**（scope+detail+title+body）——判「它在真实匹配面上是否普遍」。
 * 两者都普遍才算噪声（见 `isTooCommon`）。
 *
 * token 取自 `tokenSetOf(c)`（缓存的段内 token 之并）——口径与上面两行
 * 声明的段集合一致，见「语料 token 缓存」节里 `tokenize` 段内性的实测。
 */
function docFreqOfImpl(list) {
  const narrow = new Map();
  const wide = new Map();
  for (const c of list) {
    const tokens = tokenSetOf(c);
    for (const token of tokens.narrow) narrow.set(token, (narrow.get(token) ?? 0) + 1);
    for (const token of tokens.wide) wide.set(token, (wide.get(token) ?? 0) + 1);
  }
  return { narrow, wide, total: list.length };
}

/**
 * **语料级统计的跨调用缓存**（2026-10-31 加，模块作用域）。
 *
 * `docFreqOf` 与 `corpusStatsOf` 的输入只依赖 list 的**成员**，而成员在语料
 * 未变时是同一批对象（解析结果按内容指纹缓存，见 `cachedCorpus`）。
 *
 * **缓存键用「成员签名」而非 list 身份**：调用方传给 `collect` 的 list 是
 * **过滤后**的数组（每次调用都是新数组，身份不稳定），故用
 * 「成员路径 + 内容指纹」的连接串作键——同一批成员恒得同一键。
 * 签名只遍历成员一次（274 次取值），比重算 df（274 × 数百 token 的
 * Map 更新）便宜两个数量级。
 *
 * 内容指纹进键 → 内容变化必然换键（语料一改，解析结果换新对象，成员指纹
 * 随之变化）。故**不存在陈旧读**。
 *
 * **为什么放模块作用域**：放在 `recallForAction` 内部则每次调用都重建缓存，
 * 一次调用内的两次 `collect`（规范侧 + 事实侧）能命中，但**跨调用不命中**——
 * 而测试与运行时的主要成本正是跨调用的重复计算。
 */
const CORPUS_DF_CACHE = new Map();
const CORPUS_STATS_CACHE = new Map();

/**
 * **成员签名：路径 + 内容指纹。内容一变，签名必变。**
 *
 * 成员指纹已按对象缓存（`contentFingerprintOfCached`），故签名只做拼接。
 *
 * 签名本身也缓存：以「首个成员对象 + 长度」为键——同一批成员的首成员必是
 * 同一对象（语料未变则解析结果未变、成员对象未换），长度相同即同批。
 * 语料一变 → 解析结果换新对象 → 首成员换了 → 缓存不命中 → 重算签名。
 */
const SIGNATURE_CACHE = new WeakMap();

function memberSignatureOf(list) {
  const first = list.length === 0 ? null : list[0];
  if (first === null) return "";
  const cached = SIGNATURE_CACHE.get(first);
  if (cached !== undefined && cached.size === list.length) return cached.value;
  const value = list
    .map((c) => `${c.path}\0${contentFingerprintOfCached(c.fullText ?? c.text ?? "", c).value}`)
    .join("\0");
  SIGNATURE_CACHE.set(first, { size: list.length, value });
  return value;
}

function cachedDocFreqOf(list) {
  const key = memberSignatureOf(list);
  const hit = CORPUS_DF_CACHE.get(key);
  if (hit !== undefined) return hit;
  const computed = docFreqOfImpl(list);
  CORPUS_DF_CACHE.set(key, computed);
  return computed;
}

function cachedCorpusStatsOf(list) {
  const key = memberSignatureOf(list);
  const hit = CORPUS_STATS_CACHE.get(key);
  if (hit !== undefined) return hit;
  const computed = corpusStatsOf(list);
  CORPUS_STATS_CACHE.set(key, computed);
  return computed;
}

/** 一个 token 在该集合中是否过于普遍（出现在 ≥ `HIGH_DF_RATIO` 比例的候选里）。 */
function isTooCommon(token, docFreq, total) {
  if (total < 4) return false; // 样本太小，比例不可靠，不丢任何词
  // 两口径判据（2026-10-27）：`docFreq` 现为 `{narrow, wide, total}`。
  // 判「噪声」的条件是**窄面也普遍**——窄面（scope/detail/title）是「这条讲什么」
  // 的自述，一个词若在人写的自述里就普遍出现，它必然泛。
  // 若只有全匹配面普遍（如 `workcase`：窄面低、正文 74%），它是**主题词**，
  // 只是正文反复提及——必须保留，否则类型点名层失效（实测反例）。
  const narrow = docFreq?.narrow;
  if (narrow instanceof Map) {
    return (narrow.get(token) ?? 0) / total >= HIGH_DF_RATIO;
  }
  // 兼容旧签名（Map 直接传入）——防御性分支，正常路径不会走到。
  return (docFreq?.get?.(token) ?? 0) / total >= HIGH_DF_RATIO;
}

/**
 * 判定一个候选与动作的相关层。
 *
 * @param {string[]} actionTokens 动作描述的 token
 * @param {object} candidate 载入的候选
 * @returns {{tier: number, hitReason: string} | null} 无关则 null
 */
const CJK_CHAR = /[\u3400-\u9fff]/;

/**
 * **类型点名闭集判据**（②，2026-10-31）。
 *
 * 类型词集合 = `fact_type_key` 派生词（单数/复数，ASCII 大小写不敏感整词）
 * ∪ 判据表「类型词别名」白名单（02 §12.4）。返回命中的词，未命中返回 `null`。
 *
 * 两条**字面**规则：
 *   · ASCII 词：与查询 token **整词相等**（`adr` 不得命中 `adrenal`）；
 *   · 中文别名：查询原文**含完整别名**，且别名右侧**不紧接汉字**。
 *     右侧边界是必需的——「火花乙」里的「火花」是一个更长的对象名，把它读成
 *     「点名类型 spark」会让该类型全部对象同层并列，真正点名的那条被字典序挤掉。
 *     只做字面包含，不做分词近似（`alias.includes(token)` 会让「规范」二字
 *     点名 norm 类型，等于把开放词表请回来）。
 */
function closedSetTypeNameOf(candidate, actionTokens, queryText) {
  const names = candidate.typeNames;
  if (!Array.isArray(names) || names.length === 0) return null;
  for (const token of actionTokens) {
    const lower = token.toLowerCase();
    if (lower === "") continue;
    if (CJK_CHAR.test(lower)) continue; // 中文别名走原文边界判定
    if (names.includes(lower)) return { name: lower, hit: token };
  }
  for (const name of names) {
    if (!CJK_CHAR.test(name)) continue;
    let index = queryText.indexOf(name);
    while (index !== -1) {
      const next = queryText[index + name.length] ?? "";
      if (!CJK_CHAR.test(next)) return { name, hit: name };
      index = queryText.indexOf(name, index + 1);
    }
  }
  return null;
}

export function matchCandidate(actionTokens, candidate, corpusStats, queryText = "") {
  // **编号层（tier 0）最优先**：`spec_id` 是规范的稳定编号，用户说「34 号规范」
  // 时点名的是它，不是标题里的字。此层不设会漏掉最精确的一种命中——实测缺陷：
  // 查询含「34」，但 34 号规范只能靠 scope 里的「规范」二字命中，与其它 18 份
  // 规范同层同分，被路径字典序挤到后面。
  // 只认**整词相等**（不认子串），避免「3」命中「34」、「1」命中「10」。
  // **结构命中与它同级**（2026-10-29）：二者都是「用户点名了一个标识」，
  // 只是规范侧点的是 spec_id、事实侧点的是 uid/serves/priority/…。
  // 规范侧没有 `structural`，故此处的 `?? []` 合法——不是把缺失当空，而是
  // 「这一侧没有这一类字段」。
  const structural = structuralHits(actionTokens, candidate);
  const specId = candidate.specId;
  if (typeof specId === "string" && specId !== "" && actionTokens.includes(specId)) {
    return { tier: 0, hits: 1, hitReason: `规范编号命中：${specId}` };
  }
  // **结构命中**：整词等于某个结构化字段值。与编号同级（tier 0）。
  //
  // 命中理由**逐字段写明**（`命中依据须可复算`，34 §8.2），且**只在理由里出现
  // 命中的字段名与值**——不写「相关」「匹配度高」这类结论（那是适用判断）。
  // `hits` 取命中字段数：同一查询同时点名 `serves=SG-1` 与 `priority=P1` 时
  // 比只点名一个的更具体，这是可复算的计数，不是权重。
  if (structural.length > 0) {
    const shown = structural
      .slice(0, 3)
      // 有 `form` 时括号内标注形态（`34 §8.2`「须写明命中的是哪一种形态」）。
      // 无 `form` 的字段（serves／priority 等闭集值）只有一种形态，
      // 不标注——标注一个恒定的「唯一形态」是噪声。
      .map((h) => (h.form === undefined
        ? `${h.field}=${h.value}`
        : `${h.field}=${h.value}（${h.form}）`))
      .join("、");
    // ── **结构命中能否占据最高层，取决于它是不是查询的主题** ─────────────
    //
    // **这是修一个我自己引入的回归**（2026-10-29，实测发现）：
    // 初版无条件返回 `tier: 0`，于是查询里**夹带**一个结构值时，那批
    // 「恰好 priority=P1 / serves=SG-1」的对象会以最精确层压过真正相关的条目。
    // 实测 4 条探针里 2 条目标被挤出 top3（改动前它们都正常）：
    //   · 「召回排序的改进 P1」→ 目标（讲召回排序的那条 spark）不在 top3，
    //     前三名全是 priority=P1 的无关项；
    //   · 「把 SG-1 相关的召回排序改进」→ 同上，前三名全是 serves=SG-1。
    //
    // 根因不是「结构值不该优先」，而是**没区分两种查询**：
    //   (a) **纯指称查询**——整句就是一个标识（`SG-1`、`P1`、一个 uid），
    //       用户要的就是「那个对象」，此时结构值即主题，取最高层正确；
    //   (b) **带主题的查询**——句子里有真正实义词（召回/排序/改进），
    //       结构值只是**限定词**，此时它不该压过主题证据。
    //
    // 判据用**实义词个数**（与 `matchCandidate` 的 `specific` 同源口径：
    // 长度 ≥2、非虚词、非通用词）。纯指称查询恒为 1（标识本身）；
    // 带主题的查询实测 5–7。故取宽松阈值 2——只有 ≤1 个实义词才算
    // 「整句就是一个标识」。
    //
    // **为什么用计数而不用权重**：计数是可复算的确定性事实，不引入 `02 §9`
    // 明禁的「关键词权重」。阈值是固定常量，同一查询恒得同一结论。
    const subjectTokens = actionTokens.filter(
      (t) => t.length >= 2 && !isWeakToken(t) && !GENERIC_TOKENS.has(t),
    );
    const isBareReference = subjectTokens.length <= STRUCTURAL_BARE_QUERY_MAX_TOKENS;
    // ── **短形态的前缀碰撞边界声明**（`34 §8.2`，2026-11）───────────────
    //
    // 规范原文：「实现接受短形态时须同时声明其已知边界：短形态存在前缀碰撞的
    // 可能，碰撞时同一次查询会一并命中多个对象——这属于「候选可筛选」而非
    // 「候选唯一」…实现不得据短形态命中声称该指称无歧义。」
    //
    // 判据是「**短形态是否落在该候选被接受的书写形态集合里**」，而**不是**
    // 「短形态是否出现在命中理由的展示前三项里」——后者不可判定：`shown` 只取
    // `structural.slice(0, 3)`，短形态排在第四位以后就不展示，声明随之消失，
    // 于是同一次命中「披露与否」取决于字段顺序这种无关因素。实测语料里
    // 「类型短名+8 位」出现 726 次、去重 186 个对象，同时命中多个结构字段的
    // 候选并不罕见，这个差异是可观察的。
    //
    // 声明挂在理由末尾而非某个字段后面：它是**整个命中依据的性质**（短形态
    // 不唯一），不是某一个字段的性质。
    const hasShortForm = structural.some(
      (h) => h.form === "短标识" || h.form === "类型短名+短标识",
    );
    const shortFormCaveat = hasShortForm ? SHORT_FORM_COLLISION_CAVEAT : "";
    return {
      // 纯指称 → 最高层（它就是主题）；带主题 → 让位到最末层（不占排序优势，
      // 但仍**构成候选**并在理由里标出——它不是被丢弃，只是不抢先）。
      tier: isBareReference ? 0 : STRUCTURAL_DEFERRED_TIER,
      hits: structural.length,
      hitReason: (isBareReference
        ? `结构命中：${shown}${structural.length > 3 ? " 等" : ""}`
        // 带主题时必须说明它**为什么没有优先**，否则读者会以为这是普通文本命中。
        : `结构命中（查询有其它主题词，不占优先位）：${shown}${structural.length > 3 ? " 等" : ""}`)
        + shortFormCaveat,
      structuralFields: [...new Set(structural.map((h) => h.field))],
      // 供 `recallForAction` 判定「精确引用路径」：只有**纯指称**命中结构字段
      // 才触发关系展开（F4）；带主题的查询不展开（见 `recallForAction`）。
      bareReference: isBareReference,
      // 短形态命中（供调用方与测试判定「这一条是否走了会被前缀碰撞影响的形态」，
      // 不必回头解析 hitReason 的文案）。
      shortForm: hasShortForm,
    };
  }

  // **事实侧类型点名（闭集，2026-10-31）**：让类型点名对**事实对象**生效。
  //
  // 类型词集合 = `fact_type_key` 派生词（`adr`/`adrs` 等，大小写不敏感整词）
  // ∪ 判据表「类型词别名」白名单（`22 §12.4`）。**禁止开放词表**——开放词表
  // 正是历史回归根因：查询里的 `agent` 让 4 条调研文档以「类型点名」冲顶，
  // 与「点名某个类型」毫无关系。闭集成员由判据表逐类型登记，可穷举、可审计。
  //
  // 裸指称口径与 `structuralHits` **完全同构**（实义词 ≤ 阈值）：纯指称查询
  // 给 tier 0.5（与规范侧类型点名同层），带主题的查询降到 `STRUCTURAL_DEFERRED_TIER`，
  // 只在没有更强证据时构成候选。不发明新的打分。
  let namingFallback = null;
  if (candidate.source === "fact") {
    const named = closedSetTypeNameOf(candidate, actionTokens, queryText);
    if (named !== null) {
      // 裸指称口径与 `structuralHits` 同源（长度 ≥2、非虚字、非通用词），
      // 但要**扣掉组成类型词本身的 token**：多字中文别名（决策记录→决策/策记/
      // 记录）会让整串点名被算成 3 个实义词，从而永远进不了裸指称档。
      const namingSubjectTokens = actionTokens.filter(
        (t) => t.length >= 2 && !isWeakToken(t) && !GENERIC_TOKENS.has(t)
          && !named.name.includes(t),
      );
      const namingBare = namingSubjectTokens.length <= STRUCTURAL_BARE_QUERY_MAX_TOKENS;
      if (namingBare) {
        return {
          tier: 0.5,
          hits: 1,
          hitReason: `类型点名命中：${named.hit}`,
          typeNamed: true,
          bareReference: true,
        };
      }
      // 带主题的查询**不抢先**：先按普通证据匹配（更具体的命中应当胜出），
      // 只有一层都不命中时才以「降级层」构成候选——与结构命中的
      // `STRUCTURAL_DEFERRED_TIER` 同口径，不是新的打分。
      namingFallback = {
        tier: STRUCTURAL_DEFERRED_TIER,
        hits: 1,
        hitReason: `类型点名命中（查询有其它主题词，不占优先位）：${named.hit}`,
        typeNamed: true,
        bareReference: false,
      };
    }
  }

  // **类型点名层（tier 0.5）**：用户说「写一个 WorkCase」「记一条 Spark」时，
  // 点名的是某个**事实类型**，最该命中该类型自己的规范。
  //
  // 实测缺陷（2026-10-24）：「写一个 WorkCase」的首位是 `Spark-火花` 而不是
  // `WorkCase 工单`——因为类型名会出现在多份规范的 scope 里（实测 workcase 命中
  // 6 份、adr/pitfall/spark 各 4 份），同层同分后只能按路径字典序，而 `20-Spark`
  // 排在 `21-WorkCase` 前面。
  //
  // 判据：查询的某 token **整词等于**本规范标题里出现的类型短名。标题形如
  // `WorkCase 工单`、`Spark-火花`、`ADR-决策`——取标题中 ASCII 词作为类型名，
  // 与查询 token 做**大小写无关的整词比较**（不认子串，避免 `adr` 命中 `adrenal`）。
  // 这是确定性事实（标题里有没有这个词），无权重、无 AI 判断。
  //
  // **事实侧另走闭集**（2026-10-31 修，见上）：本段仍只对规范生效，因为规范
  // 的类型名来自标题（`WorkCase 工单`），而事实的类型名只能来自判据表登记的
  // 闭集。历史回归的教训必须留在原处：2026-10-24 曾把标题词匹配直接套到事实，
  // 查询「install() 分发器在 agent/created 回调里…」的 token `agent` 让 4 条
  // Agent 调研文档以 `类型点名命中：agent` 冲顶，把真正相关的 Pitfall 挤出
  // limit。事实侧永远**不得**从标题/正文自由取词作类型名。
  if (candidate.source === "spec" && typeof candidate.title === "string") {
    // **注意尾部连字符**：`Spark-火花`、`ADR-决策` 这类标题里，贪婪匹配会把
    // 分隔用的 `-` 吞进词里（实测 `Pitfall-踩坑经验` 得到 `pitfall-`，
    // 导致与查询词 `pitfall` 永不相等）。故尾部连字符不算词的一部分。
    const titleTypeNames = (candidate.title.match(/[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/g) ?? []).map((w) => w.toLowerCase());
    if (titleTypeNames.length > 0) {
      const named = actionTokens.find((token) => titleTypeNames.includes(token.toLowerCase()));
      if (named !== undefined) {
        return { tier: 0.5, hits: 1, hitReason: `类型点名命中：${named}` };
      }
    }
  }
  // `minHits`：该层至少要命中几个词才算相关。
  //
  // **为什么正文层要 2 个**：正文有数千字，命中 1 个词几乎必然——实测查询
  // 「把 34 号规范改名成双源召回」在正文层命中 22 份规范，其中 17 份只命中
  // 1 个词（「改名」或「召回」）。而 scope/title/detail 是短字段，命中 1 个词
  // 即有区分度，故取 1。
  // **正文层门槛须随查询长度自适应**（2026-10-24 修）。
  //
  // 原为固定 `minHits: 2`，理由是抑制正文层噪声（实测 22 份命中里 17 份只命中
  // 1 个词）。但它把**短查询**一并挡死了：实测查询「代码」只有 1 个 token，
  // 而「代码」正是 `06-Code 实践与测试规范` 的核心词（正文出现 10 次）——该规范
  // 的 scope 与 title 都不含「代码」，只能靠正文层命中，于是 `specs=0`。
  //
  // 正确判据不是「要 2 个词」，而是「这 1 个词够不够特别」：
  //   · 查询只有 1 个 token 且**不是通用词** → 它本身就是明确主题，正文命中即算；
  //   · 查询有多个 token → 仍要求命中 ≥2（逐词命中越多越可能真相关）。
  // 通用词（`GENERIC_TOKENS`，如「任何/规范/执行」）即便查询只有一个也**不**
  // 放宽——那正是原阈值要挡的噪声。
  const singleStrongToken =
    actionTokens.length === 1 && !GENERIC_TOKENS.has(actionTokens[0]);
  const bodyMinHits = singleStrongToken ? 1 : 2;
  // **各 section 的 token 取自缓存**（`tokenSetOf`）——口径与
  // `tokenize(section.text)` 完全一致，见「语料 token 缓存」节的实测。
  const cachedTokens = tokenSetOf(candidate);
  const sections = [
    { tier: 1, text: candidate.scope, tokens: cachedTokens.scopeSet, label: "适用范围", minHits: 1 },
    { tier: 2, text: candidate.detail, tokens: cachedTokens.detailSet, label: "内容", minHits: 1 },
    { tier: 3, text: candidate.title, tokens: cachedTokens.titleSet, label: "标题", minHits: 1 },
    // 规范载入的是 `text`（全文）、事实载入的是 `body`（前 1200 字截断）。
    // 曾只读 `body`，导致**规范正文这一层从未参与匹配**——缺陷：查询
    // 「改 guidance-text.js 的引导文本」一条规范都命中不了，因为该文件名只
    // 出现在 00/10 的正文里，不在它们的 scope/positioning/title 里。
    // 规范用 `bodyText`（剥离 frontmatter），事实用 `body`（前 1200 字）。
    // 绝不能用 `candidate.text`——它含 YAML 字段名（见 loadSpecs 的说明）。
    { tier: 4, text: candidate.bodyText ?? candidate.body, tokens: cachedTokens.bodySet, label: "正文", minHits: bodyMinHits },
  ];
  let best = null;
  for (const section of sections) {
    if (typeof section.text !== "string" || section.text === "") continue;
    const hits = intersect(actionTokens, section.tokens);
    // **单字只作辅助，不单独构成命中依据。**
    //
    // 实测（2026-10-24，用本会话真实用户消息）：「把这批改动合入吧」10 条结果里
    // 5 条是纯单字命中——`WorkCase 工单` 靠「批」、`火花记录` 与 `双源召回` 靠「合」；
    // 「经验也要召回啊」有 4 条靠单字「回」命中。单个汉字在本语料里覆盖 50–70%
    // 的候选。
    //
    // **本行数字的判据已改为固定夹具**（2026-11-01，老丁 m00559 要求「断言前提随
    // 语料漂移须显式改为不依赖语料的固定夹具」）：「改」出现在 **2/8 = 25%** 的
    // `test/source-recall.test.mjs` **夹具载体**里，测试动态复算并与此处比对，
    // 故它不会随项目事实源增删而失效。真实语料 2026-11-01 实测为 290/310 = 94%
    // （规范侧 27/27、事实侧 263/283），历史注记 295/347、251/271、252/272、
    // 253/273、263/284、265/286、265/287、281/300、283/302、284/303、285/304、
    // 286/305 均已过时——事实源由宿主辅助任务与并行会话持续写入，该数字双向漂移，
    // 故**不再作为断言前提**（漂移是语料变化，不是实现退化）。
    // 「靠一个字命中」几乎等于没命中。
    //
    // 但单字**不能丢**：短指令「改一下／删了／加个」只有单字可切（第 16 轮修的
    // 就是这个）。故规则是——**单字只在「没有别的词命中」时才算数**：
    //   · 多字词至少命中一个 → 用多字词为准（单字附在后面仅供读者对照）；
    //   · 只有单字命中 → 仍然算命中（短指令路径不被破坏）。
    const strong = hits.filter((token) => token.length >= 2);
    const weak = hits.filter((token) => token.length === 1);
    // 通用词降级：多字但语义通用的词（任何/规范/执行…）不算强证据；
    // 若命中的**全是通用词**，则视为弱命中（与单字同档）。
    //
    // **跨词降级（2026-10-27）**：含虚字的二元组（「为什」「里不」）同样不算强证据。
    // 放宽 tokenizer 后这类词会成片出现，若不降级则「为什么这里不对」这类
    // 无主题句会被注入并命中无关对象——实测正是如此。并入同一档而非新立机制。
    const specific = strong.filter((token) => !GENERIC_TOKENS.has(token) && !isWeakToken(token));
    const decisive = specific.length > 0 ? specific : (strong.length > 0 ? strong : weak);
    if (decisive.length >= (section.minHits ?? 1)) {
      // 命中理由只列前 3 个词；若靠单字命中，明确标出「仅单字」，
      // 使读者知道这条的相关性弱，须自行核实。
      const shown = decisive.slice(0, 3).join("、");
      const onlyGenericOrWeak = specific.length === 0;
      const reason = onlyGenericOrWeak
        ? `${section.label}仅通用词/单字命中（相关性弱，须自行核实）：${shown}`
        : `${section.label}命中：${shown}`;
      // `weakHit` 必须带出供排序使用：此前它只体现在文字里，排序看不到，
      // 于是「tier 1 的弱命中」会排在「tier 4 的强命中」前面并挤掉它们
      // （实测：「把 34 号规范改名成双源召回」limit=3 时，2 个弱命中挤掉了
      // 随后 5 个强命中）。弱命中不是不相关，但它不该抢占强命中的名额。
      best = {
        tier: section.tier,
        matchTierMeaning:
          "匹配层（命中了哪个字段），非 F0–F4 事实分层、非 L0–L4 规范读取分层（02 §9.1）",
        hits: decisive.length,
        hitReason: reason,
        weakHit: onlyGenericOrWeak,
      };
      break; // 本层已达门槛即停止降层（tier 仍取最精确的命中层）
    }
  }
  if (best === null) return namingFallback;
  // ── 跨层累计命中面（2026-10-27 修正）─────────────────────────────────
  //
  // **缺陷**：原实现在首个达标的层就 `return`，即命中 tier 1（适用范围）后
  // **不再看正文层**。于是「命中几个词」只统计了最精确那一层的命中，把同一
  // 候选在其它层的命中全部丢掉。实测 `pitfall-daed4856`（新增判据未量测…）
  // 对查询「在 Git Gate 再加一条校验：header 必须带英文」全文命中 7 个词
  // （gate/header/一条/校验/提交/提/必须），却只被记为 `hits=1`——因为它在
  // tier 1 只命中「提交」一个。结果它与另外 3 条 hits=1 并列，最后按 **UUID
  // 字典序** 决定谁进 top-3，被挤出注入位（`adr-7ceaf7fc` < `pitfall-9665d624`
  // < `pitfall-a1b997d0` < `pitfall-daed4856`）。
  //
  // 排序据此判断「谁更相关」，而实际决定名次的是 UUID 字母序——这不是相关性
  // 判断，是伪随机。故把命中面改为**全部层累计**：`tier` 仍是「最精确的命中层」
  // （决定主排序键，语义不变），`hits` 改为「本次查询在该候选里一共命中几个
  // 实词」——它才是「这条候选与查询有多厚的字面交集」的真实度量。
  //
  // **为什么不改变 tier 语义**：`tier` 表达的是「命中最精确的字段」，用于把
  // 编号点名与适用范围命中排在正文泛命中之前，这个意图仍然成立。改的只是
  // 同一 tier 内怎么比——由「只看该层命中数」改为「看全候选的命中厚度」。
  const allHits = intersect(actionTokens, tokenSetOf(candidate).wide);
  const strongAll = allHits.filter((t) => t.length >= 2);
  const specificAll = strongAll.filter((t) => !GENERIC_TOKENS.has(t) && !isWeakToken(t));
  const contributing = specificAll.length > 0 ? specificAll : strongAll;
  // ── BM25 稀有度加权（2026-10-27，第 2 步）────────────────────────────
  //
  // **为什么需要**：跨层累计后 `hits` 是「命中几个词」的**计数**，等权。于是
  // 「一条」「提交」这类几乎出现在每份载体里的词，与「白屏」「daed4856」这类
  // 高度特异的词贡献相同。实测查询「在 Git Gate 再加一条校验：header 必须带
  // 英文」里，`契约语言要求…` 靠 git/gate/提交 三个常见词拿到 6 分，而真正
  // 该被看到的特异性命中被淹没。
  //
  // **用 IDF 加权而非新造权重**：Okapi BM25 的 idf = ln(1 + (N-df+0.5)/(df+0.5))
  // ——语料里越稀有贡献越大，是**从语料统计推出的量**，不含学习参数、不含
  // 人工调参，满足 02 §9「确定性、可复算、无学习参数」红线。同分时仍按
  // path 稳定排序，故同输入同输出。
  //
  // **实测更正（2026-10-27，独立审核中等项 3）：tf 饱和与长度归一实际是死代码。**
  // `tokenize()` 对同一段文本**返回去重后的集合**（内部用 Set），故同一候选里
  // 任何词只出现一次 → `tf` 恒为 1 → `(tf*(k1+1))/(tf+k1*(...))` 里 k1/b 的
  // 作用被抵消；且 `dl` 是「去重后的词表大小」而非文档长度。所以本式**不是**
  // 标准 Okapi BM25，只是「idf 加权求和」。它仍然可用：idf 是真实的语料统计量，
  // 排序在**同一源内**依然有效（跨源不可比，见 ranking.note）。
  // 保留 k1/b 的形式是为了将来若 tokenize 改为保留词频（返回带 tf 的结构）时
  // 公式仍是正确的——但**当前它们不产生任何效果，不得据此声称「实现了 BM25 饱和」**。
  //   · 没有语料统计时（`corpusStats` 缺省，如单元测试直接调 matchCandidate）
  //     退回纯计数——向后兼容，且使「有没有统计」不影响正确性只影响排序质量。
  // **`hits` 的语义随之从「计数」变成「IDF 加权的命中厚度」**，但它仍然
  // 只用于**同 tier 内的排序**，不参与「是否召回」的判断（第 3 步才处理
  // 决策分离），故 `minHits` 门槛仍用未加权的 `contributing.length` 判定。
  let breadth = contributing.length;
  let weighted = null;
  // **单字命中的分支一致性**（2026-10-27，独立审核中等项 4）：`contributing`
  // 只收 length>=2 的强词，故纯单字命中时它为空 → breadth=0。而 BM25 分支
  // 会给出 `weighted=0` 并覆盖 `best.hits`，无统计分支却保留原 `best.hits`（=1）
  // ——同一条候选、同一个词，两条路径给出 0 与 1。实测：
  //   matchCandidate(["改"], {scope:"改动字段"}, stats) → hits 0
  //   matchCandidate(["改"], {scope:"改动字段"})        → hits 1
  // 修法：加权值不得低于单字命中的基础分 1（单字命中有 1 的分量，只是弱）。
  const SINGLE_CHAR_BASE = 1;
  if (isCorpusStats(corpusStats)) {
    const docTokens = [...tokenSetOf(candidate).wide];
    const tf = new Map();
    for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);
    const dl = Math.max(1, docTokens.length);
    let sum = 0;
    for (const t of contributing) {
      const df = corpusStats.docFreq.get(t) ?? 0;
      const idf = Math.log(1 + (corpusStats.total - df + 0.5) / (df + 0.5));
      const tfv = Math.max(tf.get(t) ?? 0, 1);
      const sat = (tfv * (BM25_K1 + 1))
        / (tfv + BM25_K1 * (1 - BM25_B + BM25_B * dl / corpusStats.avgdl))
        / (BM25_K1 + 1);
      sum += idf * sat;
    }
    weighted = Math.round(sum * 1000) / 1000;
  }
  if (weighted !== null) {
    // **不得用 `Math.max(weighted, 1)` 抬平权重**（2026-10-27 修一个我引入的 bug）：
    // 那样会把所有「权重 < 1」的命中统统压成 1，**抹掉它们之间的区分度**。实测
    // 「提交被门禁拒绝了」里有 4 条同层命中，真实权重分别是 0.36/0.36/0.36/0.723，
    // 全被抬成 1 后完全并列，排序只能交给时间键——于是一条真正相关的旧 Pitfall
    // 被 3 条更新的弱相关项挤掉，质量基线精确率 10.8% → 9.2%。
    //
    // 正确做法：**权重 > 0 时如实保留**（区分度就在这里）；只有一条强词都没命中
    // （`weighted === 0`，纯单字/通用词命中）时，才用保底 1 表达「有命中分量」，
    // 且若同层已数出更多命中，保留那个更大的计数。
    best.hits = weighted > 0 ? weighted : Math.max(best.hits ?? 0, SINGLE_CHAR_BASE);
    // **理由必须极短**（2026-10-27，实测教训）：第一版写成
    // 「跨层命中 N 个词、BM25 加权 X（词1、词2…）」，命中理由从 20 字涨到 48 字，
    // 三条候选合计多出约 260 字节——在 2400 字节预算下**直接挤掉了事实段的摘录行**
    // （实测 `↳` 消失、事实源段渲染为空，集成用例变红）。词表本身已在
    // `hits` 与候选卡标题里可见，重复列出只占预算不增信息。
    // 现只保留计数与权重两个数：`·N词/W`。
    if (breadth > 1) best.hitReason = `${best.hitReason}·${breadth}词/${weighted}`;
  } else if (breadth > best.hits) {
    // 无语料统计时的旧路径：同样只补最短的计数。
    best.hits = breadth;
    if (breadth > 1) best.hitReason = `${best.hitReason}·${breadth}词`;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 召回入口
// ---------------------------------------------------------------------------

/**
 * 行动前召回：给一个动作描述，从两个源找出相关候选。
 *
 * @param {object} input
 * @param {string} input.action       动作描述（即将发生什么）
 * @param {string} [input.scope]      补充范围词（文件/对象/能力，34 §7 必需输入）
 * @param {string[]} [input.types]    只召回这些事实类型（adrs/norms/pitfalls/…）
 * @param {string[]} [input.excludeTypes] 这些类型**不属本次声明范围**（不形成候选，
 *   且**不使完整度降级**、不进 `excludedByTypeFilter`——它们不是「本次漏查」，
 *   而是由另一条路径承接）。注入路径用 `INJECTION_EXCLUDED_TYPES` 传入。
 * @param {string[]} [input.statuses] 默认 `["active"]`；写入前查重可加 `["open"]` 等该类型自己的候选态
 * @param {boolean} [input.includeSpecs] 是否召回规范源，默认 true
 * @param {number} [input.limit]     每侧最多返回条数，默认 5
 * @param {number} [input.budgetBytes] 返回内容的字节上限，默认 `RECALL_DIRECT_BYTE_BUDGET`
 *
 * @returns {{ok: true, specs, facts, truncated, budget, recalledAt}}
 *   或 `{ok:false, error}`。`truncated` 为 true 时如实说明被裁剪，不静默。
 *
 * ## 边界（34 §13）
 *
 * **召回的命中不等于适用。** 本函数只给候选与命中理由，不给「这条适用于本次行动」
 * 的结论。调用方须另行判定适用——那属 34 §8.1 第 2、3 项。
 */
/**
 * 命中去重后的**未返回集合**（按 path 差集，保序）。
 *
 * 为什么必须按 path 而不是按位置：交付侧会对命中列表重排与挑选
 * （`selectFactsBySection` 按类型分组、每类取前 N、再按总名额裁），
 * 于是「已交付」不是命中列表的前缀。用 `slice(kept.length)` 得到的
 * 「未列出」会包含已交付对象——那不只是数字偏大，而是**把交付过的对象
 * 谎报成没交付**（`34 §12` 要求取值与清单逐类对应）。
 *
 * 保序理由：读者按名次读「差在哪」，次序改变会让同一份结果两次读出不同清单。
 * 返回精简卡（title+path）的形态保持不变——渲染层与既有测试都按此形状读。
 *
 * @param {Array<object>} hits 全部命中（已排序）
 * @param {Array<object>} kept 实际交付的候选
 * @returns {Array<{title: string, path: string}>}
 */
function diffByPath(hits, kept) {
  const keptPaths = new Set(kept.map((item) => item.path));
  return hits
    .filter((item) => !keptPaths.has(item.path))
    .map((item) => ({ title: item.title, path: item.path }));
}

/**
 * **按类型分节 + 类型名额**选取候选（⑥，2026-10-31）。
 *
 * 纯函数，次序与名额由调用方以**具名常量**传入（注入面的常量在
 * `recall-injection.js`，变更属 `10 §9.1` 第 2 项 Human Gate）。
 *
 * 语义（不是排序）：`hits` 进来时已按证据排好，本函数**不改名次**，只做
 * 「按类型分组、每类取前 N 条、总名额从次序末尾向前裁」。因此它不会给
 * 任何类型加分——类型只决定「交付时先看哪一节、每节最多几条」。
 *
 * @param {Array<object>} hits 已排序的候选卡
 * @param {{order?: string[], quotaByType?: Record<string, number>, total?: number}} plan
 * @returns {{selected: object[], groups: Array<{type: string, items: object[]}>,
 *   droppedByQuota: Array<{type: string, count: number}>,
 *   droppedByTotal: Array<{type: string, count: number}>, unassigned: number,
 *   unassignedByType: Array<{type: string, count: number}>}}
 */
export function selectFactsBySection(hits, plan = {}) {
  const order = Array.isArray(plan.order) ? plan.order : [];
  const quotaByType = plan.quotaByType ?? {};
  const total = Number.isInteger(plan.total) && plan.total >= 0 ? plan.total : Number.POSITIVE_INFINITY;
  const byType = new Map();
  for (const hit of hits) {
    const type = typeof hit?.type === "string" ? hit.type : "";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(hit);
  }
  const droppedByQuota = [];
  const quotaGroups = [];
  for (const type of order) {
    const all = byType.get(type) ?? [];
    byType.delete(type);
    if (all.length === 0) continue;
    const quota = Number.isInteger(quotaByType[type]) ? quotaByType[type] : 0;
    const kept = quota > 0 ? all.slice(0, quota) : [];
    if (all.length > kept.length) droppedByQuota.push({ type, count: all.length - kept.length });
    if (kept.length > 0) quotaGroups.push({ type, items: kept });
  }
  // 分节次序之外的类型**不静默吞掉**：如实计数，由调用方披露（本仓已登记类型
  // 都在 order 内，出现其它类型即说明常量与类型名录漂移）。
  //
  // **只给总数不够**（2026-11-11 修）：`34 §12` 要求「未检查范围须逐类列出」，
  // 而注入面此前拿到 `unassigned: 13` 却不知道是哪些类型，于是整条不披露。
  // 实测该 13 条 = devlog 8 + subgoal 5——**知道分类型才可能判断该不该补规则**。
  // 故一并给出按类型明细（保序：Map 插入序即命中次序）。
  const unassignedByType = [];
  let unassigned = 0;
  for (const [type, rest] of byType) {
    if (rest.length === 0) continue;
    unassigned += rest.length;
    unassignedByType.push({ type, count: rest.length });
  }
  const droppedByTotal = [];
  const groups = [];
  const selected = [];
  let remaining = total;
  for (const group of quotaGroups) {
    const take = Math.max(0, Math.min(group.items.length, remaining));
    // 总名额从次序**末尾**开始裁：前面的类型是 Human 排序里更该被看见的，
    // 先削后面的节。等价于「前面的节优先占满总名额」。
    if (take < group.items.length) droppedByTotal.push({ type: group.type, count: group.items.length - take });
    if (take > 0) {
      groups.push({ type: group.type, items: group.items.slice(0, take) });
      selected.push(...group.items.slice(0, take));
    }
    remaining -= take;
  }
  return { selected, groups, droppedByQuota, droppedByTotal, unassigned, unassignedByType };
}

/**
 * 判据表不可用时的披露语（02 §12.4 fail-closed 的「如实报告」一半）。
 *
 * 契约要求：缺表/缺版本/列不符/机械值非法/必填缺失 → 停用该类型的机器判据、
 * 按 partial 口径交还并**说明缺什么**。此处把结构化错误逐条转成 gaps 行。
 *
 * **归因须准**（2026-11 修）：这里此前把「该类型在表里没有条目」也写成
 * 「判据表不可用（type）：该类型无可用条目」——读起来像**判据表坏了**，实际是
 * **该类型还没有规范**。两种情形处置不同（前者 fail-closed 停用并报错，后者按
 * 具名兜底继续并在 `criteria.fallbackTypes` 登记），披露语必须分开，否则读者
 * 无法判断该去修表还是去补规范。
 */
function criteriaGapsOf(criteria, facts) {
  const gaps = [];
  if (criteria === null) {
    gaps.push("判据表不可用：未找到任何规范源，全部事实类型的机器判据已停用（类型点名／核心语义字段／关系展开不生效）");
    return gaps;
  }
  for (const error of criteria.errors) {
    gaps.push(`判据表不可用（${error.type ?? "未知类型"}／规范 ${error.specId ?? "?"}）：${error.code}：${error.message}`);
  }
  const registered = [...new Set(
    facts.filter((fact) => REGISTERED_FACT_TYPES.includes(fact.type)).map((fact) => fact.type),
  )].sort();
  for (const type of registered) {
    const policy = recallStatusPolicyOf(criteria, type);
    // 解析失败者已由上面的 error 循环逐条点名，不再重复。
    if (policy.kind === "disabled") continue;
    if (policy.kind === "fallback") {
      gaps.push(`判据表未登记该类型（${type}）：默认候选状态回落具名兜底 ${policy.statuses.join("/")}，类型点名／核心语义字段／关系展开不生效（该类型尚无判据表条目，不是判据表损坏）`);
    }
  }
  return gaps;
}

/** 关系展开的条数上限（具名常量，防单条查询把注入预算吃光）。 */
const RELATION_EXPANSION_MAX = 6;

/**
 * ⑤ 关系展开（F4 派生，2026-10-31）。
 *
 * 只在**精确引用路径**生效：查询是纯指称，且命中了某对象的
 * `object_uid`/`SG-n`/`spec_id`/`direction_key`（既有 tier 0 结构命中）。
 * 默认候选路径不展开——二者不该扩展同一批默认候选状态范围。
 *
 * 边集只认**判据表「关系展开」行登记过的 `relation_key`**，且对象上必须
 * **实际存在**这条边；目标类型必须在该行登记的 `targets` 里。派生条目：
 *   · 单独归类（`relationExpansions`），**不进 F2 候选计数、不占类型名额**；
 *   · 命中依据 `关系展开：<源对象标识>+<relation_key>`；
 *   · 目标不可解析（语料里找不到该 uid）或类型不符时**如实报告**，
 *     以 `resolved: false` + `unresolvedReason` 保留在派生集合里，不静默丢弃。
 *
 * @returns {{items: object[], dropped: number}}
 */
function relationExpansionsOf(hitCards, pool, scopedFacts, criteria) {
  const poolByRef = new Map(pool.map((fact) => [fact.ref, fact]));
  const scopeByRef = new Map(scopedFacts.map((fact) => [fact.ref, fact]));
  const items = [];
  const seen = new Set();
  let dropped = 0;
  for (const card of hitCards) {
    if (card.tier !== 0 || card.bareReference !== true) continue;
    if (!Array.isArray(card.structuralFields) || card.structuralFields.length === 0) continue;
    const source = poolByRef.get(card.ref);
    if (source === undefined) continue;
    const entry = criteria?.byType?.get(source.type) ?? null;
    if (entry === null) continue;
    if (entry.values.notApplicable["关系展开"]) continue;
    const edges = new Map(entry.values.relations.map((rel) => [rel.relationKey, rel.targets]));
    if (edges.size === 0) continue;
    const actual = Array.isArray(source.structural?.relationEdges)
      ? source.structural.relationEdges : [];
    for (const edge of actual) {
      const targets = edges.get(edge.relationKey);
      if (targets === undefined) continue;
      const target = scopeByRef.get(edge.targetUid) ?? null;
      let unresolvedReason = "";
      if (target === null) unresolvedReason = `目标不可解析：${edge.targetUid}`;
      else if (!targets.includes(target.type)) {
        unresolvedReason = `目标类型不在判据表：${target.type}（期望 ${targets.join("|")}）`;
      }
      const dedupeKey = `${target === null ? edge.targetUid : target.ref}\u0000${edge.relationKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (items.length >= RELATION_EXPANSION_MAX) {
        dropped += 1;
        continue;
      }
      items.push({
        kind: "relation",
        type: target === null ? "" : target.type,
        ref: target === null ? edge.targetUid : target.ref,
        title: target === null ? "" : target.title,
        status: target === null ? "" : target.status,
        path: target === null ? "" : target.path,
        excerpt: target === null ? "" : (excerptOf(target.excerptSource) || target.title),
        updatedAt: target === null ? "" : (target.updatedAt ?? ""),
        resolved: unresolvedReason === "",
        ...(unresolvedReason === "" ? {} : { unresolvedReason }),
        derivedFrom: {
          sourceRef: source.ref,
          sourceTitle: source.title,
          relationKey: edge.relationKey,
        },
        hitReason: unresolvedReason === ""
          ? `关系展开：${source.ref}+${edge.relationKey}`
          : `关系展开：${source.ref}+${edge.relationKey}（${unresolvedReason}）`,
      });
    }
  }
  return { items, dropped };
}

/**
 * 只枚举 F1 决策基线（active ADR），不跑任何词法匹配。
 *
 * **为什么需要单独一个入口**（2026-11-03）：`22 §12` 的义务召回要求「相关行动
 * 开始前，AI 必须召回并核对相关 active ADR」，其可见性**不得**取决于本回合是否
 * 走词法召回。而 `recallForAction` 会在两处整体短路：
 *   · 动作描述切不出主题词 → `recall/no_tokens`（如「是不是应该」「怎么办」）；
 *   · 判为纯读取/纯查询 → 调用方 `buildRecallInjection` 在调用前就返回。
 * 这两条短路都是 `34 §6` 的**词法候选**排除条件，针对的是「本次有哪些相关候选」，
 * 与 F1 基线「当前决策全貌」无关。短路时连基线一起吞掉，等于把义务召回重新绑回
 * 当回合用词——正是方案 A（Human 2026-10-25）要消除的缺陷。
 *
 * **边界**：只读事实源，不读规范源、不建索引、不写任何东西；返回结构与
 * `recallForAction` 的 `decisionBaseline`／`l0Enumeration` 同形，故渲染层无需
 * 第二套逻辑。
 *
 * **2026-11-04 扩至三段**（Human 决定）：ADR、事实规范（Norm）、经验（Pitfall）
 * 的 L0 都必须注入，且都不依赖词法命中。故本入口同时给出三段的枚举——
 * `decisionBaseline` 仍只承载 ADR（形状不变，既有消费方与断言无需改动），
 * `l0Enumeration` 承载 Norm 段与经验段（ADR 段在其中被跳过，避免同一批对象
 * 出现两份渲染）。
 *
 * @param {{root?: string, budgetBytes?: number|null}} [input]
 */
export async function baselineOnlyForAction(input = {}) {
  const root = input.root ?? join(import.meta.dirname, "..", "..");
  const budgetBytes = Number.isInteger(input.budgetBytes) && input.budgetBytes > 0
    ? input.budgetBytes : null;
  const factsDir = join(root, "ldvh-base");
  const factsReadable = await isReadableDir(factsDir);
  // 事实源不可读时不抛错：与 `recallForAction` 同口径，把「读不到」如实标进
  // `sourceUnreadable`，绝不返回空 items 让读者读成「本项目没有 ADR」。
  const facts = factsReadable ? await loadFacts(factsDir) : [];
  // **不受任何过滤影响**（22 §12／02 §9.1 F1）：不传 types/statuses/limit，只按
  // 各自类型的默认候选状态取——与 `recallForAction` 内的枚举同源同序，两处若
  // 不一致会出现「有词命中时基线 3 条、无词命中时基线 2 条」的漂移。
  const enumeration = l0EnumerationOf(facts);
  const adrSegment = enumeration.find((segment) => segment.type === "adr");
  const active = facts.filter(
    (fact) => fact.type === "adr" && (DEFAULT_STATUSES_BY_TYPE.adr ?? DEFAULT_STATUSES_FALLBACK).includes(fact.status),
  );
  // 确定性排序：标题码点序，同标题再按稳定引用兜底（02 §9 红线，无权重）。
  active.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const items = active.map((fact) => ({
    title: fact.title,
    status: fact.status,
    ref: fact.ref,
    path: fact.path,
  }));
  // Norm 段与经验段：与完整路径同一规划函数（份额与让位阈值同源）。
  const l0Plan = planL0Enumeration(
    enumeration.filter((segment) => segment.type !== "adr"),
    budgetBytes,
    RENDER_FIXED_OVERHEAD_BYTES,
  );
  return {
    ok: true,
    decisionBaseline: {
      items,
      sourceUnreadable: !factsReadable,
      pagination: { hasCursor: false, howToGetAll: "本字段即全量 active ADR（不按 limit 截断）；逐条全文用 ldvh_adr_read" },
      note: "F1 枚举：不受本次 limit／types／预算影响；retired 不入基线（22 §12）",
      // 本路径不跑词法召回，故没有候选区与基线争预算，预留恒为 0。
      reservedBytes: 0,
    },
    l0Enumeration: {
      order: [...L0_SEGMENT_ORDER],
      segments: l0Plan.segments,
      bytes: l0Plan.bytes,
      note: l0Plan.note,
      sourceUnreadable: !factsReadable,
      // ADR 段的对象已在 `decisionBaseline.items` 里，此处只报条数供核对。
      adrTotal: adrSegment?.total ?? 0,
      // **经验按需通道的计数**（`34 §8.4` 2026-11-11 重订）：经验不再逐条常驻，
      // 但必须给出**真实总数**，否则「本类为空」与「未列出」无法分辨（34 §12 三态）。
      // **不得从 `enumeration` 里找**：该枚举只覆盖常驻段（adr/norm），经验已转按需；
      // 找不到 pitfall 段不等于 0 条——那正是 2026-11-11 的缺陷（纯读取回合报「0 条」）。
      // 计数与全量路径共用 `countActivePitfalls`，两路径才不会漂移；读不到给 null。
      pitfallTotal: factsReadable ? countActivePitfalls(facts) : null,
    },
    // 明示「本结果不证明适用」（34 §13），与 recallForAction 同口径。
    provesApplicability: false,
    gaps: factsReadable ? [] : ["事实源不可读：项目内 ldvh-base/ 不存在或不可读，该源未检查"],
  };
}

export async function recallForAction(input = {}) {
  const action = typeof input.action === "string" ? input.action.trim() : "";
  if (action === "") {
    return { ok: false, error: { code: "recall/action_required", message: "动作描述必填" } };
  }
  // **默认值注**（2026-10-24，2026-11-03 订正）：本函数默认 `limit=5`／
  // `budgetBytes=RECALL_DIRECT_BYTE_BUDGET`（4000）；注入路径的生产预算是**档位字节**
  // （`INJECTION_BUDGET_TIERS`，默认档 10240），`RECALL_BYTE_BUDGET`（2400）只在
  // 调用方漏传 `budgetBytes` 时兜底，不是生产值。
  // 二者**故意不同**：
  //   · 本函数是**通用召回接口**，调用方（CLI、诊断脚本）通常想要更多候选；
  //   · 注入路径受引导面预算约束（`10:241`「未超 LDVH 侧常量预算」），须更紧。
  // 混用会让「预算到底是多少」说不清——测试里就曾把两者当同一个数而断言失败。
  // 需要稳定基数时请显式传参，不要依赖默认值。
  // **两个上限都以具名常量承载**（34 §11「上限须以具名常量承载，不得是运行期猜测」），
  // 不再是散落在调用处的字面量——字面量无法从一处追溯，改预算时也看不出改了哪一处。
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 5;
  const budgetBytes = Number.isInteger(input.budgetBytes) && input.budgetBytes > 0
    ? input.budgetBytes : RECALL_DIRECT_BYTE_BUDGET;
  // 显式传入优先；否则**按类型取各自的默认候选状态集**（取自判据表，
  // 见下方 criteria 就绪后的 `statusAllowed`）。
  const explicitStatuses = Array.isArray(input.statuses) && input.statuses.length > 0
    ? input.statuses : null;
  // `statusAllowed` 的**定义在 criteria 就绪之后**（见下方）：默认候选状态是
  // `02 §12.4` 的机械项，须从判据表读，不能在这里读硬编码表。
  // 事实类型过滤。**默认不限定类型**——`03 §6.1` 快通道那条写的是「不遍历
  // **未被当前目标和来源规则触发的**全量规则或事实」，即：不该全量遍历，
  // 但被触发的类型仍应召回。曾把默认收窄为 `["adr","pitfall"]`，结果
  // 「加个」这类短指令因只能搜这两类而召回不到东西（实测 inject 由 true 变 false）。
  //
  // ADR/Pitfall 的优先级**不靠过滤**（过滤会漏），也**不靠排序类型轴**（2026-10-31
  // Human 已裁定删除 `typeRank` 族）：它们由默认候选状态集保证「不被过滤」，
  // 由类型点名层保证「点名时居首」。`REQUIRED_RECALL_TYPES` 保留为**声明性常量**，
  // **无排序消费点**。
  const types = Array.isArray(input.types) ? input.types : null;
  // **声明范围之外的常驻排除**（`31 §10`，与 `types` 语义不同，见
  // `INJECTION_EXCLUDED_TYPES` 的说明）：这些类型**根本不进入本次声明范围**，
  // 故既不形成候选，也**不使完整度降级**、不进 `excludedByTypeFilter`。
  // 与 `types` 的关键差别：`types` 是「本次只看这几类」，被排除者属「未检查
  // 范围」，须逐条披露；本参数是「这些类型不属本路径的职责范围」，其归属由
  // 另一条路径（主动查）承接，故不构成未检查。
  const excludedTypes = Array.isArray(input.excludeTypes) ? input.excludeTypes : null;
  const includeSpecs = input.includeSpecs !== false;
  // ── **结构化收窄（facet）**（2026-10-29 新增）────────────────────────
  //
  // 与 `types`/`statuses` 同一族的**确定性过滤**，补的是「按结构化字段值收窄」
  // 这条缺口。它的必要性由规范写明：`02 §9.1` F2 的定义就是「按类型、状态、
  // **稳定引用、关系、locator 或类型允许字段**命中的候选卡」；`20 §12` 要求
  // F2 可按 `serves`/`refs`/`priority` 命中；`26 §12` 要求「F1 枚举 + status
  // 过滤」取 `accepted`（其 F1 投影**含 attribution**）。
  //
  // ── 语义边界（重要，勿读成「按相关度筛选」）────────────────────────
  //
  // facet 是**硬过滤**，与 `types` 同等性质：不满足者**不形成候选**，且**必使
  // 完整度降级**（进 `excludedByTypeFilter` 同族的披露，见下方 unchecked 计算）
  // ——因为它缩小了本次的声明范围，「没返回」不代表「不存在」（34 §12）。
  // 这与「排序靠后」是两件不同的事：排序不改声明范围，facet 改。
  //
  // ── 为什么是单值而非数组 ──────────────────────────────────────────
  //
  // 每个 facet 取**单值**（如 `priority: "P1"`），不取数组。理由：这些是闭集
  // 或锚点，多值收窄等价于「不筛」（`priority ∈ {P0,P1,P2,P3}` 命中全部带档位
  // 的火花），反而让调用方误以为筛过了。需要多值时由调用方分多次调用，
  // 每次的完整度如实各自承载——这比一个「看似筛过其实没筛」的参数诚实。
  const facet = (name) => {
    const v = input[name];
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  // `objectUid` 走 `ref` 整词相等（`02 §9.1` F2 的「稳定引用」）。
  const facetUid = facet("objectUid");
  const facetServes = facet("serves");
  const facetPriority = facet("priority");
  const facetDirectionKey = facet("directionKey");
  const facetRelationKey = facet("relationKey");
  const facetAttributionRef = facet("attributionRef");
  // 命中的 facet 清单（供披露与测试核对「到底筛了什么」）。
  const appliedFacets = Object.entries({
    objectUid: facetUid,
    serves: facetServes,
    priority: facetPriority,
    directionKey: facetDirectionKey,
    relationKey: facetRelationKey,
    attributionRef: facetAttributionRef,
  }).filter(([, v]) => v !== null);

  const query = `${action} ${input.scope ?? ""}`.trim();
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return {
      ok: false,
      error: { code: "recall/no_tokens", message: "动作描述切不出可匹配的词，召回无从开始" },
    };
  }
  // **全弱证据 = 没有主题词**（2026-10-27）。放宽 tokenizer 的后遗症：一句
  // 「为什么这里不对」「现在应该做什么」不再切空，但它切出来的全是含虚字的跨词
  // 二元组（为什／里不／做什），**没有任何主题**。这类查询若照常召回，就会按
  // 跨词噪声命中无关对象并占用注入预算——实测「为什么这里不对」命中了
  // mattpocock/skills 调研与 LLM Wiki 调研两条无关条目。
  //
  // 判据用**强证据是否存在**，与 `matchCandidate` 的 `specific` 同源：
  // 只要有一个双实词二元组（白屏／校验／提交），就照常召回；一个都没有，
  // 就按 no_tokens 如实报出——「不知道要召回什么主题」本来就是正确结论，
  // 不该用一个弱噪声冒充候选（02 §9.2 命中不等于适用，但也要求候选确有依据）。
  if (tokens.every((t) => isWeakToken(t))) {
    return {
      ok: false,
      error: { code: "recall/no_tokens", message: "动作描述只有虚字与跨词组合，无主题词，召回无从开始" },
    };
  }

  const root = input.root ?? join(import.meta.dirname, "..", "..");
  // 规范语料按 01 §10.3 三级回退解析（见 `resolveSpecsRoot`）；事实源只有项目内一源。
  const specsSource = includeSpecs ? await resolveSpecsRoot(root) : null;
  // **判据表与规范源同源**（02 §12.4）：判定事实类型的「核心语义字段／类型词／
  // 关系展开」只认规范源里那张表。解析失败的类型在下方按 partial 披露，
  // 且该类型停用机器判据（`loadFacts` 内已置空 detail/typeNames）。
  // 判据表**不随 includeSpecs 关闭**：`includeSpecs:false` 只是「不把规范当候选」，
  // 事实的类型通道仍须按规范里的判据表工作，否则关掉规范候选会顺带停用全部
  // 事实的机器判据（实测：`includeSpecs:false` 时 criteria 曾为 null）。
  const criteriaSource = specsSource ?? (await resolveSpecsRoot(root));
  const criteria = criteriaSource === null ? null : await loadRecallCriteria(criteriaSource.dir);
  // ── **默认候选状态取自判据表**（`02 §12.4`，2026-11 修）──────────────
  //
  // 此前这里读硬编码的 `DEFAULT_STATUSES_BY_TYPE`，而判据表里那一列（解析成品
  // `values.defaultStatuses`）**除测试外无任何消费点**——规范说一套、代码判一套
  // （`01 §11.4` 禁的第二规则源）。现在取值走 `recallStatusPolicyOf`：
  // 判据表给了机械值就用它；标「不采用」的类型不进候选池；表里没有该类型条目
  // 才回落具名兜底；表里有但解析失败仍走 fail-closed（停用机器判据、如实报错）。
  //
  // 回落与「不采用」都是**可见的**：分别记在 `criteria.fallbackTypes` 与
  // `criteria.nonCandidateTypes`，回落另在 `gaps` 里逐类型点明（34 §12 未检查范围）。
  const statusPolicy = (type) => recallStatusPolicyOf(criteria, type);
  // `statuses` 保留为一个**判定函数**的语义位：实际按每个候选的类型查判据表。
  // 显式传入者优先（调用方的显式收窄覆盖默认取值）。
  const statusAllowed = (type, status) => {
    if (explicitStatuses !== null) return explicitStatuses.includes(status);
    const policy = statusPolicy(type);
    // `non-candidate`：该类型没有候选概念（判据表标「不采用」），一律不进候选池。
    if (policy.kind === "non-candidate") return false;
    return policy.statuses.includes(status);
  };
  const factsDir = join(root, "ldvh-base");
  const [specs, facts, factsReadable] = await Promise.all([
    specsSource === null ? [] : loadSpecs(specsSource.dir),
    loadFacts(factsDir, { criteria }),
    // **可读性与「有无对象」分开跟踪**（34 §12 三态判定的前提，M-21）：
    // 规范侧的可读性由三级回退是否解析成功承载（specsSource !== null）；
    // 事实侧没有回退链，须显式探测目录是否存在且可读。
    isReadableDir(factsDir),
  ]);

  // **声明范围的边界先落地**（见 `excludedTypes` 的说明）：`scopedFacts` 是
  // 本次召回的**声明范围**，`facts` 仍是事实源全量（F0 计数用它，因为 F0 描述
  // 的是事实源整体状况，不是本次范围）。凡「未检查范围」「完整度」「被排除数」
  // 都必须基于 `scopedFacts`——否则声明范围外的类型会被报成「本次漏查」，
  // 既让 `recallCompleteness` 恒降级，也让披露行每回合刷恒定噪音。
  const scopedFacts = excludedTypes === null
    ? facts
    : facts.filter((c) => !excludedTypes.includes(c.type));
  // 机器判据被停用的类型（判据表缺失/非法）：随结果披露，且不参与类型点名、
  // 字段语义与关系展开（02 §12.4 fail-closed）。
  const disabledCriteriaTypes = [...new Set(
    scopedFacts.filter((fact) => fact.machineCriteria === "disabled").map((fact) => fact.type),
  )].sort();
  // ── 默认候选状态的两种**可见例外**（02 §12.4，2026-11）──────────────────
  //
  // `fallbackStatusTypes`：判据表里**没有该类型条目**，故回落具名兜底常量。
  //   它与 `disabledTypes` 是不同的事：前者是「该类型还没规范」，后者是
  //   「有规范但表坏了/解析不了」。混成一类会让读者把「没写」读成「坏了」，
  //   也会把「坏了」当「没写」悄悄放过——所以两者各自成列。
  // `nonCandidateTypes`：判据表把「默认候选状态」标为「不采用」的类型（目前
  //   只有 Goal 单例），**没有候选概念**，不进候选池、也绝不回落成 active。
  //   它取自判据表本身而非语料，故即使语料里没有该类型对象也照样披露。
  const statusPolicyOfType = (type) => statusPolicy(type);
  // 判据表整体缺席（无任何规范源）时不逐类型报「未登记」——那时缺的是**全部
  // 判据表**，已由 `criteriaGapsOf` 的第一条与 `criteria.ok:false` 承载；
  // 逐类型刷一遍只会把「没有规范源」淹没在 10 行噪音里。
  const fallbackStatusTypes = criteria === null ? [] : [...new Set(
    scopedFacts
      .filter((fact) => REGISTERED_FACT_TYPES.includes(fact.type))
      .filter((fact) => statusPolicyOfType(fact.type).kind === "fallback")
      .map((fact) => fact.type),
  )].sort();
  const nonCandidateTypes = [...(criteria?.byType?.keys() ?? [])]
    .filter((type) => statusPolicyOfType(type).kind === "non-candidate")
    .sort();

  // 过滤：**已登记类型** + 类型 + 状态 + **结构化 facet**。
  // 规范无 status 概念故全量参与。
  //
  // facet 与类型/状态过滤**同层**（都是缩小声明范围的确定性条件），不是排序。
  // 取值比较一律**不区分大小写**（闭集值在语料里有 `heavy` 全小写、`P1` 大写、
  // `SG-1` 大写三种形态；调用方不该被要求精确记形态），但**必须是整值相等**，
  // 不做前缀/子串匹配（`P1` 不得命中 `P10`）。
  const sameText = (a, b) => typeof a === "string" && typeof b === "string"
    && a.toLowerCase() === b.toLowerCase();
  const pool = scopedFacts.filter((c) => {
    // **中间产物不进入召回**（02 §9.2）：只保留已登记类型。
    // 未登记类型（留观缓冲、缓存、草稿箱等事实源之外的中间产物）不形成候选卡。
    if (!REGISTERED_FACT_TYPES.includes(c.type)) return false;
    if (types !== null && !types.includes(c.type)) return false;
    if (!statusAllowed(c.type, c.status)) return false;
    // ── 结构化 facet（缺字段者**不匹配**，不是「不受该 facet 约束」）──────
    // 这一点必须明确：`serves: "SG-1"` 时，**没声明 serves 的对象不进候选**。
    // 直觉上「没声明这条约束，所以它不该被筛掉」是错的——facet 问的是
    // 「哪些对象声明了 X」，未声明者不是答案。若想让它们也进来，那就不该用
    // facet 收窄，而该用结构命中（把 `SG-1` 直接写进 `action`）。
    if (facetUid !== null && !sameText(c.ref, facetUid)) return false;
    if (facetServes !== null && !sameText(c.structural?.serves, facetServes)) return false;
    if (facetPriority !== null && !sameText(c.structural?.priority, facetPriority)) return false;
    if (facetDirectionKey !== null && !sameText(c.structural?.directionKey, facetDirectionKey)) return false;
    if (facetAttributionRef !== null && !sameText(c.structural?.attributionRef, facetAttributionRef)) return false;
    // 关系键：**存在任一关系边的 key 等于该值**即算（38 条 friction 各自带不同 key）。
    if (facetRelationKey !== null) {
      const keys = c.structural?.relationKeys ?? [];
      if (!keys.some((k) => sameText(k, facetRelationKey))) return false;
    }
    return true;
  });

  // 按源分算文档频率，过滤过于普遍的 token（见 `HIGH_DF_RATIO`）。
  // 每个源各自一套 DF，区分度分布不同。（此处原写死「规范源 27 份、事实源 248 条」
  // 两个规模快照，事实源增长后即为错值——同 friction-943940d6，已删。）
  //
  // **DF 口径须与匹配面一致**（2026-10-27 修，独立审核发现）。原实现只统计
  // `scope+detail+title` 三个窄字段，而 `matchCandidate` 的 tier 4 会匹配
  // **正文**（`bodyText ?? body`）。两套口径不一致的后果：一个词可以在窄面
  // 只占 16%（逃过 0.6 阈值），却在真实匹配面上占 64%——它命中任何查询，
  // 却永远不被过滤。实测（独立审核给出，我复算一致）：
  //   「实际」窄面 16% / 全匹配面 **64%**
  //   「提交」窄面 20% / 全匹配面 **67%**
  //   「字段」窄面 21% / 全匹配面 58%
  // 这正是「实际给出的都是有价值的信息吗」这类无主题查询满屏噪声的机制来源：
  // 过滤按窄面判「这个词有区分度」，匹配却按全篇让它命中几十条。
  //
  // 改用与匹配完全相同的口径（scope/detail/title/body 并集），
  // 两套口径此后不可能再脱节——它与 `corpusStatsOf`（BM25 用）同源。
  // **为什么不能一律用全口径**（实测反例，2026-10-27）：全口径过滤会把
  // 「workcase」判为 74% 普遍而滤掉——但它是**类型点名词**（「写一个 WorkCase」），
  // 滤掉后该查询首位变成 `Code 实践与测试规范`，类型点名层彻底失效。
  // 同类还有「写」（规范源 100%）。
  //
  // 故取**两口径的较小值的反面**：一个词只有在「窄面（scope/detail/title）」与
  // 「全匹配面」**都**普遍时才算噪声。「实际」两口径都高（16%/64%）→ 滤；
  // 「workcase」窄面低、全面高 → 保留（它是有区分度的主题词，只是正文提得多）。
  //
  // 实现上取 df 的**较大值**（= 更保守地判普通 ⇒ 更难过滤）？不——那会让
  // 「实际」因全面 64% 被滤、同时 workcase 因全面 74% 也被滤，两者都死。
  // 正确的是按**窄面**判、但把正文的命中算进「是否过度」的对照：故取**较大值**
  // 之外还需例外——见下 `isTooCommon` 的两口径判定。
  const collect = (list, mapper) => {
    const df = cachedDocFreqOf(list);
    // 有效查询词 = 原 tokens 里**不过于普遍**的那些。若全被滤掉（例如查询只由
    // 「规范」「定义」组成），退回原 tokens——宁可给噪声也不能给零结果，
    // 因为零结果会被误读成「无相关约束」。
    const effective = tokens.filter((token) => !isTooCommon(token, df, df.total));
    const queryTokens = effective.length > 0 ? effective : tokens;
    const corpusStats = cachedCorpusStatsOf(list);
    return list
    .map((c) => {
      const m = matchCandidate(queryTokens, c, corpusStats, query);
      // `hits` 必须显式带出：mapper 的返回里没有它，之前漏掉导致排序键是
      // `undefined - undefined = NaN`，同层排序退化成只按路径字典序，
      // 使命中词更多的条目反而排在后面（实测：34 号 hits=2 被 01 号 hits=1 挤掉）。
      // **`tier` 命名须加注**（2026-10-24，第 68 轮）。
      //
      // 本文件里 `tier` 一词有三种含义，读者极易混淆：
      //   · 语料回退来源（`tier: "project"|"source-repo"|"package"`，见 `specDirToUse`）；
      //   · **匹配层**（数值，见顶部 `MATCH_TIERS`）；
      //   · 候选对象上的暴露值（就是这一个，等于匹配层）。
      //
      // 更危险的是：`02 §9.1` 明令「F0–F4 是事实召回分层，**不能与 01 的
      // L0–L4 规范读取分层混用**」。读者看到 `tier: 1`／`tier: 2` 很容易误读成
      // **F1 层（最小权威字段卡）** 或 **L1 层**，而它实际只表示「命中了哪个字段」。
      // 故在此显式并列给出 `matchTier` 语义说明，使误读不可能发生而不自知。
      return m === null ? null : {
        ...mapper(c),
        tier: m.tier,
        // 明确语义：这不是 F 层也不是 L 层，只是「命中了候选的哪个字段」。
        matchTierMeaning:
          "匹配层（命中了哪个字段），非 F0–F4 事实分层、非 L0–L4 规范读取分层（02 §9.1）",
        hits: m.hits,
        hitReason: m.hitReason,
        weakHit: m.weakHit === true,
        // 供关系展开（F4）识别「精确引用路径」：结构字段命中的具体字段名，
        // 以及该结构命中是否为纯指称（否则不展开）。
        ...(m.structuralFields === undefined ? {} : { structuralFields: m.structuralFields }),
        ...(m.bareReference === true ? { bareReference: true } : {}),
        // 短形态命中（`34 §8.2`）：候选卡上标明「这一条的命中依据走了会被前缀
        // 碰撞影响的形态」，调用方不必回头解析 hitReason 文案。声明本身已在
        // hitReason 里（§14 的可接受依据是「命中理由原文」）。
        ...(m.shortForm === true ? { shortForm: true } : {}),
      };
    })
    .filter(Boolean)
    // 排序：先按层（命中越精确的字段越前），同层按命中词数降序、再按路径稳定排序。
    // 命中词数是计数不是权重——可解释（hitReason 列出命中词）、可复算、无学习参数。
    // 排序键（全部为确定性事实，无权重——02 §9 红线）：
    //   1. `weakHit`——**强命中一律优先于弱命中**。弱命中（只靠单字/通用词）
    //      仍是候选，但不该抢占名额把强命中挤出去（实测 limit=3 时 2 个弱命中
    //      挤掉了随后 5 个强命中）。这不是「裁决相关性」，而是「把证据更薄的
    //      排在后面」，弱命中仍然如实列出、仍然标注弱相关。
    //   2. `tier`——命中落在哪个字段（编号 > 适用范围 > 内容 > 标题 > 正文）。
    //   3. `hits`——同层命中词个数（等权、可复算）。
    //   4. `path`——仅为让输出稳定可复现。
    .sort(
      (a, b) =>
        Number(a.weakHit === true) - Number(b.weakHit === true) ||
        a.tier - b.tier ||
        b.hits - a.hits ||
        // **状态准入等级先于时间**：已准入（active/open）一律在未准入
        // （draft/pending）之前，避免新草稿凭新鲜度压掉权威对象（2026-11-03 起
        // Pitfall 无 draft，该档只剩 WorkCase 等类型）。
        statusRank(a.status) - statusRank(b.status) ||
        // **最后更新时间：次级键，只在前几项全等时生效**（2026-10-27）。
        // 依据 Human 的判断：「优先按匹配程度，其次按最后更新时间」。
        // **为什么不让时间当主键**：本仓事实的创建时间跨度是 2026-09-09 至
        // 2026-11-03，若「越新越前」优先，一条今天新建的待办记录会压掉
        // 2026-09-09 的权威 ADR——新 ≠ 更适用。故它只在**证据强度相同时**
        // 用于「同等相关里优先看较近的」。
        // 字符串比较安全：ISO-8601 固定长度、统一 `Z` 时区。空串（取不到时间）
        // 排在同分组末尾，不伪造当前时间。
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
        a.path.localeCompare(b.path),
    );
  };

  // `collect` 返回**截断前的全部命中**（已排序）；`limit` 在此处应用。
  // 这样 `counts.specHits` 才是「命中总数」而非「返回数」——
  // `02 §9.1` 要求「数量…必须可观察」，读者要看的正是**丢了多少**。
  const allSpecHits = collect(specs, (c) => ({
    kind: "spec", ref: c.ref, title: c.title, path: c.path,
    // **规范侧稳定引用**（`34 §8.2` 第 2、4 项）：`spec_key` 可直达 L4 全文
    // （`ldvh_read_specification_content` 的 `responsibility_key`）。
    // 本实现**不提供 `heading_path`**：现有匹配层只做整载体级匹配，没有定位到
    // 具体 H2/H3 的判据；凭空给一个章节路径会暗示「已定位到 L3」，而
    // `34 §8.2` 第 4 项明禁这种暗示。故此处为 null，渲染层据此标「L4 全文」。
    specKey: c.specKey ?? null,
    headingPath: null,
    // 绝对路径：语料来自回退来源时 `path` 在项目根下读不到，须用此字段。
    ...(c.absolutePath === undefined ? {} : { absolutePath: c.absolutePath }),
    positioning: c.positioning.slice(0, 160),
    // **每张卡带来源与指纹**（`02 §9.2`「只交付带来源与指纹的候选、卡片或
    // 恢复入口」）。集合级 `fingerprint` 只说明「还是不是同一批候选」，
    // 不说明「这张卡来自哪一级、内容有没有变」——而语料可能来自回退来源
    // （01 §10.3 三级回退），此时每条卡都必须能自述它来自哪一级。
    source: {
      tier: specsSource === null ? null : specsSource.tier,
      // 内容指纹：该载体全文的确定性摘要，供过期检查（与集合指纹不同，它盖内容）。
      contentFingerprint: contentFingerprintOfCached(c.text, c),
    },
  }));
  const allFactHits = collect(pool, (c) => ({
    kind: "fact", type: c.type, ref: c.ref, title: c.title, status: c.status, path: c.path,
    absolutePath: c.absolutePath,
    // **事实侧稳定引用**（`34 §8.2` 第 2、4 项）：完整 `object_uid`，可直达 F3
    // （`ldvh_*_read` 的 `object_uid` 参数）。缺失时为 null，由渲染层如实标注，
    // 不伪造、不静默省略。
    objectUid: c.objectUid ?? null,
    // **最后更新时间进候选卡**（2026-10-27）：使读者在卡片上就能看见
    // 「这条有多旧」，也让排序的次级键对读者可复核（排序依据须可观察）。
    // 取不到时为空串，如实留空而不伪造时间。
    updatedAt: c.updatedAt ?? "",
    // **F2「有界确定性摘录」**：此前候选卡只有 title + path，读者必须打开文件才
    // 知道讲什么，而 F2 的用途正是「筛选少量候选并选择 F3」——没有摘录就无法筛选。
    // 无长文本字段的类型（norm/goal）退回 title，保证摘录位不空。
    excerpt: excerptOf(c.excerptSource) || c.title,
    // **F2 标注：这张卡带哪些结构化字段**（2026-10-29）。
    //
    // `02 §9.1` F2 的用途是「筛选少量候选并**选择 F3**」。此前卡面只有
    // title + 命中理由 + 路径 + 摘录，与「普通记忆召回」无异，读者看不出
    // 这对象**处在什么状态、归哪个子目标、多严重**——而这些恰是各类型规范
    // 说 F2 该带的信息：20 §12 的 F1 投影含 priority/serves；26 §12 的
    // F1 投影含 attribution。
    //
    // 只带**有值的**字段（缺省不写空壳），且**不带长文本**
    // （`summary`/`gist` 已由 `excerpt` 承载，重复带上会吃掉预算）。
    ...(structuralCardOf(c) === null ? {} : { structural: structuralCardOf(c) }),
    // 同规范卡：每张事实卡也带来源与内容指纹（02 §9.2）。
    // 事实源只有项目内一源，故 tier 恒为 "project"。
    source: {
      tier: "project",
      // 用**全文**算指纹：用截断后的 body 会让载体后半部分的变化对指纹不可见
      // （实测某 ADR 真实 3796 字符，body 只 1200——后 2596 字符的内容变化查不出）。
      contentFingerprint: contentFingerprintOfCached(c.fullText ?? c.body ?? "", c),
    },
  })).map((fact, index) => ({ fact, index }))
    // **必需类型优先**（`03 §6.1` 标准路径的点名要求）。
    // ── 排序键：类型优先级**只在同分时生效**（2026-10-27 修，第 1 步）──────
    //
    // **原实现的缺陷**：这里曾把「是否属于 ADR/Pitfall」作为**第一排序键**无条件
    // 前置，把 `collect` 已经排好的质量次序整体推翻。实测证据（「这次改动会不会
    // 把已有的缓存弄坏」）：唯一命中「缓存」的那条 friction（`宿主缓存旧模块致
    // precheck 误报`，命中层级 tier 2）被 28 条 adr/pitfall/spark 压在**第 29 位**
    // ——而其中多数只是靠「改」「提」这类通用词命中 tier 1。10K 档注入约前
    // 20 行，它必然进不去。
    //
    // 这不是「ADR/Pitfall 不重要」。恰恰相反：`22 §12` 要求相关行动前必须召回
    // active ADR，故必需类型**不能被过滤**。但「必需」的正确承载方式是与同等
    // 证据比较时优先，**不是无条件压过证据更强的其它类型**——后者会让「最强命中
    // 排不进注入位」，而注入位恰恰是最稀缺的资源。
    //
    // 新排序键：证据强度（`weakHit` → `tier` → `hits`）先行，
    // **同分时**才让必需类型占先，最后用 `index` 保证确定性。
    // 三者全序，不依赖 sort 稳定性（02 §9 确定性红线）。
    //
    // **方向讨论加位已撤销**（2026-10-27，`31 §10` 修订）：曾在此让 open Spark 在
    // 同分时前移半档（`directionRank` / `isDirectionDiscussion`）。Human 决定
    // 「Spark 不进召回，AI 主动查即可」，`31 §10` 随之改为「方向线不经自动注入，
    // 由 AI 在需要时主动查询」。加位是**注入面专用**的优化：它只改变注入候选的
    // 次序，对「主动查」毫无作用，却让规范与实现相反。故连同词表与四条用例一并
    // 删除（`plugin/test/source-recall.test.mjs`）。主动查的入口在
    // `ldvh_spark_list`（其 keyword／priorities／serves 收窄参数见 31 §10）。
    .sort((a, b) => compareFactHits(a, b))
    .map((entry) => entry.fact);
  // ⑤ 关系展开：只从**精确引用**命中出发（见 `relationExpansionsOf` 的契约）。
  // 派生条目单独归类，**不进 `facts`、不进 F2 计数**，也不占注入类型名额。
  const relationExpansion = relationExpansionsOf(allFactHits, pool, scopedFacts, criteria);
  // ⑥ 按类型分节 + 名额（**仅注入路径显式传入** `factSelection` 时生效）。
  // 默认路径（CLI／诊断／质量门禁）不传，候选仍按证据次序交付——类型不是排序键。
  const factSelection = input.factSelection ?? null;
  let selectedFactHits = allFactHits;
  let sectioning = null;
  if (factSelection !== null) {
    const plan = selectFactsBySection(allFactHits, factSelection);
    selectedFactHits = plan.selected;
    sectioning = {
      order: Array.isArray(factSelection.order) ? [...factSelection.order] : [],
      total: Number.isInteger(factSelection.total) ? factSelection.total : null,
      kept: plan.selected.length,
      droppedByQuota: plan.droppedByQuota,
      droppedByTotal: plan.droppedByTotal,
      unassigned: plan.unassigned,
      unassignedByType: plan.unassignedByType,
      note: "分节与名额是交付次序，不是排序键：候选名次仍只由证据（weakHit/tier/hits/status/updatedAt/path）决定",
    };
  }
  const specHits = allSpecHits.slice(0, limit);
  const factHits = selectedFactHits.slice(0, limit);

  // 预算：按返回内容的 UTF-8 字节数裁剪，超了如实标 truncated（fd133f0d A3）。
  //
  // **保底一条**：若预算小到连第一条都放不下，不能返回空数组——空数组会被
  // 调用方读成「没有相关约束」，而那正是 `02 §9.2` 禁止的「把零结果当无约束」。
  // 故此时**保底返回第一条并把 truncated 置真**，由渲染侧如实写明「已裁剪」，
  // 使 AI 知道「有关系项、只是没全给」，而不是「没有」。
  let used = 0;
  // **估的是「注入文本」的大小，不是「数据对象」的大小**（2026-10-24 修）。
  //
  // 原实现用 `JSON.stringify(item)` 估预算——那是**整个候选对象的序列化**，
  // 含 `path`／`absolutePath`／`source.contentFingerprint`／`matchTierMeaning`
  // 等**根本不会出现在注入文本里**的字段。实测：单条规范候选 JSON 881 字节，
  // 而渲染出的卡片约 100 字节，**相差近 9 倍**；`limit=99, 预算 2400` 时
  // 预算报 1780 字节、实际注入文本仅 1103 字节（多算 62%）。
  //
  // 后果不只是难看：`10:241` 的核对项是「注入内容……**未超 LDVH 侧常量预算**」，
  // 限的是**注入内容**。用数据对象大小去限，会让预算远早于真实需要就切断，
  // 表面上「守住了预算」，实际牺牲了召回条数（实测规范命中 12 条只返回 1 条）。
  //
  // 故改为估算**渲染行**的字节数：标题 + 命中理由 + 路径 + 摘录。
  // 这是确定性可复算的（不依赖渲染器实现），且与真实注入量同阶。
  // **渲染固定开销须计入预算**（2026-10-24 再修）。
  //
  // 只算候选行会低估：渲染层还要加三行固定文本（标题、候选声明、能力边界）
  // 与分段标题（「规范源：」「事实源：」）。实测这部分约 700 字节——若不预留，
  // 预算 2400 时实际注入会达 3093 字节，**超预算 29%**，直接违反 `10:241`
  // 的「注入内容……未超 LDVH 侧常量预算」。
  //
  // 预留值取 RENDER_FIXED_OVERHEAD_BYTES（720，共享常量，见文件头注释）。
  // **F1 决策基线段也须计入固定开销**（2026-10-25，方案 A 落地）。
  //
  // 基线段在渲染层是**固定输出**（`22 §12` 义务披露，无条件），所以它和标题/
  // 声明行一样，属于「不随候选条数变化但必占预算」的部分。若不在这里扣掉，
  // 预算会按「只有候选」来分配，实际注入时基线再挤进来——实测 2400 预算下
  // 基线（约 267 字节 + 段头/声明约 90 字节）导致候选被多裁 2 条，
  // 即「表面上预算没超，实际候选被基线挤掉且裁剪原因归错」。
  //
  // 先枚举基线（它只依赖已加载的 facts），算出其字节量，再据此收紧可用预算：
  // 候选区与基线各自有界，互不吃掉对方的份额。
  const decisionBaselineForBudget = (() => {
    // **状态判定复用受漂移守卫的常量**（第四十次审核 Minor-5）：此前硬编码
    // `"active"`，而 `DEFAULT_STATUSES_BY_TYPE.adr`（本文件 :125）才是有
    // `recall-spec-drift.test.mjs` 守卫、随 22 状态闭集同步的那份。两处不一致
    // 时基线会静默漂移（第二规则源风险，01 §11.4）。
    const adrActiveStatuses = DEFAULT_STATUSES_BY_TYPE.adr;
    const active = scopedFacts.filter(
      (fact) => fact.type === "adr" && adrActiveStatuses.includes(fact.status),
    );
    // 确定性排序（`02 §9` 红线）：标题码点序，同标题再按稳定引用兜底。
    active.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    return active.map((fact) => ({
      title: fact.title,
      status: fact.status,
      ref: fact.ref,
      path: fact.path,
    }));
  })();
  // **基线段预留**（2026-10-25，第四十次审核 M-1/Minor-2 修复）：
  // 预留必须与渲染层的实际消耗**同口径**，否则会出现「预留 400、实际 473」
  // 的欠预留（实测 1200–1466 窗内最多欠 73 字节，直接导致注入超预算）。
  //
  // 渲染层基线段实际由三部分构成，这里逐项对齐（常量取自 recall-injection.js，
  // 不在本文件重复字面量）：
  //   · 条目行：`· 标题［status］` + 换行
  //   · 段头：`【决策基线 · active ADR（22 §12 义务披露）】`
  //   · 段尾：适用性声明 `（基线只保证「看得见」…）`
  //   · 可能的省略披露行 `（基线按字节上限 N 列出前 M 条…）`
  const BASELINE_HEADER = "【决策基线 · active ADR（22 §12 义务披露）】";
  const BASELINE_FOOTER = "（基线只保证「看得见」，**不证明适用**：逐条是否适用于本次行动须自行判断。）";
  // 省略披露行按最坏情形估（三位数条数 + 三位数上限）。
  const BASELINE_OMIT_NOTE_BYTES = 150;
  const baselineItemBytes = decisionBaselineForBudget.reduce(
    (sum, item) => sum + Buffer.byteLength(`· ${item.title}［${item.status}］`, "utf8") + 1,
    0,
  );
  const baselineFullBytes = decisionBaselineForBudget.length === 0
    ? 0
    : baselineItemBytes
      + Buffer.byteLength(BASELINE_HEADER, "utf8") + 1
      + Buffer.byteLength(BASELINE_FOOTER, "utf8") + 1
      + BASELINE_OMIT_NOTE_BYTES;
  const baselineScaledCap = Math.floor(budgetBytes / BASELINE_BUDGET_SHARE_DIVISOR);
  // 与渲染层同一阈值（共享常量）：低于让位阈值时渲染层**不输出基线段**，
  // 故数据层也不再预留——否则候选会白白少放，而基线又没出现在文本里。
  const baselineBytes = decisionBaselineForBudget.length === 0 || budgetBytes < BASELINE_YIELD_BELOW_BYTES
    ? 0
    : Math.min(baselineFullBytes, baselineScaledCap);
  const estimateLineBytes = (item) => {
    const title = typeof item.title === "string" ? item.title : "";
    const reason = typeof item.hitReason === "string" ? item.hitReason : "";
    const path = typeof item.path === "string" ? item.path : "";
    const excerpt = typeof item.excerpt === "string" ? item.excerpt : "";
    // **稳定引用的渲染量须计入**（`34 §8.2` 第 2、4 项，2026-11-12）：事实候选行
    // 现在会附 `object_uid`、规范候选行会附 `spec_key`。不计的话预算按「没有这批
    // 字段」分配，实际注入必然超出——与下方 structural 同一条理由，且同样直接
    // 违反 `10:241`。取**偏保守**估算：固定标签（`· uid=`／`· key=`）按实际
    // 渲染形态计入，标识串本身按原值长度计入。
    const stableRef = typeof item.objectUid === "string" && item.objectUid !== ""
      ? ` · uid=${item.objectUid}`
      : (typeof item.specKey === "string" && item.specKey !== "" ? ` · key=${item.specKey}` : "");
    let structuralBytes = 0;
    if (item.structural !== null && typeof item.structural === "object") {
      const parts = [];
      for (const [key, value] of Object.entries(item.structural)) {
        if (value === null || value === undefined) continue;
        parts.push(Array.isArray(value) ? `${key}=${value.join("|")}` : `${key}=${value}`);
      }
      if (parts.length > 0) structuralBytes = Buffer.byteLength(` · ${parts.join(" / ")}`, "utf8");
    }
    // 前缀（`- [type/status] `）、分隔符与本行换行的粗略常量，取 8 字节。
    return Buffer.byteLength(`${title}${reason}${path}${excerpt}${stableRef}`, "utf8")
      + structuralBytes + 8;
  };
  // ── **三段 L0 常驻枚举的预算次序**（Human 决定 2026-11-04）───────────────
  //
  // Human 的原话：「排序就是 ADR、事实规范、经验，这三个的 L0 是必须注入的，
  // 其他根据预算安排」。故注入面按 **ADR → 事实规范（Norm） → 经验（Pitfall）**
  // 装填三段 L0 标识，**之后**剩下的字节才归词法候选（其余类型按预算安排）。
  //
  //   budgetBytes
  //     − RENDER_FIXED_OVERHEAD_BYTES（标题/声明/分节头）
  //     − baselineBytes      （ADR 段；22 §12 义务披露，含 1/3 上限与让位阈值）
  //     − l0Plan.bytes       （Norm 段 + 经验段；份额见 `L0_SHARE_DIVISOR`）
  //     = usableBudget       （词法候选，含规范候选与其余事实类型的候选）
  //
  // 三段 L0 不是候选（`01.Att.03 §4`：L0 只证明「有这些」，不证明相关或适用），
  // 故不占 `limit` 名额、不带命中理由，并各自成节、逐段在超预算时如实计数披露
  // （`02 §9.1` 不得静默截断）。
  //
  // **为什么不预扣「三段全量」而不设份额**：实测本仓三段约 2.8K（ADR 104 +
  // Norm 80 + 经验 48 条标题 2600），默认档 10240 下份额足够全量装下；但小预算
  // （2400／4000）若让经验段吃满，词法候选会被压成零——那会与 `34 §8.1` 第 1 项
  // 「双源召回」直接冲突（只剩清单、不再有按本次动作匹配的候选）。故设份额并
  // **在超份额时如实披露**，而不是二选一。
  // **枚举只算一次**：`planL0Enumeration` 只承接 adr 之外的两段（adr 由决策基线承载），
  // 但经验总数要单独取回——故先整体算一遍再分流，避免同一批数据算两次而漂移。
  const l0AllSegments = l0EnumerationOf(scopedFacts);
  // **经验总数须单独算**：`l0EnumerationOf` 只遍历 `L0_SEGMENT_ORDER`（现为 adr/norm），
  // 经验已不在其中——它按需而不常驻。但它仍须给出真实总数（`34 §8.4` 第 1 项），
  // 故此处按与枚举同源的默认状态集另行计数，口径一致、不引入第二种判定。
  const l0PitfallTotal = countActivePitfalls(scopedFacts);
  const l0Plan = planL0Enumeration(
    l0AllSegments.filter((segment) => segment.type !== "adr"),
    budgetBytes,
    RENDER_FIXED_OVERHEAD_BYTES + baselineBytes,
  );
  const l0Bytes = l0Plan.bytes;
  const usableBudget = Math.max(0, budgetBytes - RENDER_FIXED_OVERHEAD_BYTES - baselineBytes - l0Bytes);
  // **保底只在整个结果为空时才生效**，不是「每个源各自保底」。
  //
  // 实测缺陷（2026-10-24）：原实现对 specs 与 facts **分别**调用保底——specs 收了
  // 3 条已用 2073 字节，轮到 facts 时第一条放不下、`kept.length === 0` 成立，
  // 于是强行塞入 451 字节，总用量 2524 **超过 2400 预算**（实测复现）。
  // 保底的本意是「宁可超额也不能给零结果」，前提是**整体**一条都没有。
  // **两个源各留份额**：先让规范占满会让事实一条都拿不到。
  //
  // 实测缺陷（2026-10-24）：3 条规范已用 2073 字节（预算 2400），而单条事实
  // 最小需 451 字节——剩 327 不够，于是**事实永远为 0 条**。可「双源召回」的
  // 本意是两个源都要有；只有规范没有事实，等于退化成单源。
  //
  // 规则（确定性、可复算）：若两个源都有命中，规范最多占预算的 60%，
  // 余下 40% 留给事实；只有一个源有命中时不受此限（全给它）。
  // 60/40 不是拍脑袋：实测规范 3 条 ≈2073、事实 3 条 ≈1425，比例约 59:41。
  const bothSources = specHits.length > 0 && factHits.length > 0;
  const specBudget = bothSources ? Math.floor(usableBudget * 0.6) : usableBudget;
  const fitsSpec = (item) => {
    const size = estimateLineBytes(item);
    if (used + size > specBudget) return false;
    used += size;
    return true;
  };
  // 事实侧（规范零命中时）用满 `usableBudget`——此时没有规范档可让，目录只能吃余量。
  const fits = (item) => {
    const size = estimateLineBytes(item);
    if (used + size > usableBudget) return false;
    used += size;
    return true;
  };
  const keptSpecs = specHits.filter(fitsSpec);
  // **词法候选只吃三段 L0 之后的余量**（Human 决定 2026-11-04：L0 三段必须注入，
  // 「其他根据预算安排」——「其他」既含其余事实类型的候选，也含本次命中的规范
  // 候选行；它们不进 L0 索引，故属「按预算安排」的那一侧）。
  //
  // 次序因此是：ADR 段（基线）→ Norm 段 → 经验段 → 规范候选 → 事实候选。
  // 前四者都不受本回合用词影响；只有最后一段随动作变化。
  const keptFacts = factHits.filter(fits);
  if (keptSpecs.length === 0 && keptFacts.length === 0) {
    // 整体为空 → 保底第一条（规范优先，否则事实）。
    const first = specHits[0] ?? factHits[0];
    if (first !== undefined) {
      used += estimateLineBytes(first);
      if (specHits.length > 0) keptSpecs.push(first);
      else keptFacts.push(first);
    }
  }
  // **目录在候选之后规划**（Human 决定 2026-11-03，次序见上方 `usableBudget` 注释）。
  // 目录已经在上方（规范候选之后、事实候选之前）规划完毕，故这里不再重复。
  // 截断有两种来源：**limit**（结果条数上限）与**预算**（字节上限）。
  // 原实现只比 `kept*` 与 `*Hits`，而 `*Hits` 已按 limit 截过，故 limit 造成
  // 的丢弃被漏掉（实测 limit=2 时 12 份命中只给 2 份，却报 truncated=false）。
  // 现与**截断前总数**比较，两种来源都能被观察。
  const truncated =
    keptSpecs.length < allSpecHits.length || keptFacts.length < allFactHits.length;
  // 保底后 used 可能超过 budgetBytes——如实报告超额，不掩盖。
  // **超额判断须含渲染固定开销**（2026-10-24 修）。
  //
  // 原为 `used > budgetBytes`——但 `used` 只累加候选行，不含渲染层那三行固定
  // 文本与分段标题（约 720 字节）。实测预算 200 时 `used=91 < 200` 故判未超额，
  // 而渲染后实际注入必然超过 200（91 + 720 > 200）——**静默超预算**，
  // 恰是 `10:241`「未超 LDVH 侧常量预算」要防的。
  //
  // 故判断改为「候选行 + 渲染开销 > 预算」。这也使极小预算下的保底如实标记
  // overBudget（保底本就是明知超额仍给一条，必须说清）。
  const overBudget =
    used + RENDER_FIXED_OVERHEAD_BYTES + baselineBytes + l0Bytes > budgetBytes;

  // **源可读性一次计算、四处复用**（2026-10-25 第六次审核 N-1）：三态判定、
  // gaps 登记、sourceNotRead 清单与 note 措辞必须对「哪一源不可读」说同一句话，
  // 否则取值如实而清单失实（34 §12「取值须与未检查范围逐类对应」）。
  // 规范侧可读性＝三级回退是否解析成功；调用方显式排除（includeSpecs:false）
  // 不算「不可读」，单算「声明单源」（34 §7）。事实侧可读性＝目录存在且可读。
  const specSideUnreadable = includeSpecs && specsSource === null;
  const factSideUnreadable = !factsReadable;
  const sourceUnreadable = specSideUnreadable || factSideUnreadable;
  const returnedCount = keptSpecs.length + keptFacts.length;
  // **三态取值先算后用**（N-1）：gaps 第 ④ 项与 recallCompleteness 字段须引用
  // 同一个值，不得各算各的——同一对象字面量内后续声明的键此时尚未求值，
  // 内联 IIFE 无法被 gaps 引用，故提取为函数级 const。判定口径见 return 处注释。
  const recallCompletenessValue = (() => {
    const filteredOut = scopedFacts.length - pool.length > 0;
    const singleSourceByCaller = includeSpecs === false;
    if (sourceUnreadable && returnedCount === 0) return "unavailable";
    if (truncated || filteredOut || sourceUnreadable || singleSourceByCaller) return "partial";
    return "complete";
  })();

  // **F1 决策基线**（`02 §9.1` F1：「类型来源要求的最小权威字段卡片；需要时为
  // 全部指定对象集合分页返回」，用途「建立恢复基线、当前决策/责任全貌」）。
  //
  // 为什么它必须**独立于词法命中**（2026-10-25，Human 决定）：
  // `22 §1` 把 ADR 定为「对 AI 具有持续约束力的**法定效力**决定……违背 active ADR
  // 的行动视同违背规范源」；`22 §12` 又立「**义务召回原则**：相关行动开始前，AI
  // 必须召回并核对相关 active ADR——这是义务而非「需要时查阅」」，并把 F1 明确
  // 定义为「F1 枚举 active ADR **计数**（title + status）」（逐字含「计数」二字，
  // 第四十次审核 Minor-1 修正）、把「当前决策基线就是 active 集本身」写进同一节。
  //
  // 而本模块此前只实现 F2（词法候选卡）：**法定决策的可见性取决于用户当回合恰好
  // 用了什么词**。实测（2026-10-25）：「每次回复先称呼老丁」这条 ADR 在
  // 「把这个函数改成异步的」上完全不被召回，在「总结一下刚才聊的内容」上却因
  // 通用词命中而被召回——义务召回因此悬空。故 F1 基线在此**无条件枚举**，
  // 不参与匹配、不受 `limit`/`types`/`budget` 影响（只受 active 状态约束，
  // `22 §12`：retired 不进入普通候选）。
  //
  // 与 `02 §9.2`「本文不建立所有类型共用的……无条件全量注入」的关系：
  // **此处存在规范解释张力，本实现不作单方裁定**（2026-10-25，第四十次审核 M-4）。
  //
  // 两种读法在文本上都能成立：
  //   · 读法一：限定语「所有类型共用的」统辖整个并列清单，故 `02` 只拒绝跨类型
  //     共用的默认量；同段前句把「本类型的召回时机」明确授权给具体类型来源，
  //     `22` 正是 ADR 的类型权威 → 本段是类型领域增量。
  //   · 读法二：`02 §9.2` 第 1 段的进入条件（「只有在项目事实对当次理解、判断、
  //     验证或行动确实必要……才进入事实消费分支」）**不在**该授权范围内，
  //     而本实现把基线推到每一个行动回合，等于绕过进入条件。
  //
  // 按 `34 §7.5` 层级参考，`02`（层级 2，01–11 基础规范）与 `22`（层级 3，
  // 20–27 事实类型规范）冲突「须提请 Human，不得自行取舍」；按 `01 §7.4` C-1
  // 「权威关系无法确认时，不静默选边」。故：**本实现不写结论式断言**，
  // 该张力已作为待决事项提请 Human 裁定（见提交说明与交还报告）。
  // 裁定前本段按「22 为 ADR 类型权威」实施，这是可回退的临时口径。
  //
  // 只给 title+status（`22 §12` F1 口径）+ 稳定引用 `ref`（供 F3 按需展开）：
  // decision 全文属 F3，常驻会给注入面造成无谓字节压力。
  const decisionBaseline = (() => {
    return {
      // `22 §12`：active 集本身即当前决策基线；retired 不入基线。
      // 枚举与排序已在预算计算处完成（`decisionBaselineForBudget`），此处复用，
      // 避免同一对象字面量内二次枚举导致「预算按 A 算、交付按 B 算」。
      items: decisionBaselineForBudget,
      // **基线自身的可读性须与三态同口径**（N-1 教训）：事实源不可读时基线为空，
      // 若只给空数组，读者会把「读不到」当成「本项目没有 ADR」——正是 34 §12
      // 与 `02 §9.2` 要防的「把零结果当无约束」。故单独标记。
      sourceUnreadable: factSideUnreadable,
      // F1 允许「分页返回」；本实现不持游标，如实声明取全量的方式。
      pagination: { hasCursor: false, howToGetAll: "本字段即全量 active ADR（不按 limit 截断）；逐条全文用 ldvh_adr_read" },
      note: "F1 枚举：不受本次 limit／types／预算影响；retired 不入基线（22 §12）",
      // 该段在总预算中已单独预留的字节数（供调用方核对，不重复计入候选预算）。
      reservedBytes: baselineBytes,
    };
  })();

  return {
    ok: true,
    query: { action, scope: input.scope ?? "", tokens: tokens.length },
    specs: keptSpecs,
    facts: keptFacts,
    // F1 决策基线（见上方 decisionBaseline 的完整理由）：**无条件枚举**全部
    // active ADR，独立于 `specs`/`facts`（后两者是 F2 词法候选）。消费方须把
    // 两者分开呈现——基线是「当前决策全貌」，候选是「本次可能相关的」。
    decisionBaseline,
    // **三段 L0 常驻枚举**（Human 决定 2026-11-04）：与 `specs`/`facts`（F2 词法
    // 候选）是**两种东西**，不合并。ADR 段由 `decisionBaseline` 承载（既有形状
    // 不变），本字段承载 **Norm 段 + 经验段**——消费方须把二者都单独成段呈现。
    //
    // `segments[].lines` 是已排版好的行（段头 + 条目 + 段尾），渲染层只管拼接，
    // 不再做第二次字节决策；`yielded` 为真表示该段在本档预算下整段让位，调用方
    // 须把「该段 N 条未展开」并入披露行（让位不等于静默，同极小预算下决策基线的
    // 痕迹纪律）。`omitted > 0` 且未让位者，其段尾已自带「仅容前 M 条、共 N 条、
    // 全量用哪个工具」的披露，无需调用方二次声明。
    l0Enumeration: {
      order: [...L0_SEGMENT_ORDER],
      segments: l0Plan.segments,
      bytes: l0Bytes,
      note: l0Plan.note,
      // 事实侧可读性：读不到 ≠ 本项目没有这两类常驻对象（34 §12）。
      sourceUnreadable: factSideUnreadable,
      // **经验按需通道的计数**（`34 §8.4` 2026-11-11 重订）：经验不逐条常驻，
      // 但总数必须真实——否则「本类为空」与「未列出」分辨不开（34 §12 三态）。
      // 取自同一次枚举，不另跑扫描。
      // **不可读时给 null 而非 0**：读不到 ≠ 没有（34 §12 三态）——渲染层据此
      // 不出「0 条」那句，避免把「没读到」说成「本类为空」。
      pitfallTotal: factSideUnreadable ? null : l0PitfallTotal,
    },
    truncated,
    overBudget,
    budget: { limitBytes: budgetBytes, usedBytes: used, limit },
    // 34 §13：召回命中 ≠ 适用。
    provesApplicability: false,
    // 确定性召回会漏（换个说法就漏），如实声明，不假装完整。
    // **实测能力边界**（2026-10-24，不可用「可能漏」这种模糊说法搪塞）：
    //
    // **复测结果（2026-10-30）**：用 29 条 active Pitfall 的「症状段」去召回它
    // **复测结果（2026-11-01，判据改固定夹具）**：用夹具语料中症状段 ≥20 字的
    // active Pitfall 的「症状段」去召回它**自己**，**7/7 = 100% 命中**。跨层累计
    // 命中修改前为 22/24——同分靠 UUID 字典序时，有 1 条被挤出 limit；改为全层累计
    // 后它进榜。夹具固定不变，故该比率不再随项目事实源增删漂移；真实语料 2026-11-01
    // 实测为 29/29（历史漂移 23 → 37 → 29，均为真实语料规模变化，不入断言）。
    //
    // **⚠️ 此处的旧论证已被证伪，勿再沿用**：旧注记称「30 条样本只有 13/30 = 43%
    // 命中，原因是 title 描述机制、症状描述表现，二者常常没有任何字面重叠」。
    // 逐条复测后该论断**方向相反**——夹具实测 **5 条有字面重叠、仅 2 条无重叠**
    // （真实语料 2026-11-01 为 64 有 / 1 无）：
    // 因为 `scope` 字段本身就写着适用情形（症状的近义表达），而第 46 轮把正文
    // 匹配改为全文后，症状段（原本被 1200 字符截断挡掉）也能参与匹配。
    // 故「找不到自己的症状」这一失败形态在当前实现下基本不存在。
    //
    // **真正剩余的边界**（这才是需要声明的）：**换个说法就会漏**。字面不重合的
    // 同义表述（「白屏」vs「界面不渲染」）、跨层推断（由**表现**推出**机制**）、
    // 以及上文未出现的关键概念，词法匹配都覆盖不到。词法匹配没有语义能力，
    // 这是它的固有边界、不是可调参数。
    //
    // `23 §12` 的「故障调查」消费点要求「按表现匹配已知机制」，本实现只能做到
    // 「字面相近的表现」；**由表现跨到机制需要语义判断，属 AI 的消费工作**（02 §9.2）。
    // 故该消费点的召回不可依赖本函数单独完成——这条必须让调用方看见。
    coverage: "deterministic-token-match; may miss rephrasings; not exhaustive",
    // **`02 §9.1` 明文要求**：「分层结果的数量、排序、分页、截断、指纹和
    // **未完成范围必须可观察**；超预算必须分页、继续缩小或返回 partial，
    // 不得静默截断后声称完整」。故逐项给出：
    //   数量 → counts；排序 → ranking；分页 → pagination；
    //   截断 → truncated/overBudget；指纹 → fingerprint；
    //   未完成范围 → unchecked（**具体是谁**，不只是一个布尔）。
    partial: truncated,
    // **完整性三态**（`02 §9.2`／`02:308`；判定口径按 34 §12——名称沿用 02，
    // 召回场景的操作口径是 34 §12 的领域增量，其依赖登记亦在该节）。
    //
    // `02:308` 逐字要求「报告 **complete/partial/unavailable** 及具体未完成范围」；
    // `02 §9.2` 末句也要求「未完成、超预算或不可用范围必须按本规范的
    // **partial/unavailable** 边界交还」。此前只有一个布尔 `partial`，
    // 无法区分「拿到了但有缺」与「根本没拿到」——这两者的处置完全不同：
    // 前者可继续用（已知缺什么），后者**不得当作「无相关」**（`02 §9.2` 明禁）。
    //
    // 判定（2026-10-25 第五次审核 M-21 修正——**可读性与「有无对象」分开跟踪**）：
    //   · `unavailable`：34 §12「两源中至少一源不可读，且当次未取得任何可用候选」
    //     ——源不可读（规范侧三级回退全失败，或事实源目录不存在/不可读）且零返回。
    //     此时任何「未命中」都不构成「无相关」的证据（34 §16.1 第 7 项）。
    //   · `partial`：已取得部分候选，但存在因预算、条数、类型/状态过滤或
    //     **单源不可读**而未返回的部分；调用方显式单源（includeSpecs=false）亦属此档
    //     （34 §7：单源结果可以交付，但须声明「本次为单源」）。
    //   · `complete`：两源均可读、无截断、无过滤丢弃、未声明单源——**含「两源可读
    //     但零命中」**（诚实的零命中，34 §6 的零命中退出路径正为此设；旧判定把
    //     「读到了但零对象」归入 unavailable，挡死了该合法路径）。
    // 旧判定的两个实害（M-21）：规范侧回退全失败但事实侧有对象时报 complete
    // （把「规范源根本没读到」洗成「完整召回」，§6 零命中路径据此误放行）；
    // 两源可读但为空时报 unavailable（新建项目永远走不了零命中退出）。
    //
    // **注意命名**（2026-10-24 修）：这里描述的是**本次召回**的完整度，
    // 不是**事实集合**的完整度。二者是不同概念（`02 §10.2` 第四条是后者）：
    //   · 本字段 `recallCompleteness`：这次返回是否齐（受 limit／预算／过滤影响）；
    //   · `f0.setAudit`：事实集合本身是否完整（载入是否成功、有无未可用对象）。
    //
    // 原名为 `completeness`，实测会误导——读者看到 `partial` 会以为**事实源有问题**，
    // 而实际往往只是本次按 `limit` 截断了，事实源完好无损。故改名并在 f0 给出
    // 集合级审计，使两者各归其位。
    //
    // 判定（不能在此引用同级的 `uncheckedRange`——同一对象字面量里后续声明的键
    // 此时尚未求值，会 ReferenceError；故只用前面已算好的量）。
    recallCompleteness: recallCompletenessValue,
    // ── ⑥ 注入分节与名额（仅 `factSelection` 路径）────────────────────
    //
    // 34 §12「标明截断来源」：按名额裁掉的候选必须能说清「裁了哪一类、几条」，
    // 不能只留下「候选变少了」的观感。
    sectioning,
    // ── ⑤ 关系展开（F4 派生，单独归类）────────────────────────────────
    //
    // 不回填进 `facts`：派生条目不是「按查询整个走了一遍候选池」的结果，
    // 若混进去会污染 F2 计数与类型名额（设计明确要求单独归类）。
    relationExpansions: relationExpansion.items,
    relationExpansion: {
      count: relationExpansion.items.length,
      dropped: relationExpansion.dropped,
      max: RELATION_EXPANSION_MAX,
      note: "由精确引用命中对象的判据表关系边派生；不进 F2 候选计数、不占类型名额；目标不可解析者保留并标注",
    },
    // ── 判据表状态（02 §12.4）────────────────────────────────────────
    //
    // fail-closed 的可见面：调用方必须能看见「哪些类型的机器判据被停用、为什么」，
    // 而不是只从行为上察觉候选变少。
    criteria: {
      ok: criteria !== null && criteria.errors.length === 0,
      version: criteria === null ? null : criteria.version,
      errors: (criteria?.errors ?? []).map((error) => ({
        type: error.type ?? null,
        specId: error.specId ?? null,
        file: error.file ?? null,
        code: error.code,
        message: error.message,
      })),
      disabledTypes: disabledCriteriaTypes,
      // 判据表里没有该类型条目 ⇒ 已回落具名兜底（`DEFAULT_STATUSES_FALLBACK`
      // 或 `DEFAULT_STATUSES_BY_TYPE` 的登记值）。回落**必须可见**：`02 §12.4`
      // 禁的是「静默回落默认值」，不是「不许兜底」。
      fallbackTypes: fallbackStatusTypes,
      // 判据表标「默认候选状态＝不采用」的类型（无候选概念，不进候选池）。
      nonCandidateTypes,
      note: "判据表不可用的类型已停用类型点名／核心语义字段／关系展开，按 partial 口径披露",
    },
    counts: {
      // 命中总数（**截断前**）与返回数（截断后）都给出，差额即被丢弃数。
      specHits: allSpecHits.length,
      factHits: allFactHits.length,
      specsReturned: keptSpecs.length,
      factsReturned: keptFacts.length,
      // **实际参与匹配的候选数**（= 规范全量 + 通过类型/状态/白名单过滤的事实）。
      // 曾误写为 `specs.length + facts.length`，其中 facts 是**过滤前**的全量，
      // 于是无论 types 怎么过滤它都恒为同一个数（实测 types=["adr","pitfall"] 与
      // 不传 types 得到同一个值）——「扫了多少」这个数就失去意义。
      // 此处刻意**不写那个恒定值是多少**：它是语料规模的快照，随事实源增长而变，
      // 写进注释就必然过时（friction-943940d6）。判据是「随过滤变化」，不是「等于某数」。
      candidatesScanned: specs.length + pool.length,
      // 载入后**未进入匹配**的候选数（被类型/状态/白名单过滤掉的）。
      candidatesExcluded: scopedFacts.length - pool.length,
    },
    pagination: {
      limit,
      // 本实现不持有跨调用游标（按需重算），如实说明，不假装有游标。
      hasCursor: false,
      howToGetMore: "调大 limit 或缩小 action 描述范围后重新召回（本实现不持有跨调用游标）",
    },
    unchecked: {
      // **未返回集合必须按差集算，不能按「前缀之后」切片**（2026-11-11 修）。
      //
      // 旧实现是 `allXHits.slice(keptX.length)`，其前提是「已返回的恰好是命中列表
      // 的前 keptX.length 条」。事实侧**不满足**这个前提：交付前经过
      // `selectFactsBySection`（分节与类型名额），`selected` 是从各类型分组里挑出来
      // 的，`keptFacts` 已不是 `allFactHits` 的前缀。于是切片把**已返回的对象**
      // 也算进「未列出」——实测（action「当前ldvh在召回上做的如何？」，limit 12、
      // 预算 10240）返回 7 条事实、unchecked.facts 105 条，其中 5 条与已返回重复，
      // 正是这 7 条里的 5 条。
      //
      // 规范侧未分节、kept 仍是前缀（同参数实测重叠 0），但同一段代码对两侧用了
      // 同一个错误前提，故两侧一律改为按 path 的真差集——这样无论交付路径怎么
      // 重排，「未列出」都严格是「命中里没交付的那些」（`34 §12` 逐类对应）。
      specs: diffByPath(allSpecHits, keptSpecs),
      facts: diffByPath(allFactHits, keptFacts),
    },
    // **`gaps`**（`01 §10.3`）：
    // > 读取契约不承载某项时，须**如实披露该项缺失并使其进入 `gaps`**，
    // > 不得以「已披露」或省略代替。
    //
    // 实测缺口（2026-10-24）：本模块此前把缺失写成**说明文字**（如
    // `limitations.unimplemented` 里那段中文），却没有结构化的 `gaps` 字段。
    // 而该条明确禁止「以『已披露』代替」——**只写在文字里不算**：消费方要能
    // 机械枚举出「这次读取有哪些没承载」，字符串说明做不到。
    //
    // 本仓库既有约定见 `adr-tools.js`（多处 `gaps: [...]`），本模块此前未跟上。
    // 逐项检查四类必披露内容是否承载，缺者入 gaps：
    gaps: [
      ...criteriaGapsOf(criteria, scopedFacts),
      // ① 来源视图：三级回退全失败时无来源可披露。
      ...(includeSpecs && specsSource === null
        ? ["来源视图缺失：规范源三级回退（01 §10.3）均无可用语料"]
        : []),
      // ② 候选集合指纹：`fingerprintOf([...specs, ...facts])` 恒有返回值（覆盖空集），
      //    故不设缺失分支——此处不造假想的 gap。
      // ③ 各载体内容指纹：任一卡片缺指纹即登记（不留「多数有」的模糊印象）。
      ...[...allSpecHits, ...allFactHits].some((c) => c.source?.contentFingerprint?.value === undefined)
        ? ["部分载体内容指纹缺失"]
        : [],
      // ④ 完成与未完成范围：由 recallCompleteness 承载，unavailable 时即为 gap。
      //    （N-1：旧判据用 `specs.length + facts.length === 0` 近似「不可读」，
      //    与 M-21 修正后的三态口径不一致——改用同一套可读性变量。）
      ...(recallCompletenessValue === "unavailable"
        ? ["完成范围：一源不可读且未取得任何候选，无法给出任何结果"]
        : []),
      // ④bis 单源不可读（N-1）：即使另一源有命中使整体为 partial，不可读的那一源
      //     仍是「未检查范围」，须结构化登记——否则取值如实而清单失实。
      ...(specSideUnreadable
        ? ["规范源不可读：01 §10.3 三级回退均无可用语料，该源未检查"]
        : []),
      ...(factSideUnreadable
        ? ["事实源不可读：项目内 ldvh-base/ 不存在或不可读，该源未检查"]
        : []),
      // ⑤ 明确的未兑现能力（见 limitations.unimplemented）：同样必须入 gaps，
      //    否则「已写在 limitations 里」正是该条禁止的「以已披露代替」。
      ...(includeSpecs ? [] : ["规范源未读取（includeSpecs:false）"]),
      // ⑤ 明确的未兑现能力必须**同时**进入 gaps——`limitations.unimplemented`
      //    里写着“既有行动结构路由未实现”，但那只是说明文字；`01 §10.3` 明禁
      //    「以『已披露』或省略代替」，故这里必须再结构化登记一次。
      "既有行动结构路由未实现（10 §5.3 要求；无可路由载体，见 limitations.unimplemented）",
      // **未登记事实类型须进 gaps**（2026-10-24 修，第 70 轮）。
      //
      // `ldvh-base/` 下若出现白名单外的类型目录（新增事实类型而代码未跟随，
      // 或第三方工具写入的目录），当前实现会**静默挡掉**——用户只会看到
      // 「没有这类事实」，而实际是「有，但我不认识」。
      //
      // `02 §9.2` 禁把零结果当无约束；同一道理，禁把「不认识」当「不存在」。
      // 具体被挡的条目另见 uncheckedRange.excludedByTypeWhitelist。
      ...(() => {
        const unknown = scopedFacts.filter((fact) => !REGISTERED_FACT_TYPES.includes(fact.type));
        if (unknown.length === 0) return [];
        const byType = [...new Set(unknown.map((fact) => fact.type))].sort();
        return [
          `未登记事实类型被排除在召回外：${byType.join("、")}（共 ${unknown.length} 条）。` +
            `这不表示该类事实不存在——是白名单未收录，须按 20–27 的类型规范同步 REGISTERED_FACT_TYPES`,
        ];
      })(),
    ],
    // **F0 层**（`02 §9.1`）：类型/状态计数、coverage、未完成范围。
    //
    // 实测缺口（2026-10-24）：本模块此前只有「本次召回的命中数」，
    // **没有 F0 层**。而 `02 §9.1` 对 F0 的定义逐字包含：
    // > 管辖项目、实际 worktree/common-dir、**类型/状态计数**、Schema/对象集指纹、
    // > 当前工作对象、coverage、cursor、无效/不可用对象清单和未完成范围
    //
    // 缺它的直接后果：状态计数这种事**不该靠词法匹配**——实测用「有多少候选在等」
    // 查只能命中 0 条，「待确认的候选」命中 2 条，而全库当时的实际条数远多于此。
    // 2026-11-03 起 Pitfall 取消 `draft` 待确认态（该类型的「在等」档消失），
    // 但 WorkCase 等类型的 `draft` 仍需按状态计数可见——故 F0 的全量类型×状态
    // 计数照旧必须存在，且不依赖查询措辞。
    //
    // 故这里给出全量（不受 types/statuses 过滤影响）的类型×状态计数，
    // 使「有多少在等」可被直接回答，而不依赖查询措辞。
    f0: {
      // 全量对象计数：type → status → count。**不受本次 types/statuses 过滤影响**，
      // 因为 F0 描述的是事实源的整体状况，不是本次召回的子集。
      countsByTypeStatus: facts.reduce((acc, fact) => {
        acc[fact.type] ??= {};
        acc[fact.type][fact.status] = (acc[fact.type][fact.status] ?? 0) + 1;
        return acc;
      }, {}),
      totalObjects: facts.length,
      // coverage：本次实际扫描的候选占全量的比例（`02 §9.1` F0 要求可观察）。
      coverage: {
        scanned: specs.length + pool.length,
        totalLoaded: specs.length + facts.length,
        // 未参与匹配的（被类型/状态/白名单过滤）——与 uncheckedRange 同源但此处给数。
        notScanned: scopedFacts.length - pool.length,
        // **声明范围之外**的类型条数（`excludedTypes`）：它们不属本次职责范围，
        // 故不算 notScanned（那会把「不归我管」说成「我漏了」），但也不能不报，
        // 否则 totalLoaded − scanned 会凭空对不上账。
        notInScope: facts.length - scopedFacts.length,
      },
      // 类型清单：使消费方能知道「有哪些类型存在」，而非只知道「命中了哪些」。
      typesPresent: [...new Set(facts.map((fact) => fact.type))].sort(),
      // **集合完整性审计**（`02 §10.2` 第四条：「对当前 WorkTree 的事实集合执行
      // 独立机械校验，报告 complete/partial/unavailable 及具体未完成范围」）。
      //
      // 与 `recallCompleteness` 的区别：这一项回答「**事实源本身**是否完整」，
      // 不受本次 limit／types／statuses 影响——`ldvh-base/` 里的对象要么都被
      // 载入了，要么有失败。实测本仓 310 个对象全部载入成功，故此值应为
      // `complete`，即便某次召回因 limit 只返回了 3 条。
      setAudit: {
        status: specs.length + facts.length === 0 ? "unavailable" : "complete",
        // 具体未完成范围：本实现一次读完全部载体（无分页、无跳过），
        // 故正常情形为空；目录不存在时由 unavailable 承载。
        notCompleted: specs.length + facts.length === 0
          ? ["事实源与规范源均未读到"]
          : [],
        note: "本实现一次读完全部载体（不建索引、不分页载入），故载入阶段无部分完成状态；本次召回的截断另见 recallCompleteness",
      },
    },
    // **未检查范围**（`02 §9` 第 2 项：「召回…并保留命中依据和**未检查范围**」）。
    //
    // 与 `unchecked` 的区别（两者常被混为一谈，语义完全不同）：
    //   · `unchecked`：**已匹配但被截断丢弃**——这些是相关的，只是没列出来；
    //   · `uncheckedRange`：**从未参与匹配**——被类型/状态/类型白名单过滤掉的，
    //     以及根本没被载入的来源（如 includeSpecs:false 时的规范源）。
    //
    // 后者才是「我不知道有没有相关东西」的范围。不给出它，读者会把
    // 「没看到」误当成「没有」——正是 `02 §9.2` 要防的「把零结果当无约束」。
    uncheckedRange: {
      // 被过滤掉的事实（按原因分列，读者可判断是否需要放宽）。
      excludedByTypeFilter: types === null ? [] : scopedFacts
        .filter((fact) => !types.includes(fact.type))
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      excludedByStatus: scopedFacts
        .filter((fact) => types === null || types.includes(fact.type))
        // 判据表标「不采用」的类型单列（`excludedByNonCandidate`）：它们不是
        // 「状态不在默认集里」，而是**没有候选概念**。混入本列会让读者去放宽
        // 状态，而放宽状态对它们无效。
        .filter((fact) => statusPolicyOfType(fact.type).kind !== "non-candidate")
        .filter((fact) => !statusAllowed(fact.type, fact.status))
        .map((fact) => ({ type: fact.type, status: fact.status, title: fact.title, path: fact.path })),
      // **没有候选概念的类型**（判据表「默认候选状态＝不采用」，目前只有 Goal
      // 单例）：不进候选池，也绝不回落成 active。单列而非并入状态过滤，理由见上。
      excludedByNonCandidate: scopedFacts
        .filter((fact) => types === null || types.includes(fact.type))
        .filter((fact) => statusPolicyOfType(fact.type).kind === "non-candidate")
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      // **被结构化 facet 筛掉的**（2026-10-29）：与上面两类同性质——它们不是
      // 「排得靠后」，而是**从未进入候选池**。列入本清单是 `34 §12` 的硬要求：
      // 「取值须与下段的未检查范围逐类对应，不得只给取值不给清单」。
      //
      // 不列这一项的后果是具体的：按某个闭集字段收窄后命中 0 条时，读者会把
      // 「没有该取值的 open 条目」读成「没有该取值的条目」——而实际是其余条目
      // 处于终态（各类型规范：终态不进 F2 默认候选），被 `excludedByStatus`
      // 排除；另有可能因类型不在本次范围内被 `excludedByTypeFilter` 排除。
      // 各类原因必须分开呈现，否则读者会归错因。
      excludedByFacet: appliedFacets.length === 0 ? [] : scopedFacts
        .filter((fact) => REGISTERED_FACT_TYPES.includes(fact.type))
        .filter((fact) => types === null || types.includes(fact.type))
        .filter((fact) => statusAllowed(fact.type, fact.status))
        .filter((fact) => !pool.includes(fact))
        .map((fact) => ({
          type: fact.type,
          status: fact.status,
          title: fact.title,
          path: fact.path,
          // 该对象在本 facet 上的**实际取值**，让读者看见「差在哪」而不是
          // 只知道「它被筛掉了」。缺字段时如实写 null（不是空串——空串会被
          // 读成「有字段但值为空」，二者在判断上不同）。
          values: Object.fromEntries(appliedFacets.map(([name]) => {
            if (name === "objectUid") return [name, fact.ref ?? null];
            if (name === "relationKey") {
              return [name, (fact.structural?.relationKeys ?? []).length > 0
                ? fact.structural.relationKeys : null];
            }
            const key = {
              serves: "serves", priority: "priority",
              directionKey: "directionKey", attributionRef: "attributionRef",
            }[name];
            const v = key === undefined ? undefined : fact.structural?.[key];
            return [name, typeof v === "string" && v !== "" ? v : null];
          })),
        })),
      // 本次**实际生效的 facet 清单**（空数组=未收窄）。显式给出而不只给被筛条目
      // 的原因与 `scopeExcluded` 相同：条数回答「这次有几条没进来」，清单回答
      // 「这次问了什么条件」——后者是读者复核「我筛对了吗」的唯一依据。
      appliedFacets: Object.fromEntries(appliedFacets),
      excludedByTypeWhitelist: scopedFacts
        .filter((fact) => !REGISTERED_FACT_TYPES.includes(fact.type))
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      // **声明范围之外**（`excludedTypes`）：这些类型不属本路径职责，其消费入口
      // 在别处（Spark 见 `31 §10` 的 `ldvh_spark_list` 主动查）。**单列一项而不并进
      // 上面三类**，是因为三者都回答「我漏了什么」，而本项回答「什么不归我看」——
      // 混为一谈会让读者把职责边界读成召回缺陷。
      excludedByScope: excludedTypes === null ? [] : facts
        .filter((fact) => excludedTypes.includes(fact.type))
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      // **声明范围本身**（`excludedTypes` 非空时才出现）：把「本路径不含哪些类型」
      // 作为一条**事实**交还，而不只是交还被排除的条目。
      //
      // 为什么不能只报 `excludedByScope.length`：条数回答「这一次有几条没归我看」，
      // 而读者真正需要知道的是「**这个路径结构上不含哪些类型**」——后者是稳定的
      // 职责边界，不随事实源里恰好有几条而变。零条时 `excludedByScope` 是空数组，
      // 若只靠它披露，读者会以为「这次没有东西被排除」，而实际是该类型整体不在
      // 扫描范围内（`34 §12` 禁的正是这类「只给取值不给清单」：把「范围不含」
      // 说成「本次没有」）。
      scopeExcluded: excludedTypes === null ? null : {
        types: [...excludedTypes],
        // **逐类型的替代入口，结构化为 {type: 入口名}**（范围受限复审，2026-10-28）：
        // 原先这里是自由文本 `alternativeEntry`，而渲染层并不读它、自己又硬写了一份
        // `spark → ldvh_spark_list` 的映射——同一事实两处维护，改一处就会不一致
        // （`01 §11.4` 第二规则源）。现改为数据层给出结构，渲染层只负责措辞。
        //
        // **未登记的排除类型不得静默缺入口**（2026-11-11 补）：`excludedTypes` 是
        // 调用方入参，可能含本表未收录的类型。旧写法 `filter(type === "spark")`
        // 会让未收录类型在渲染面掉进「须另行查询」——那至少是诚实的；但如果日后
        // 新增排除类型却忘了在这里补入口，读者就永远拿不到可执行的下一条指令，
        // 而没人会注意到。故此处以**具名映射表**承载，并在数据层断言：任何被排除
        // 的类型都必须在本表里，缺则抛错使问题在开发期暴露，而不是让它在运行期
        // 退化成一句笼统的提示。
        entryByType: Object.fromEntries(
          excludedTypes.map((type) => {
            const entry = SCOPE_EXCLUDED_ENTRY_BY_TYPE[type];
            if (typeof entry !== "string" || entry === "") {
              throw new Error(
                `召回：类型「${type}」被声明为排除，但 SCOPE_EXCLUDED_ENTRY_BY_TYPE 没有它的主动查入口——`
                + "新增排除类型时须同时登记入口，不得让读者停留在「须另行查询」",
              );
            }
            return [type, entry];
          }),
        ),
      },
      // 整源未载入（N-1：三种情形都算「该源完全没看」，逐类列出）：
      //   · 调用方显式排除规范源（includeSpecs:false）；
      //   · 规范源三级回退全失败（不可读）；
      //   · 事实源目录不存在或不可读。
      // 34 §12「取值须与未检查范围逐类对应」——取值说了 partial/unavailable，
      // 清单就必须说清缺的是哪一源。
      sourceNotRead: [
        ...(includeSpecs ? [] : ["规范源（includeSpecs:false，未读取）"]),
        ...(specSideUnreadable ? ["规范源（01 §10.3 三级回退均无可用语料，不可读，未读取）"] : []),
        ...(factSideUnreadable ? ["事实源（项目内 ldvh-base/ 不存在或不可读，未读取）"] : []),
      ],
      // 事实源无第二来源可回退，故此处只有项目内一源；若将来引入回退须在此列出。
      // **note 只声称实际扫描了什么**（N-1：旧文案在 ldvh-base/ 不存在时仍无条件
      // 声称「扫描项目内 ldvh-base/」，与 00 §4.6 据实声明相抵）。
      note: `本次实际扫描：${specSideUnreadable ? "规范源不可读（未扫描）" : includeSpecs ? `规范源（01 §10.3 第 ${specsSource?.tier === "project" ? "1（项目自著）" : specsSource?.tier === "source-repo" ? "2（插件源仓库）" : "3（插件包内副本）"}级）` : "规范源（includeSpecs:false，未扫描）"}；${factSideUnreadable ? "事实源 ldvh-base/ 不存在或不可读（未扫描）" : "事实源（项目内 ldvh-base/）"}。其它目录、其它 worktree、回退来源之外的语料均未检查`,
    },
    // 排序依据如实声明（`02 §9` 红线：不得用相似度/embedding/关键词权重/AI 裁决相关性）。
    ranking: {
      keys: ["tier", "hits", "path"],
      // **`usesWeights` 必须说真话**（2026-10-27 修正）：此前写 `false`，但
      // `hits` 自引入 idf 加权后已是**统计权重**，并参与排序——声明与实现不符。
      // 守护它的用例曾断言这个字面量 `false`，实现怎么变都通过（恒真）。
      //
      // **规范边界（`02:262` 原文核对）**：禁的是「Code 不得使用相似度、
      // embedding、关键词权重或 AI 输出**自动裁决**相关性、适用性或事实结论」。
      // 即禁**裁决**，不禁**排序**。`34 §7` 的召回要求反而明写「形成少量候选，
      // 并**保留命中依据**」——有依据、有先后是设计本意。
      // 故此处如实记 `true`，并同时声明：排序**不是**裁决，候选一律作为候选
      // 交付（`truncationIsNotJudgement`），是否适用仍由语义消费判断。
      usesWeights: true,
      usesSimilarity: false,
      usesEmbedding: false,
      usesAiJudgement: false,
      truncationIsNotJudgement: true,
      // **`hits` 的语义已变**（2026-10-27，独立审核中等项 5）：它不再是「同层
      // 命中词个数（等权）」，而是**跨层命中词经 idf 加权后的厚度**（见
      // matchCandidate 的 BM25 段）。原注释随字段对外返回，与实现不符即失真。
      // 另外它**不是**标准 Okapi BM25 分：`tokenize` 对同词去重使 tf 恒为 1
      // （tf 饱和是死代码），`dl` 是去重后词表大小而非文档长度，且两源各建
      // 语料统计故 idf 跨源不可比——故此值只可用于**同源内排序**，不可当分数比较。
      note: "tier 是字段位置（确定性）；hits 是跨层命中词经 idf 加权的厚度（可复算，但非标准 BM25，tf 恒为 1，跨源不可比），path 仅为稳定输出；limit 截断只表示排得靠后，不表示不相关",
    },
    fingerprint: fingerprintOf([...specs, ...facts]),
    // 结构化的能力边界（供程序判定，不必解析自由文本）。
    limitations: {
      // 词法匹配无法从「表现」跨到「机制」，这是固有边界而非缺陷。
      lexicalOnly: true,
      usesSemanticUnderstanding: false,
      // **实测：用 Pitfall 自身的「症状段」去召回它自己，37/37 = 100% 命中**
      // （2026-10-28 复测；2026-10-27 跨层累计修改后曾由 22/24 提升到 23/24；样本随事实源增长而变）。
      //
      // 旧值为 43%（13/30），那是**第 46 轮之前**（正文只匹配前 1200 字符时）的
      // 测量。第 46 轮改为全文匹配后，`scope` 与正文里的症状描述都能参与匹配，
      // 该比例已不可用——渲染行却仍在每回合宣称「仅 43%」，属**散布过时信息**。
      //
      // 测量方法注意：不能拿 `scope` 原文去查（那会靠 `scope` 命中自己，是循环
      // 自证）。这里取 body 里「## 症状」段的首句自然语言，避开循环。
      // ── 该指标已**降级为「不具质量判别力」**（2026-10-27，第 2 步）──────
      //
      // 独立审核用双版本数字证明它与**真实召回质量不相关**：
      //   · 旧版实现 24/24（top3 22/24）—— 新版实现 24/24（top3 23/24）
      //   · 同期真实精确率 **13.9% → 10.5%（下降）**
      // 指标上升、质量下降。原因：它测的是「同一篇文档的**正文**去召回自己的
      // **标题**」，机制词、代码标识符、报错字符串被保证同时出现；而用户的输入
      // 只有表面症状，不共享这套词汇。它测的是**词表重叠**，不是**检索有用性**。
      //
      // 保留字段（消费方可能在读）但显式标明其地位；判据请改用
      // `plugin/test/recall-quality.test.mjs` 的自然语言查询集。
      // **注意：本字段测的不是「症状段→自身」**（后者见上方能力边界段，实测
      // 37/37）。本字段测的是「**正文**→自身**标题**」，是词表重叠的度量，
      // 与检索有用性不同距离——两者数字相近极易混淆，故在此显式区分
      // （范围受限复审，2026-10-28 指出注释与字段值看似矛盾，实为两个指标）。
      measuredSymptomSelfRecall: {
        // **本字段是「某一天的语料快照」，不是不变量**（friction-943940d6）。
        //
        // 它记的是一次实测：那一天 active Pitfall 有几条、其中几条能被自己的
        // 症状段召回。分母**随语料增长**，故永远会过时——这不是缺陷，是这类
        // 计数指标的性质。此前把它当常量、由用例逐值比对（声明 41/42 vs 实测
        // 46/47 就红），红的是语料不是实现。现由 `test/recall-injection.test.mjs`
        // 改守**不变量**：内部自洽、不越界、与本批语料实测比率容差比对。
        //
        // 2026-11-03 实测：active Pitfall 47 条、症状段≥20 字者 47 条，
        // 症状段→自身 **46/47 = 98%**。未命中的一条是 689d5c26（破坏性 mv 以
        // glob 作目标）：其症状首句里的可检索词被同族条目稀释，10 条名额内排不
        // 进自己。历史值见下方注释（各带日期，不入断言）。
        //   · 2026-10-24：13/30 = 43%（旧实现，正文仅匹配前 1200 字）
        //   · 2026-10-27：23/23（改全文匹配后）；2026-10-28：37/37
        //   · 2026-11-02：41/42
        hits: 46,
        total: 47,
        measuredAt: "2026-11-03",
        discriminatingPower: "none",
        why: "测「正文→自身标题」，与用户口吻查询不同距离；双版本同为 24/24 而真实精确率 13.9%→10.5%，故不得据此判断召回质量。质量基线见 test/recall-quality.test.mjs",
      },
      // 因此哪些消费点不能只靠本函数。
      // **实测能力**（2026-10-24，第 56 轮复测）。
      //
      // 此字段此前写死一条：「23 §12 故障调查（按表现匹配已知机制——跨层需要
      // 语义判断）」，即声称本模块**不足以**承担故障调查。该结论基于已被证伪的
      // 43% 测量（见本函数前文的复测说明），**现予更正**：
      //   · **前半句**当查询 → **22/23 = 96%** 召回自身（limit=3 实测）；
      //   · **后半句**当查询（模拟「换个说法」）→ **实测同义改写 100% 仍命中**
      //     （2026-11-01 改固定夹具后实测 6/6；此前用真实语料测得 25/28 = 89%，
      //     limit=8，2026-10-30 复测）。2026-10-27 第 1 步排序改动前该值为
      //     22/22 = 100%，改动后降为 21/23、真实语料复测为 25/28——这是「类型优先级
      //     从绝对前置改为同分时生效」的真实代价：有 Pitfall 因非 pitfall 类型的
      //     高 tier 命中被挤后。如实记录，不隐瞒；该取舍的收益是「缓存」类查询的
      //     相关项从第 29 位升到第 15 位。
      //     **分母随语料增长**（症状段 ≥40 字者：22 → 23 → 28），比率下降部分是
      //     稀释而非能力退化；但 2026-10-30 复测同时发现「结构命中淹没主题查询」
      //     的独立问题（见 test/source-recall.test.mjs 的 ADR 类型优先用例），
      //     那是真退化，另案处理。
      //     **2026-11-01 判据改固定夹具**（老丁 m00559）：该比率此前与项目真实语料
      //     绑定，语料每增一条坑就漂一次，用例红的是语料不是实现。现由
      //     `test/source-recall.test.mjs`「「同义改写 95% 命中」须与实测一致」用
      //     **固定夹具语料**（`FIXTURE_PITFALLS`）复算并与此处注释比对。
      //     **注意：该百分比只留在本条注释里，不得写进下面面向用户的
      //     `insufficientForConsumptionPoints` 字符串**——那是给消费方读的能力声明，
      //     写夹具数字等于向用户虚报（00 §4.6 据实声明）。
      //     **2026-10-28 订正**：此前两条 bullet 都写「后半句」，把前半句的
      //     96% 误记为 91%，且两个不同的分母（23/22）并列易被读成同一指标——现按
      //     实测分列，样本均为 23 条（症状段 ≥40 字者）。
      //   · 5 条真实使用者症状（「页面白屏了什么都看不到」「字段被删了」
      //     「提交被门禁拒绝了」等）→ 均召回了高度相关的 Pitfall。
      //
      // 但**仍不足以据此断言「满足 23 §12」**：`23 §12` 要的是「按表现匹配
      // **已知机制**」，而匹配到 Pitfall 只给出了候选，是否踩到同一个机制仍需
      // 语义判断（`02 §9.2`「机械有效不能替代语义相关」）。故此处不填
      // 「不足」，而如实声明**能做到什么、做到哪一步**。
      insufficientForConsumptionPoints: [
        "23 §12 故障调查：可召回「表现相近」的 Pitfall，但「是否同一机制」须由消费方语义判断——本模块只提供候选",
      ],
      // **未兑现范围**（`00 §4.6` 据实声明 / `00 §4.7` 交还）：`10 §5.3` 规定
      // 行动前引导入口须「提供事实候选**与既有行动结构路由**」。
      //
      // 本函数只做了前一半。后一半**当前无载体可路由**：
      //   · `03:447` 说明旧 `action-template-foundation`（行动模板基础规范）已退出，
      //     其「可复用行动结构」内容「在相应业务系统规范按本文 §9 承接之前，
      //     **不取得规范效力**」；
      //   · `ldvh-base/` 下也无 action/template 类事实载体（实测只有
      //     adrs/frictions/norms/pitfalls/researches/sparks/goal/workcases）。
      //
      // 故这不是「本函数忘了做」，而是**上游承载尚未建立**。如实登记为未兑现，
      // 不伪造一个空的路由字段冒充已实现。
      unimplemented: [
        {
          item: "既有行动结构路由",
          requiredBy: "10 §5.3（行动前引导入口须提供事实候选与既有行动结构路由）",
          reason: "无可路由载体：03:447 声明旧行动模板规范已退出且其内容在 §9 承接前不取得规范效力；ldvh-base/ 下无 action/template 类事实类型",
          status: "unavailable-until-carrier-exists",
        },
      ],
    },
    // **来源披露**（01 §10.3）：如实标注规范语料的实际应答方，不得把回退来源
    // 表述为项目自著语料。`tier` 为 null 表示三级都无可用语料。
    sourceView: {
      specs: specsSource === null ? null : { tier: specsSource.tier, dir: specsSource.dir },
      // 项目自著语料与回退来源是**不同来源**，消费方须能区分。
      // 由回退来源应答时，01 §9.2 的机械核对对该受辖项目按「不适用」报告。
      specsAreProjectAuthored: specsSource !== null && specsSource.tier === "project",
      facts: { dir: join(root, "ldvh-base") },
    },
  };
}
