// source-recall.js —— 行动前召回规范源与事实源（双源召回系统的取得环节）
//
// ## 这个模块在干什么
//
// 34 §7「输入来源」逐字：
//   「规则来源为规范源（经 01 §10 的 L0–L4 读取取得）；事实来源为事实源（经 02 §9
//    的 F0–F4 召回取得）；决定来源为 Human 决定记录与各事实类型中的决定类对象；
//    授权来源为 00 §4 与各授权程序。输入来源的读取深度须与风险层相称（03 §6.1）。」
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
// | 性质 | 语义判断（`00 §5`），属 34 的职责 | 词法匹配，属引导面（`10 §5.3`） |
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

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

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
 *   · Pitfall（23 §12）是 `active` → 恰好正确（draft 只在「待确认队列」专门查询时列出）。
 *
 * 合计 **142 条本可召回的事实**默认完全不可见。
 *
 * 逐条依据：
 *   · `20`「默认候选只包含 open Spark；implemented/discarded 不进入普通未处置候选」；
 *   · `21 §13`「默认候选只含 draft 与 open；closed 只在精确引用、证据链反查或历史追溯时展开」；
 *   · `23 §12`「默认候选只含 active；draft 不进入默认候选——它尚未入档」；
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
  workcase: ["draft", "open"],
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
});

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
  "spark", "workcase", "adr", "pitfall", "research", "goal", "friction", "norm",
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

/**
 * 把一个候选的全部可匹配文本拼成一段，供**跨层累计命中**使用。
 *
 * 顺序无关（只用于取并集去重），故按 tier 从精确到宽泛拼接，便于调试时对照。
 * 单字不参与累计（与 `matchCandidate` 的 `strong` 口径一致）——单字在语料里
 * 覆盖 90%+，计入累计会把「跨层厚度」变成噪声放大器。
 */
function sectionsText(candidate) {
  return [
    candidate.scope,
    candidate.detail,
    candidate.title,
    candidate.bodyText ?? candidate.body,
  ].filter((t) => typeof t === "string" && t !== "").join("\n");
}

/** 两个 token 集的交集大小（不打分做排序，只用于「是否有交集」与命中理由）。 */
function intersect(a, b) {
  const set = new Set(b);
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

/** 解析 markdown 顶层 frontmatter（`key: value` 与 `key:\n  - item` 两种）。 */
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
 * 状态的**准入等级**：数字越小越优先。用于排序，防止「未准入的草稿」仅因更新
 * 而压掉「已准入的权威对象」。
 *
 * 背景（2026-10-27 实测）：加入「最后更新时间」作次级键后，调用方一旦放宽
 * `statuses`（如复核草稿时传 `["active","draft"]`），新写的 draft 会凭时间
 * 新鲜排到 active 之前——实测「校验验证」查询变成清一色 `pitfall/draft`，
 * 权威的 active 全部被挤出。**新 ≠ 更权威**，故状态等级须先于时间比较。
 *
 * 分级依据：`active`／`open` 是各类型规范定义的「当前生效」态（见
 * `DEFAULT_STATUSES_BY_TYPE`）；`draft`／`pending` 是**尚未准入**；其余
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
 * 5. 必需类型（adr/pitfall）在同分时优先（`22 §12` 义务召回）。
 * 6. `updatedAt`——同分时较新的先看（Human 裁定；实测多为惰性键，见下）。
 * 7. `path`——仅为稳定输出。
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
/**
 * **方向讨论**的动作迹象（`31 §10` 消费时机第 1 项：「讨论与规划时：召回相关
 * 未决方向，判断当次讨论是否已有前情」）。
 *
 * **这是同分时的组内重排，不是新增必需类型。** `REQUIRED_RECALL_TYPES` 的语义是
 * 「`03 §6.1` 标准路径点名的必需集」，其值（adr/pitfall）由该条原文固定，
 * 本模块不改它——把 Spark 提为必需类型会扩张一条跨类型强制召回规则，超出
 * `03 §6.1` 已点名的两类，属 `00 §4.2` 的规则扩张，须经规范修订与 Human 决定。
 *
 * 故此处只做一件事：**当动作迹象表明本回合在讨论/规划方向时**，命中的
 * open Spark 在**证据同分**的前提下先于其它非必需类型。三条边界（缺一即越界）：
 *   1. 不改变必需集，ADR/Pitfall 仍在同分时优先（`03 §6.1` 不被削弱）；
 *   2. 不增加返回条数，`limit` 与预算口径完全不变（不烧额外注入预算）；
 *   3. 不清除任何类型——其余类型仍全部保留，只是同分时相对次序变化。
 *
 * **它排在证据强度之后**（`weakHit`→`tier`→`hits` 之后、必需类型同分位之前）：
 * 证据更强的候选永远先看，方向讨论只解决「同样强时谁先」——这与 `compareFactHits`
 * 第二版「证据强度先行」的教训一致，不得拿它做无条件前置。
 *
 * 判据是**确定性词表匹配**（`02 §9` 红线：不得用相似度/AI 输出裁决相关性）。
 * 词表只收「讨论、规划、方向、议题、悬置」这类**指向方向线本身**的词，
 * 不收「改、修、查、推进」这类动作词——「推进工单」不是讨论方向的迹象，
 * 把动作词收进来会让该优先位在无关回合被激活，等于把噪声排到前面。
 */
export const DIRECTION_DISCUSSION_MARKERS = Object.freeze([
  "讨论", "规划", "方向", "议题", "悬置", "未决", "火花", "spark", "方向线",
]);

/**
 * 本回合动作是否带「讨论/规划方向」的迹象（`31 §10` 消费时机第 1 项）。
 *
 * 返回 `true` 时，open Spark 在**证据同分**时获得排序优先——**仅此而已**：
 * 不改变是否召回、不改变条数与预算、不越过证据更强的候选。
 */
export function isDirectionDiscussion(action) {
  if (typeof action !== "string" || action === "") return false;
  const lowered = action.toLowerCase();
  return DIRECTION_DISCUSSION_MARKERS.some((marker) => lowered.includes(marker));
}

export function compareFactHits(a, b, { directionDiscussion = false } = {}) {
  const fa = a?.fact ?? {};
  const fb = b?.fact ?? {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const evidence =
    Number(fa.weakHit === true) - Number(fb.weakHit === true) ||
    num(fa.tier) - num(fb.tier) ||
    num(fb.hits) - num(fa.hits);
  if (evidence !== 0) return evidence;
  const rank = (f) => (REQUIRED_RECALL_TYPES.includes(f.type) ? 0 : 1);
  // 方向讨论回合的 open Spark 同分组（`31 §10` 消费时机第 1 项）。
  // **值取 0.5 而非 0**：必需类型（rank 0）仍须先于它，故它只能在
  // 「非必需且非 Spark」的 rank 1 之前——不得越过 ADR/Pitfall。
  const directionRank = (f) =>
    directionDiscussion && f.type === "spark" && f.status === "open" ? 0.5 : rank(f);
  return (
    statusRank(fa.status) - statusRank(fb.status) ||
    directionRank(fa) - directionRank(fb) ||
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
 * **与注入路径的 `RECALL_BYTE_BUDGET`（2400）是两个不同的常量**——本接口面向
 * CLI／诊断脚本等直接调用方，候选预算较宽；注入路径受引导面预算约束，须更紧。
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
  const files = await readdirOrEmpty(specsDir);
  const markdown = files.filter((f) => f.endsWith(".md")).sort();
  const out = [];
  for (const file of markdown) {
    const text = await readFile(join(specsDir, file), "utf8");
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
export async function loadFacts(baseDir) {
  // 同 loadSpecs：事实源目录不存在时返回空数组，不抛 ENOENT。
  const entries = await readdirOrEmpty(baseDir, { withFileTypes: true });
  const dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const out = [];
  for (const dir of dirs) {
    const files = (await readdirOrEmpty(join(baseDir, dir)))
      .filter((f) => f.endsWith(".md")).sort();
    for (const file of files) {
      const text = await readFile(join(baseDir, dir, file), "utf8");
      const fm = parseFrontmatter(text);
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
      out.push({
        source: "fact",
        // 类型名直接取 frontmatter 的 fact_type_key（权威），不从目录名猜单复数——
        // 「researches→research」这类英文变形易错（曾得 "researche"/"workca"）。
        type: fm.fact_type_key || dir.replace(/s$/, ""),
        dir,
        ref: fm.object_uid || file.replace(/\.md$/, ""),
        title: fm.title ?? "",
        status: fm.status ?? "",
        scope: fm.scope ?? fm.scope_boundary ?? "",
        // 类型相关的可匹配字段，逐类拼在一起。
        detail: [
          fm.decision, fm.phenomenon, fm.question, fm.research_question,
          fm.gist, fm.intent, fm.direction_key, fm.research_purpose,
          // **`trigger_signal` 必须进匹配面**（2026-10-24 修）。
          //
          // 此前它被单独读进 `trigger` 字段、**从未参与任何匹配层**——读进变量
          // 却不用，等于「重新审视信号」对召回不可见。
          //
          // `23 §8` 对它 的定义是「**重新审视信号**：存在真实重审前提时写
          // （依赖版本变更、环境迁移等）」。这恰是召回最该用的一种输入：用户说
          // 「升级了依赖」「换环境了」时，应当召回那些标了该信号的 Pitfall，
          // 否则「何时该重看这条经验」这条信息就白记了。
          fm.trigger_signal,
          // **`summary` 必须进匹配面**（2026-10-24 修，第 48 轮曾误以为已加、实际未生效）。
          //
          // 全库 94 条事实带 summary。各类型都把它当核心内容：
          //   · `20`：「**完整的当前语义快照**……使未读原聊天的后续执行者可独立理解」；
          //   · `21`：「要做什么的完整语义快照」。
          // 即它是最该被召回的那段话——记了却不参与匹配，等于白记。
          fm.summary,
        ].filter(Boolean).join(" "),
        trigger: fm.trigger_signal ?? "",
        summary: fm.summary ?? "",
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
        excerptSource:
          fm.summary ?? fm.gist ?? fm.decision ?? fm.phenomenon
          ?? fm.research_question ?? fm.scope ?? fm.scope_boundary ?? "",
        path: `ldvh-base/${dir}/${file}`,
        absolutePath: join(baseDir, dir, file),
        body,
        fullText,
      });
    }
  }
  return out;
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
 * 计算某个候选集合内各 token 的**文档频率**（出现该 token 的候选数）。
 *
 * 用途：过滤「几乎出现在每一份候选里」的 token。实测（2026-10-24，27 份规范）：
 * 规范 scope 字段中「定义」27/27 = 100%、「适用」26/27 = 96%、「用于」26/27 = 96%
 * ——它们命中**任何**查询，是召回噪声的主要来源。
 *
 * **为什么是按源分算而不是全量算**：同一 token 在两个源里的区分度不同。
 * 跨全量（337 条）看「规范」只占 27%，但在规范源内部它同时出现在近半数的
 * scope 里。用全局阈值会把「在事实源里很有区分度」的词一并削弱，故按集合分算。
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

/** 由候选集算出 BM25 需要的语料统计（N、df 表、平均文档长度）。 */
function corpusStatsOf(list) {
  const docFreq = new Map();
  let total = 0;
  let tokenSum = 0;
  for (const c of list) {
    const toks = tokenize(sectionsText(c));
    total += 1;
    tokenSum += toks.length;
    for (const t of new Set(toks)) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  return { docFreq, total, avgdl: Math.max(1, tokenSum / Math.max(1, total)) };
}

export const HIGH_DF_RATIO = 0.6;

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
export function matchCandidate(actionTokens, candidate, corpusStats) {
  // **编号层（tier 0）最优先**：`spec_id` 是规范的稳定编号，用户说「34 号规范」
  // 时点名的是它，不是标题里的字。此层不设会漏掉最精确的一种命中——实测缺陷：
  // 查询含「34」，但 34 号规范只能靠 scope 里的「规范」二字命中，与其它 18 份
  // 规范同层同分，被路径字典序挤到后面。
  // 只认**整词相等**（不认子串），避免「3」命中「34」、「1」命中「10」。
  const specId = candidate.specId;
  if (typeof specId === "string" && specId !== "" && actionTokens.includes(specId)) {
    return { tier: 0, hits: 1, hitReason: `规范编号命中：${specId}` };
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
  // **只对规范生效，不对事实生效**（2026-10-24 修）：类型点名是为了找到「该类型的
  // 定义规范」，事实对象没有这个角色。实测回归——查询「install() 分发器在
  // agent/created 回调里…」含 token `agent`，事实侧 4 条 Agent 调研文档因此以
  // `类型点名命中：agent` 冲到最前，把「插件重建清空子代理登记表」挤出 limit。
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
  const sections = [
    { tier: 1, text: candidate.scope, label: "适用范围", minHits: 1 },
    { tier: 2, text: candidate.detail, label: "内容", minHits: 1 },
    { tier: 3, text: candidate.title, label: "标题", minHits: 1 },
    // 规范载入的是 `text`（全文）、事实载入的是 `body`（前 1200 字截断）。
    // 曾只读 `body`，导致**规范正文这一层从未参与匹配**——缺陷：查询
    // 「改 guidance-text.js 的引导文本」一条规范都命中不了，因为该文件名只
    // 出现在 00/10 的正文里，不在它们的 scope/positioning/title 里。
    // 规范用 `bodyText`（剥离 frontmatter），事实用 `body`（前 1200 字）。
    // 绝不能用 `candidate.text`——它含 YAML 字段名（见 loadSpecs 的说明）。
    { tier: 4, text: candidate.bodyText ?? candidate.body, label: "正文", minHits: bodyMinHits },
  ];
  let best = null;
  for (const section of sections) {
    if (typeof section.text !== "string" || section.text === "") continue;
    const hits = intersect(actionTokens, tokenize(section.text));
    // **单字只作辅助，不单独构成命中依据。**
    //
    // 实测（2026-10-24，用本会话真实用户消息）：「把这批改动合入吧」10 条结果里
    // 5 条是纯单字命中——`WorkCase 工单` 靠「批」、`火花记录` 与 `双源召回` 靠「合」；
    // 「经验也要召回啊」有 4 条靠单字「回」命中。单个汉字在本语料里覆盖 50–70%
    // 的候选（2026-10-27 复测：「改」出现在 **257/277 = 93%** 的载体里——规范侧
    // 27/27 全覆盖、事实侧 230/250；此前注记为 295/347、251/271、252/272 与 253/273，均已过时——
    // 事实源由宿主辅助任务持续写入，本数字随之双向漂移，漂移即本测试的正确报警），
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
  if (best === null) return null;
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
  const allHits = intersect(actionTokens, tokenize(sectionsText(candidate)));
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
    const docTokens = tokenize(sectionsText(candidate));
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
 * @param {string[]} [input.statuses] 默认 `["active"]`；写入前查重可加 `["draft","open"]`
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
export async function recallForAction(input = {}) {
  const action = typeof input.action === "string" ? input.action.trim() : "";
  if (action === "") {
    return { ok: false, error: { code: "recall/action_required", message: "动作描述必填" } };
  }
  // **默认值注**（2026-10-24）：本函数默认 `limit=5`／`budgetBytes=RECALL_DIRECT_BYTE_BUDGET`，
  // 而注入路径（`buildRecallInjection`）默认 `limit=3`／`RECALL_BYTE_BUDGET`（2400）。
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
  // 显式传入优先；否则**按类型取各自的默认候选状态集**
  // （统一写死 `active` 会让多数类型零召回，见 `DEFAULT_STATUSES_BY_TYPE`）。
  const explicitStatuses = Array.isArray(input.statuses) && input.statuses.length > 0
    ? input.statuses : null;
  // `statuses` 保留为一个**判定函数**的语义位：实际按每个候选的类型查表。
  const statusAllowed = (type, status) => {
    const allowed = explicitStatuses ?? DEFAULT_STATUSES_BY_TYPE[type] ?? ["active"];
    return allowed.includes(status);
  };
  // 事实类型过滤。**默认不限定类型**——`03 §6.1` 快通道那条写的是「不遍历
  // **未被当前目标和来源规则触发的**全量规则或事实」，即：不该全量遍历，
  // 但被触发的类型仍应召回。曾把默认收窄为 `["adr","pitfall"]`，结果
  // 「加个」这类短指令因只能搜这两类而召回不到东西（实测 inject 由 true 变 false）。
  //
  // ADR/Pitfall 的优先级改由**排序**保证（见 `REQUIRED_RECALL_TYPES`），
  // 而不是靠**过滤**——过滤会漏，排序只是把必需类型提前。
  const types = Array.isArray(input.types) ? input.types : null;
  const includeSpecs = input.includeSpecs !== false;

  const query = `${action} ${input.scope ?? ""}`.trim();
  // 本回合是否在讨论/规划方向（`31 §10` 消费时机第 1 项）。**只算一次**：
  // 放进排序比较器会给每次两两比较重算一遍同一个判定（纯浪费，且让
  // 「同一输入同一结果」的确定性理由变得不显然）。
  const directionDiscussion = isDirectionDiscussion(action);
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
  const factsDir = join(root, "ldvh-base");
  const [specs, facts, factsReadable] = await Promise.all([
    specsSource === null ? [] : loadSpecs(specsSource.dir),
    loadFacts(factsDir),
    // **可读性与「有无对象」分开跟踪**（34 §12 三态判定的前提，M-21）：
    // 规范侧的可读性由三级回退是否解析成功承载（specsSource !== null）；
    // 事实侧没有回退链，须显式探测目录是否存在且可读。
    isReadableDir(factsDir),
  ]);

  // 过滤：**已登记类型** + 类型 + 状态。
  // 规范无 status 概念故全量参与。
  const pool = facts.filter((c) => {
    // **中间产物不进入召回**（02 §9.2）：只保留已登记类型。
    // 未登记类型（留观缓冲、缓存、草稿箱等事实源之外的中间产物）不形成候选卡。
    if (!REGISTERED_FACT_TYPES.includes(c.type)) return false;
    if (types !== null && !types.includes(c.type)) return false;
    return statusAllowed(c.type, c.status);
  });

  // 按源分算文档频率，过滤过于普遍的 token（见 `HIGH_DF_RATIO`）。
  // 每个源各自一套 DF：规范源 27 份、事实源 248 条，区分度分布不同。
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
  // 改用与匹配完全相同的 `sectionsText()`（scope/detail/title/body 并集），
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
  const docFreqOf = (list) => {
    const narrow = new Map();
    const wide = new Map();
    for (const c of list) {
      const nSet = new Set(tokenize([c.scope, c.detail, c.title].filter((t) => typeof t === "string").join("\n")));
      const wSet = new Set(tokenize(sectionsText(c)));
      for (const token of nSet) narrow.set(token, (narrow.get(token) ?? 0) + 1);
      for (const token of wSet) wide.set(token, (wide.get(token) ?? 0) + 1);
    }
    return { narrow, wide, total: list.length };
  };

  const collect = (list, mapper) => {
    const df = docFreqOf(list);
    // 有效查询词 = 原 tokens 里**不过于普遍**的那些。若全被滤掉（例如查询只由
    // 「规范」「定义」组成），退回原 tokens——宁可给噪声也不能给零结果，
    // 因为零结果会被误读成「无相关约束」。
    const effective = tokens.filter((token) => !isTooCommon(token, df, df.total));
    const queryTokens = effective.length > 0 ? effective : tokens;
    const corpusStats = corpusStatsOf(list);
    return list
    .map((c) => {
      const m = matchCandidate(queryTokens, c, corpusStats);
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
        // （draft/pending）之前，避免新草稿凭新鲜度压掉权威对象。
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
      contentFingerprint: contentFingerprintOf(c.text),
    },
  }));
  const allFactHits = collect(pool, (c) => ({
    kind: "fact", type: c.type, ref: c.ref, title: c.title, status: c.status, path: c.path,
    absolutePath: c.absolutePath,
    // **最后更新时间进候选卡**（2026-10-27）：使读者在卡片上就能看见
    // 「这条有多旧」，也让排序的次级键对读者可复核（排序依据须可观察）。
    // 取不到时为空串，如实留空而不伪造时间。
    updatedAt: c.updatedAt ?? "",
    // **F2「有界确定性摘录」**：此前候选卡只有 title + path，读者必须打开文件才
    // 知道讲什么，而 F2 的用途正是「筛选少量候选并选择 F3」——没有摘录就无法筛选。
    // 无长文本字段的类型（norm/goal）退回 title，保证摘录位不空。
    excerpt: excerptOf(c.excerptSource) || c.title,
    // 同规范卡：每张事实卡也带来源与内容指纹（02 §9.2）。
    // 事实源只有项目内一源，故 tier 恒为 "project"。
    source: {
      tier: "project",
      // 用**全文**算指纹：用截断后的 body 会让载体后半部分的变化对指纹不可见
      // （实测某 ADR 真实 3796 字符，body 只 1200——后 2596 字符的内容变化查不出）。
      contentFingerprint: contentFingerprintOf(c.fullText ?? c.body ?? ""),
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
    // **方向讨论回合的加位**（`31 §10` 消费时机第 1 项）：同分时 let open Spark
    // 先于其它非必需类型——它仍排在 ADR/Pitfall 与更强的证据之后，只在
    // 「同样强、同样不是必需类型」时改变次序。见 `compareFactHits` 的 directionRank。
    .sort((a, b) => compareFactHits(a, b, { directionDiscussion }))
    .map((entry) => entry.fact);
  const specHits = allSpecHits.slice(0, limit);
  const factHits = allFactHits.slice(0, limit);

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
    const active = facts.filter(
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
  const usableBudget = Math.max(0, budgetBytes - RENDER_FIXED_OVERHEAD_BYTES - baselineBytes);
  const estimateLineBytes = (item) => {
    const title = typeof item.title === "string" ? item.title : "";
    const reason = typeof item.hitReason === "string" ? item.hitReason : "";
    const path = typeof item.path === "string" ? item.path : "";
    const excerpt = typeof item.excerpt === "string" ? item.excerpt : "";
    // 前缀（`- [type/status] `）、分隔符与本行换行的粗略常量，取 8 字节。
    return Buffer.byteLength(`${title}${reason}${path}${excerpt}`, "utf8") + 8;
  };
  const fits = (item) => {
    const size = estimateLineBytes(item);
    if (used + size > usableBudget) return false;
    used += size;
    return true;
  };
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
  const keptSpecs = specHits.filter(fitsSpec);
  let keptFacts = factHits.filter(fits);
  if (keptSpecs.length === 0 && keptFacts.length === 0) {
    // 整体为空 → 保底第一条（规范优先，否则事实）。
    const first = specHits[0] ?? factHits[0];
    if (first !== undefined) {
      used += estimateLineBytes(first);
      if (specHits.length > 0) keptSpecs.push(first);
      else keptFacts.push(first);
    }
  }
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
  const overBudget = used + RENDER_FIXED_OVERHEAD_BYTES + baselineBytes > budgetBytes;

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
    const filteredOut = facts.length - pool.length > 0;
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
    truncated,
    overBudget,
    budget: { limitBytes: budgetBytes, usedBytes: used, limit },
    // 34 §13：召回命中 ≠ 适用。
    provesApplicability: false,
    // 确定性召回会漏（换个说法就漏），如实声明，不假装完整。
    // **实测能力边界**（2026-10-24，不可用「可能漏」这种模糊说法搪塞）：
    //
    // **复测结果（2026-10-27）**：用 24 条 active Pitfall 的「症状段」去召回它
    // **自己**，**23/24 = 96% 命中**。跨层累计命中修改前为 22/24——同分靠 UUID
    // 字典序时，有 1 条被挤出 limit；改为全层累计后它进榜。样本此前为 23 条，
    // 因事实源持续新增而漂移。
    //
    // **⚠️ 此处的旧论证已被证伪，勿再沿用**：旧注记称「30 条样本只有 13/30 = 43%
    // 命中，原因是 title 描述机制、症状描述表现，二者常常没有任何字面重叠」。
    // 逐条复测后该论断**方向相反**——实测 **48 条有字面重叠、仅 1 条无重叠**：
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
    counts: {
      // 命中总数（**截断前**）与返回数（截断后）都给出，差额即被丢弃数。
      specHits: allSpecHits.length,
      factHits: allFactHits.length,
      specsReturned: keptSpecs.length,
      factsReturned: keptFacts.length,
      // **实际参与匹配的候选数**（= 规范全量 + 通过类型/状态/白名单过滤的事实）。
      // 曾误写为 `specs.length + facts.length`，其中 facts 是**过滤前**的全量，
      // 于是无论 types 怎么过滤它都恒为 337（实测 types=["adr","pitfall"] 与
      // 不传 types 得到同一个数）——「扫了多少」这个数就失去意义。
      candidatesScanned: specs.length + pool.length,
      // 载入后**未进入匹配**的候选数（被类型/状态/白名单过滤掉的）。
      candidatesExcluded: facts.length - pool.length,
    },
    pagination: {
      limit,
      // 本实现不持有跨调用游标（按需重算），如实说明，不假装有游标。
      hasCursor: false,
      howToGetMore: "调大 limit 或缩小 action 描述范围后重新召回（本实现不持有跨调用游标）",
    },
    unchecked: {
      specs: allSpecHits.slice(keptSpecs.length).map((spec) => ({ title: spec.title, path: spec.path })),
      facts: allFactHits.slice(keptFacts.length).map((fact) => ({ title: fact.title, path: fact.path })),
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
        const unknown = facts.filter((fact) => !REGISTERED_FACT_TYPES.includes(fact.type));
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
    // 缺它的直接后果：`23 §12`「待确认队列」要求「**必须能枚举 `draft`，不得只列
    // `active`**」，其目的是「Human 能知道**有多少候选在等**」。实测全库有 16 条
    // draft Pitfall，但用「有多少候选在等」查只能命中 0 条（按词匹配根本没命中），
    // 「待确认的候选」命中 2 条——**计数这种事不该靠词法匹配**，它属 F0。
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
        notScanned: facts.length - pool.length,
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
      excludedByTypeFilter: types === null ? [] : facts
        .filter((fact) => !types.includes(fact.type))
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      excludedByStatus: facts
        .filter((fact) => types === null || types.includes(fact.type))
        .filter((fact) => !statusAllowed(fact.type, fact.status))
        .map((fact) => ({ type: fact.type, status: fact.status, title: fact.title, path: fact.path })),
      excludedByTypeWhitelist: facts
        .filter((fact) => !REGISTERED_FACT_TYPES.includes(fact.type))
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
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
      // 声称「扫描项目内 ldvh-base/」，与 00 §5.6 据实声明相抵）。
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
      // **实测：用 Pitfall 自身的「症状段」去召回它自己，23/24 = 96% 命中**
      // （2026-10-27 复测；同日跨层累计修改后由 22/24 提升到 23/24）。
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
      measuredSymptomSelfRecall: {
        hits: 23,
        total: 24,
        measuredAt: "2026-10-27",
        discriminatingPower: "none",
        why: "测「正文→自身标题」，与用户口吻查询不同距离；双版本同为 24/24 而真实精确率 13.9%→10.5%，故不得据此判断召回质量。质量基线见 test/recall-quality.test.mjs",
      },
      // 因此哪些消费点不能只靠本函数。
      // **实测能力**（2026-10-24，第 56 轮复测）。
      //
      // 此字段此前写死一条：「23 §12 故障调查（按表现匹配已知机制——跨层需要
      // 语义判断）」，即声称本模块**不足以**承担故障调查。该结论基于已被证伪的
      // 43% 测量（见本函数前文的复测说明），**现予更正**：
      //   · 用 active Pitfall 的症状段前半句查询 → **23/24 = 96%** 召回自身
      //     （**默认 limit=3 下实测**；独立审核指出 limit≥40 时才 24/24，
      //      此前把「大 limit 的最好成绩」写成了无配置上限的 100%，属失真）；
      //   · 换后半句（模拟「换个说法」）→ **20/22 = 91%** 召回自身
      //     （limit=8 下实测。**2026-10-27 第 1 步排序改动前为 22/22 = 100%，
      //      改动后降到 20/22**——这是「类型优先级从绝对前置改为同分时生效」的
      //      真实代价：有 2 条 Pitfall 因非 pitfall 类型的高 tier 命中被挤到第 9 位
      //      之后。如实记录，不隐瞒；该取舍的收益是「缓存」类查询的相关项从第 29
      //      位升到第 15 位）；
      //   · 5 条真实使用者症状（「页面白屏了什么都看不到」「字段被删了」
      //     「提交被门禁拒绝了」等）→ 均召回了高度相关的 Pitfall。
      //
      // 但**仍不足以据此断言「满足 23 §12」**：`23 §12` 要的是「按表现匹配
      // **已知机制**」，而匹配到 Pitfall 只给出了候选，是否踩到同一个机制仍需
      // 语义判断（`02 §9.2`「机械有效不能替代语义相关」）。故此处不填
      // 「不足」，而如实声明**能做到什么、做到哪一步**。
      insufficientForConsumptionPoints: [
        "23 §12 故障调查：可召回「表现相近」的 Pitfall（实测同义改写 20/22 = 91% 仍命中），但「是否同一机制」须由消费方语义判断——本模块只提供候选",
      ],
      // **未兑现范围**（`00 §5.6` 据实声明 / `00 §5.7` 交还）：`10 §5.3` 规定
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
