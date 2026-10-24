// source-recall.js —— 行动前召回规范源与事实源（规则遵守系统的输入侧）
//
// ## 这个模块在干什么
//
// 34 §7「输入来源」逐字：
//   「规则来源为规范源（经 01 §10 的 L0–L4 读取取得）；事实来源为事实源（经 02 §9
//    的 F0–F4 召回取得）；决定来源为 Human 决定记录与各事实类型中的决定类对象；
//    授权来源为 00 §4 与各授权程序。输入来源的读取深度须与风险层相称（03 §6.1）。」
//
// 34 §8.1 第 1 项（适用识别）逐字：
//   「从来源中**找出**与当次行动相关的规则、事实、决定与授权，并给出每一项的适用
//    依据（为何相关、覆盖哪一段行动）。」
//
// 故本模块做的是**找出**这一半：给一个动作描述，从两个源里找出相关的规则与事实，
// 并给出命中理由。它**不判定适用**——34 §13 明文「召回的命中不等于适用」，
// 判适用是本系统后续的判断，不由召回代劳。
//
// ## 为什么不建索引、不上向量
//
// 34 §17 第 1 项：「不为本系统建立全量规则索引、实时规则同步或规则依赖图——识别
// 按需从来源读取，不预建索引。」
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

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 分词：中文二元组 + ASCII 词，零依赖
// ---------------------------------------------------------------------------

/** 中文虚字：含任一虚字的二元组不参与匹配（不承载意义，只制造噪声）。 */
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
  // 中文只取**二元组**（bigram），单字不进匹配集；含虚字的二元组也不进。
  //
  // 实测教训一：单字参与匹配时「的/一/本/是」命中一切。
  // 实测教训二：二元组里仍有纯虚字组合（「一个」「可能」「可以」）与跨词噪声
  // （「建一」「板的」「的取」）命中一切。
  // 两层过滤都是「不承载意义就不参与比对」，不是权重，故仍可解释、可复算。
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjk) {
    for (let i = 0; i + 1 < run.length; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (FUNCTION_CHARS.has(bigram[0]) || FUNCTION_CHARS.has(bigram[1])) continue;
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
 * 载入规范源 `specs/`。
 *
 * 规范源的 frontmatter 是嵌套在 `ldvh_spec:` 下的，本函数把它拍平取所需字段：
 * `spec_key` / `spec_id` / `title` / `positioning` / `scope` / `basis`。
 * 另取正文标题行，使章节标题也可参与匹配（如「预检落实记录」）。
 *
 * **现读现解析**，不建持久索引（34 §17 第 1 项）。
 */
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
 * `34 §7` 把召回绑到这个入口（「规则来源为规范源（经 01 §10 的 L0–L4 读取取得）」），
 * 故召回必须走同一套解析——否则无自著语料的受辖项目会得到零命中，
 * 而正确行为是回退到源仓库语料并**如实标注**应答方。
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
      path: `specs/${file}`,
      headings,
      text,
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
      // 正文（去掉 frontmatter）的前 1200 字做补充匹配，控制成本。
      const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "").slice(0, 1200);
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
        ].filter(Boolean).join(" "),
        trigger: fm.trigger_signal ?? "",
        path: `ldvh-base/${dir}/${file}`,
        body,
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
export const HIGH_DF_RATIO = 0.6;

/** 一个 token 在该集合中是否过于普遍（出现在 ≥ `HIGH_DF_RATIO` 比例的候选里）。 */
function isTooCommon(token, docFreq, total) {
  if (total < 4) return false; // 样本太小，比例不可靠，不丢任何词
  return (docFreq.get(token) ?? 0) / total >= HIGH_DF_RATIO;
}

/**
 * 判定一个候选与动作的相关层。
 *
 * @param {string[]} actionTokens 动作描述的 token
 * @param {object} candidate 载入的候选
 * @returns {{tier: number, hitReason: string} | null} 无关则 null
 */
export function matchCandidate(actionTokens, candidate) {
  // **编号层（tier 0）最优先**：`spec_id` 是规范的稳定编号，用户说「34 号规范」
  // 时点名的是它，不是标题里的字。此层不设会漏掉最精确的一种命中——实测缺陷：
  // 查询含「34」，但 34 号规范只能靠 scope 里的「规范」二字命中，与其它 18 份
  // 规范同层同分，被路径字典序挤到后面。
  // 只认**整词相等**（不认子串），避免「3」命中「34」、「1」命中「10」。
  const specId = candidate.specId;
  if (typeof specId === "string" && specId !== "" && actionTokens.includes(specId)) {
    return { tier: 0, hits: 1, hitReason: `规范编号命中：${specId}` };
  }
  // `minHits`：该层至少要命中几个词才算相关。
  //
  // **为什么正文层要 2 个**：正文有数千字，命中 1 个词几乎必然——实测查询
  // 「把 34 号规范改名成双源召回」在正文层命中 22 份规范，其中 17 份只命中
  // 1 个词（「改名」或「召回」）。而 scope/title/detail 是短字段，命中 1 个词
  // 即有区分度，故取 1。
  const sections = [
    { tier: 1, text: candidate.scope, label: "适用范围", minHits: 1 },
    { tier: 2, text: candidate.detail, label: "内容", minHits: 1 },
    { tier: 3, text: candidate.title, label: "标题", minHits: 1 },
    // 规范载入的是 `text`（全文）、事实载入的是 `body`（前 1200 字截断）。
    // 曾只读 `body`，导致**规范正文这一层从未参与匹配**——缺陷：查询
    // 「改 guidance-text.js 的引导文本」一条规范都命中不了，因为该文件名只
    // 出现在 00/10 的正文里，不在它们的 scope/positioning/title 里。
    { tier: 4, text: candidate.body ?? candidate.text, label: "正文", minHits: 2 },
  ];
  for (const section of sections) {
    if (typeof section.text !== "string" || section.text === "") continue;
    const hits = intersect(actionTokens, tokenize(section.text));
    // **单字只作辅助，不单独构成命中依据。**
    //
    // 实测（2026-10-24，用本会话真实用户消息）：「把这批改动合入吧」10 条结果里
    // 5 条是纯单字命中——`WorkCase 工单` 靠「批」、`火花记录` 与 `规则遵守` 靠「合」；
    // 「经验也要召回啊」有 4 条靠单字「回」命中。单个汉字在本语料里覆盖 50–70%
    // 的候选（实测「改」231/337），「靠一个字命中」几乎等于没命中。
    //
    // 但单字**不能丢**：短指令「改一下／删了／加个」只有单字可切（第 16 轮修的
    // 就是这个）。故规则是——**单字只在「没有别的词命中」时才算数**：
    //   · 多字词至少命中一个 → 用多字词为准（单字附在后面仅供读者对照）；
    //   · 只有单字命中 → 仍然算命中（短指令路径不被破坏）。
    const strong = hits.filter((token) => token.length >= 2);
    const weak = hits.filter((token) => token.length === 1);
    // 通用词降级：多字但语义通用的词（任何/规范/执行…）不算强证据；
    // 若命中的**全是通用词**，则视为弱命中（与单字同档）。
    const specific = strong.filter((token) => !GENERIC_TOKENS.has(token));
    const decisive = specific.length > 0 ? specific : (strong.length > 0 ? strong : weak);
    if (decisive.length >= (section.minHits ?? 1)) {
      // 命中理由只列前 3 个词；若靠单字命中，明确标出「仅单字」，
      // 使读者知道这条的相关性弱，须自行核实。
      const shown = decisive.slice(0, 3).join("、");
      const onlyGenericOrWeak = specific.length === 0;
      const reason = onlyGenericOrWeak
        ? `${section.label}仅通用词/单字命中（相关性弱，须自行核实）：${shown}`
        : `${section.label}命中：${shown}`;
      return { tier: section.tier, hits: decisive.length, hitReason: reason };
    }
  }
  return null;
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
 * @param {number} [input.budgetBytes] 返回内容的字节上限，默认 4000
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
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 5;
  const budgetBytes = Number.isInteger(input.budgetBytes) && input.budgetBytes > 0
    ? input.budgetBytes : 4000;
  const statuses = Array.isArray(input.statuses) && input.statuses.length > 0
    ? input.statuses : ["active"];
  const types = Array.isArray(input.types) ? input.types : null;
  const includeSpecs = input.includeSpecs !== false;

  const query = `${action} ${input.scope ?? ""}`.trim();
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return {
      ok: false,
      error: { code: "recall/no_tokens", message: "动作描述切不出可匹配的词，召回无从开始" },
    };
  }

  const root = input.root ?? join(import.meta.dirname, "..", "..");
  // 规范语料按 01 §10.3 三级回退解析（见 `resolveSpecsRoot`）；事实源只有项目内一源。
  const specsSource = includeSpecs ? await resolveSpecsRoot(root) : null;
  const [specs, facts] = await Promise.all([
    specsSource === null ? [] : loadSpecs(specsSource.dir),
    loadFacts(join(root, "ldvh-base")),
  ]);

  // 过滤：类型 + 状态。事实按 status，规范无 status 概念故全量参与。
  const pool = facts.filter((c) => {
    if (types !== null && !types.includes(c.type)) return false;
    return statuses.includes(c.status);
  });

  // 按源分算文档频率，过滤过于普遍的 token（见 `HIGH_DF_RATIO`）。
  // 每个源各自一套 DF：规范源 27 份、事实源 310 条，区分度分布不同。
  const docFreqOf = (list) => {
    const df = new Map();
    for (const c of list) {
      const seen = new Set([
        ...tokenize(c.scope ?? ""),
        ...tokenize(c.detail ?? ""),
        ...tokenize(c.title ?? ""),
      ]);
      for (const token of seen) df.set(token, (df.get(token) ?? 0) + 1);
    }
    return df;
  };

  const collect = (list, mapper) => {
    const df = docFreqOf(list);
    // 有效查询词 = 原 tokens 里**不过于普遍**的那些。若全被滤掉（例如查询只由
    // 「规范」「定义」组成），退回原 tokens——宁可给噪声也不能给零结果，
    // 因为零结果会被误读成「无相关约束」。
    const effective = tokens.filter((token) => !isTooCommon(token, df, list.length));
    const queryTokens = effective.length > 0 ? effective : tokens;
    return list
    .map((c) => {
      const m = matchCandidate(queryTokens, c);
      // `hits` 必须显式带出：mapper 的返回里没有它，之前漏掉导致排序键是
      // `undefined - undefined = NaN`，同层排序退化成只按路径字典序，
      // 使命中词更多的条目反而排在后面（实测：34 号 hits=2 被 01 号 hits=1 挤掉）。
      return m === null ? null : { ...mapper(c), tier: m.tier, hits: m.hits, hitReason: m.hitReason };
    })
    .filter(Boolean)
    // 排序：先按层（命中越精确的字段越前），同层按命中词数降序、再按路径稳定排序。
    // 命中词数是计数不是权重——可解释（hitReason 列出命中词）、可复算、无学习参数。
    .sort((a, b) => a.tier - b.tier || b.hits - a.hits || a.path.localeCompare(b.path));
  };

  // `collect` 返回**截断前的全部命中**（已排序）；`limit` 在此处应用。
  // 这样 `counts.specHits` 才是「命中总数」而非「返回数」——
  // `02 §9.1` 要求「数量…必须可观察」，读者要看的正是**丢了多少**。
  const allSpecHits = collect(specs, (c) => ({
    kind: "spec", ref: c.ref, title: c.title, path: c.path,
    positioning: c.positioning.slice(0, 160),
  }));
  const allFactHits = collect(pool, (c) => ({
    kind: "fact", type: c.type, ref: c.ref, title: c.title, status: c.status, path: c.path,
  }));
  const specHits = allSpecHits.slice(0, limit);
  const factHits = allFactHits.slice(0, limit);

  // 预算：按返回内容的 UTF-8 字节数裁剪，超了如实标 truncated（fd133f0d A3）。
  //
  // **保底一条**：若预算小到连第一条都放不下，不能返回空数组——空数组会被
  // 调用方读成「没有相关约束」，而那正是 `02 §9.2` 禁止的「把零结果当无约束」。
  // 故此时**保底返回第一条并把 truncated 置真**，由渲染侧如实写明「已裁剪」，
  // 使 AI 知道「有关系项、只是没全给」，而不是「没有」。
  let used = 0;
  const fits = (item) => {
    const size = Buffer.byteLength(JSON.stringify(item), "utf8");
    if (used + size > budgetBytes) return false;
    used += size;
    return true;
  };
  const keepWithFloor = (hits) => {
    const kept = hits.filter(fits);
    if (kept.length === 0 && hits.length > 0) {
      const first = hits[0];
      used += Buffer.byteLength(JSON.stringify(first), "utf8");
      return [first];
    }
    return kept;
  };
  const keptSpecs = keepWithFloor(specHits);
  const keptFacts = keepWithFloor(factHits);
  // 截断有两种来源：**limit**（结果条数上限）与**预算**（字节上限）。
  // 原实现只比 `kept*` 与 `*Hits`，而 `*Hits` 已按 limit 截过，故 limit 造成
  // 的丢弃被漏掉（实测 limit=2 时 12 份命中只给 2 份，却报 truncated=false）。
  // 现与**截断前总数**比较，两种来源都能被观察。
  const truncated =
    keptSpecs.length < allSpecHits.length || keptFacts.length < allFactHits.length;
  // 保底后 used 可能超过 budgetBytes——如实报告超额，不掩盖。
  const overBudget = used > budgetBytes;

  return {
    ok: true,
    query: { action, scope: input.scope ?? "", tokens: tokens.length },
    specs: keptSpecs,
    facts: keptFacts,
    truncated,
    overBudget,
    budget: { limitBytes: budgetBytes, usedBytes: used, limit },
    // 34 §13：召回命中 ≠ 适用。
    provesApplicability: false,
    // 确定性召回会漏（换个说法就漏），如实声明，不假装完整。
    // **实测能力边界**（2026-10-24，不可用「可能漏」这种模糊说法搪塞）：
    //
    // 用 30 条真实 Pitfall 的「症状」原文去召回它**自己**，只有 **13/30 = 43%** 命中。
    // 原因是结构性的、不是可调参数：Pitfall 的 `title`（如「写入侧与呈现层两套残留段
    // 解析规则致门禁判据与展示不一致」）与它的「症状」（如「工单关闭提交被机械门禁
    // 拒绝：workcase/direction_incomplete」）之间**常常没有任何字面重叠**——
    // 一个描述机制，一个描述表现。词法匹配没有语义能力，这是它的固有边界。
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
    counts: {
      // 命中总数（**截断前**）与返回数（截断后）都给出，差额即被丢弃数。
      specHits: allSpecHits.length,
      factHits: allFactHits.length,
      specsReturned: keptSpecs.length,
      factsReturned: keptFacts.length,
      candidatesScanned: specs.length + facts.length,
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
    // 排序依据如实声明（`02 §9` 红线：不得用相似度/embedding/关键词权重/AI 裁决相关性）。
    ranking: {
      keys: ["tier", "hits", "path"],
      usesWeights: false,
      usesSimilarity: false,
      usesEmbedding: false,
      usesAiJudgement: false,
      truncationIsNotJudgement: true,
      note: "tier 是字段位置（确定性），hits 是同层命中词个数（等权、可复算），path 仅为稳定输出；limit 截断只表示排得靠后，不表示不相关",
    },
    fingerprint: fingerprintOf([...specs, ...facts]),
    // 结构化的能力边界（供程序判定，不必解析自由文本）。
    limitations: {
      // 词法匹配无法从「表现」跨到「机制」，这是固有边界而非缺陷。
      lexicalOnly: true,
      usesSemanticUnderstanding: false,
      // 实测：症状→自身召回率 43%（30 条真实 Pitfall 样本）。
      measuredSymptomSelfRecall: { hits: 13, total: 30, measuredAt: "2026-10-24" },
      // 因此哪些消费点不能只靠本函数。
      insufficientForConsumptionPoints: [
        "23 §12 故障调查（按表现匹配已知机制——跨层需要语义判断）",
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
