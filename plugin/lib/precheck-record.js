/**
 * dsh-ldvh — 预检落实记录的生成、呈现与回读（规则遵守系统的机械承载切片）.
 *
 * 权威：specs/34 §8（三段判断与约束落实）、§10（不新建事实类型）、§12（交还）、
 * §14（验证与证据边界）；specs/03 §7.2（公共格式，唯一权威）。
 *
 * ## 本模块**存什么**与**不存什么**
 *
 * 34 §10 明文：「本系统的当次产物是预检落实记录（03 §7 定义的公共形态），它
 * **不是事实对象**——不进事实源、不适用事实类型契约、不被召回层检索。本系统
 * **不新建事实类型**。」34 §17 第 3 项再禁一次「专属存储」。故本模块：
 *
 * - **不**写 `ldvh-base/`（事实源目录），**不**创建任何 `fact_type_key`；
 * - **不**建立索引、缓存或第二份账本（§17 第 1 项禁「全量规则索引」）；
 * - 记录是**当次交还的呈现物**，落盘位置服从 specs/10 §7.7 已定的
 *   「DSH 用户配置根下的 `ldvh/` 域」——那是 Output Envelope 的**本地存储区**，
 *   与管辖登记同级，不是项目事实源。
 *
 * 一句话：本模块产出的是**一段可回读的文本**，不是一条事实。
 *
 * ## 与 `03 §12`「仅人工核对」的边界（2026-10-23 补）
 *
 * `03 §12` 验证表「预检落实记录」行的验证入口写的是：
 * 「AI 语义审核与记录回读核对（**字段无机器载体，仅人工核对**）」。
 *
 * 这句话与本模块的机器核对**不冲突，但也不能被本模块取代**，边界如下：
 *
 * - 「字段无机器载体」指的是**不为记录的字段建立机器持久化载体**（本模块确实没有——
 *   它不落盘、不建索引、不建账本）。本模块读写的是**交还正文里的文本**，
 *   那个载体由 03 §7.2 定义、由交还承载，不由本模块造。
 * - 「仅人工核对」指的是**核对取值是否正确**只能由 AI 语义审核与人工完成。
 *   本模块的 `checkRecordShape` / `parseRecord` 只核对**形态**（段名是否出现、
 *   是否非空、能否解析回字段），**不核对取值是否为真**——这一点各函数的
 *   `proves` 字段逐条声明过。
 * - **故本模块不能替代 `03 §12` 所说的核对**：它只把「段名齐备、可解析」
 *   这层做掉，让 AI 语义审核不必在格式层面重复劳动；取值判断仍须人工/AI 完成。
 *
 * 若日后把本模块的输出当作「核对通过」的依据，即越过了 `03 §12` 这一行的边界。
 * 本模块**拒绝**提供任何此类结论——所有 `proves` 都以「不证明…」收尾。
 *
 * ## 格式是**语义示例**，不是字段登记
 *
 * 03 §7.2 原文末句：「该格式是交还语义示例，不是对 LDVH CLI 或 Code 的字段
 * 登记。具体业务系统可以扩展该格式，但不得省略预检落实记录。」这句话既允许
 * Code 侧自定承载形式，也**禁止** Code 侧把它当 Schema 用——故本模块的校验停在
 * 「必需段是否出现且非空」这一层，不解析段内语义、不判断结论对错
 * （§14「三项是否齐备及其取值；不证明取值正确」）。
 *
 * ## 03 §7.2 共有**七**个顶层条目，不是「六段」
 *
 * 逐条数原文（03:220-230）：生效规则、适用规则、行动允许、已召回、未验证范围、
 * 快通道声明、升级记录 = **7** 个顶层条目。其中「快通道声明」「升级记录」原文
 * 带「如」，属**条件条目**；其余 5 个为必需。
 *
 * （2026-10-23 修正：本注释首版写作「六段」，把「已召回」漏数或把两个条件条目
 * 合并计数。`specs/` 全库检索无「六段」这一表述，该说法只存在于本文件注释中——
 * 即它是我引入的错，不是规范原文。）
 *
 * ## 为什么必需集合是 5 个标签
 *
 * 必需 = 生效规则、适用规则、行动允许、未验证范围、**已召回**。
 * `REQUIRED_SECTIONS` 只列前四个字符串段，是因为「已召回」是**两级结构**（ADR /
 * Pitfall 各自可标「未触发」/「未遍历」），由 `RECALLED_LABEL` 单独约束；
 * `checkRecordShape` 与 `parseRecord` 都把「已召回」计入必备，故整数为 5。
 * 两个条件条目（快通道声明／升级记录）仅在传入时呈现——§17 第 2 项禁止为凑段
 * 而填空。
 *
 * ## 本模块**不能**证明什么（§14 末段同口径）
 *
 * 条目齐备、格式合规、时间序正确，**均不能单独证明**规则被实际遵守、行动已被
 * 允许或结果正确。本模块只做「形态」这一层的机械判定，从不返回任何「已遵守」
 * 结论——这个区分是 34 §12 的强制内容，本模块不替调用方合并它。
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 必需段中的**字符串段**（03 §7.2 七条目里未带「如」的四段）。
 * 「已召回」同为必需，但因是两级结构而由 `RECALLED_LABEL` 单独约束。顺序即呈现顺序。
 * `key` 是调用方的入参名，`label` 是 §7.2 的段名原文——两者都不得改动，
 * 因为 `label` 就是机械判定的锚（§17 第 4 项禁改 §7.2 的公共字段名）。
 */
export const REQUIRED_SECTIONS = Object.freeze([
  { key: "effective", label: "生效规则" },
  { key: "applicable", label: "适用规则" },
  { key: "allowed", label: "行动允许" },
  { key: "unverified", label: "未验证范围" },
]);

/** 条件段（原文带「如」）——未传则不呈现，不以空句占位（§17 第 2 项）。 */
export const CONDITIONAL_SECTIONS = Object.freeze([
  { key: "fastPath", label: "快通道声明" },
  { key: "escalation", label: "升级记录" },
]);

/** 「已召回」段名；其内容为 03 §7.2 的 ADR / Pitfall 两行两级结构。 */
export const RECALLED_LABEL = "已召回";

const RECALLED_SUB_LABELS = Object.freeze(["ADR", "Pitfall"]);

/** 交还开头标记（03 §7.2 的 `[预检落实记录]`）。 */
export const RECORD_HEADER = "[预检落实记录]";

function fail(code, message, extra = {}) {
  return { ok: false, error: { code, message }, ...extra };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 「已召回」区的三种合法取值（03 §7.2 末句区分，不得混用）。
 *
 * §7.2 原文末句：「快通道时，『已召回』区只记录适用来源要求的召回；**未要求的
 * 全量召回应明确标记『未遍历』，不得把未遍历写成已核对**。标准或加固路径时，
 * 按适用来源要求列出实际完成的召回及其适用结论。」
 *
 * 三个词因此是**三个不同的事实**：
 * - `未触发`——该来源的召回时机未成立（类型规范判定的结果）；
 * - `未遍历`——快通道下按 §6.2 本就不遍历，**不等于已核对**；
 * - 具体内容——实际完成的召回及其适用结论。
 *
 * **首版把「缺省」一律渲染为「未触发」，那是错的**：缺省只说明调用方没说，
 * 不说明召回时机未成立。把未知写成「未触发」正是 §7.2 要防的那种「把没查的写成
 * 查过了」。故本函数改为：未声明即 `未声明`（如实留白），并单列一条诊断。
 */
export const RECALL_MARKS = Object.freeze(["未触发", "未遍历", "未声明"]);

function normalizeRecalled(value, tier) {
  const blank = (reason) => ({
    adr: "未声明",
    pitfall: "未声明",
    declared: false,
    reason,
  });
  if (value === undefined || value === null) {
    return blank("调用方未给出「已召回」区；按 03 §7.2 不得以「未触发」冒充，故如实留「未声明」");
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return blank("「已召回」为空串，等同于未给出");
    // 单串无法区分 ADR / Pitfall：原样落在 ADR 行、Pitfall 行如实留「未声明」，
    // 并置 undifferentiated 供调用方补全——不猜、不拆、不静默丢弃。
    return { adr: text, pitfall: "未声明", undifferentiated: true, declared: false };
  }
  if (Array.isArray(value)) {
    const text = value.filter((item) => isNonEmptyString(item)).map((item) => item.trim()).join("；");
    if (text === "") return blank("「已召回」为空数组，等同于未给出");
    return { adr: text, pitfall: "未声明", undifferentiated: true, declared: false };
  }
  if (typeof value === "object") {
    // 逐级判断：给了就呈现，没给就留「未声明」——不替调用方填「未触发」。
    const level = (raw) => {
      if (isNonEmptyString(raw)) return raw.trim();
      // 显式写「未触发」/「未遍历」是合法声明；两者不得互换（§7.2 末句）。
      return "未声明";
    };
    const adr = level(value.adr);
    const pitfall = level(value.pitfall);
    // §7.2 末句：快通道下如实标「未遍历」是义务，不是可选项。
    const fastPath = tier === "快通道";
    const warns = [];
    if (fastPath && (adr === "未声明" || pitfall === "未声明")) {
      warns.push("快通道下的「已召回」区须逐级标明「未触发」或「未遍历」，不得留「未声明」（03 §7.2 末句）");
    }
    return { adr, pitfall, declared: true, fastPathWarnings: warns };
  }
  return blank(`「已召回」的形态无法识别（${typeof value}）`);
}

/** 「未遍历」与「未触发」不得互换：声明「已核对」而实为未遍历，是 §7.2 点名禁止的。 */
function checkRecallMarkSwap(recalled) {
  const offenders = [];
  for (const level of RECALLED_SUB_LABELS) {
    const text = String(recalled[level.toLowerCase()] ?? "");
    // 把「未遍历」写成「已核对」——§7.2 明禁。
    if (/未遍历/.test(text) && /已核对|已检查|已遍历/.test(text)) {
      offenders.push({ level, text });
    }
  }
  return offenders;
}

/**
 * 把调用方的字段对象渲染为 03 §7.2 的文本形态。
 *
 * 返回 `{ ok: true, text, sections, undifferentiatedRecall }` 或
 * `{ ok: false, error }`。缺必需段时**拒绝**而非填空（§17 第 2 项）。
 */
export function renderPrecheckRecord(fields = {}) {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return fail("invalid_request", "fields must be a plain object");
  }
  const missing = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!isNonEmptyString(fields[section.key])) missing.push(section.label);
  }
  if (missing.length > 0) {
    return fail(
      "record/section_missing",
      `预检落实记录缺必需段：${missing.join("、")}（03 §7.2；34 §17 第 2 项禁止以空句凑段）`,
      { missing },
    );
  }

  const recalled = normalizeRecalled(fields.recalled, fields.tier);
  // §7.2 末句：把「未遍历」写成「已核对」是点名禁止的混淆，机械层先拦。
  const swapped = checkRecallMarkSwap(recalled);
  if (swapped.length > 0) {
    return fail(
      "record/recall_mark_swapped",
      `03 §7.2 末句：不得把「未遍历」写成已核对；违规级别：${swapped.map((s) => s.level).join("、")}`,
      { offenders: swapped },
    );
  }
  const lines = [RECORD_HEADER, ""];
  const present = new Set();

  // §7.2 的段序：生效规则 → 适用规则 → 行动允许 → 已召回 → 未验证范围
  // → 快通道声明 → 升级记录。「已召回」位置固定，不因条件段缺省而移动。
  for (const key of ["effective", "applicable", "allowed"]) {
    const section = REQUIRED_SECTIONS.find((item) => item.key === key);
    lines.push(`- ${section.label}：${fields[key].trim()}`);
    present.add(section.label);
  }
  lines.push(`- ${RECALLED_LABEL}：`);
  for (const sub of RECALLED_SUB_LABELS) {
    lines.push(`  - ${sub}：${recalled[sub.toLowerCase()]}`);
  }
  present.add(RECALLED_LABEL);

  lines.push(`- 未验证范围：${fields.unverified.trim()}`);
  present.add("未验证范围");

  for (const section of CONDITIONAL_SECTIONS) {
    if (!isNonEmptyString(fields[section.key])) continue;
    lines.push(`- ${section.label}：${fields[section.key].trim()}`);
    present.add(section.label);
  }

  const ritual = detectRitualRecord(fields);
  return {
    ok: true,
    text: `${lines.join("\n")}\n`,
    sections: [...present],
    // §17 第 2 项：疑似空记录随记录交还，不阻断（判据在语义侧）。
    ritualSuspected: ritual.ok === true && ritual.ritualSuspected === true,
    ritualNotice: ritual.ok === true ? ritual.notice : null,
    undifferentiatedRecall: recalled.undifferentiated === true,
    // §7.2 末句：快通道下未逐级标明的，连同警告一并交还，不静默放过。
    fastPathWarnings: recalled.fastPathWarnings ?? [],
    // 缺省未声明时如实带出理由（不冒充「未触发」）。
    recallDeclarationGap: recalled.declared === false ? (recalled.reason ?? null) : null,
  };
}

/**
 * 形态核对（§14「三段判断齐备」行的机械侧）：只判段是否齐备，不判取值。
 * 传交还文本，返回缺哪几段；全齐时 `complete: true`。
 */
export function checkRecordShape(text) {
  if (!isNonEmptyString(text)) {
    return fail("invalid_request", "text must be a non-empty string");
  }
  if (!text.startsWith(RECORD_HEADER)) {
    return fail("record/header_missing", `记录须以 ${RECORD_HEADER} 起首（03 §7.2）`);
  }
  const present = [];
  const missing = [];
  for (const label of [...REQUIRED_SECTIONS.map((item) => item.label), RECALLED_LABEL]) {
    if (new RegExp(`^\\s*(?:- )?${label}：`, "m").test(text)) present.push(label);
    else missing.push(label);
  }
  return { ok: true, complete: missing.length === 0, present, missing };
}

/** 内容的 SHA-256 指纹（与其它 writer 同形，供回读比对与交还登记）。 */
export function recordFingerprint(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

/**
 * 交还承载：把记录包成交还结构，**不落盘**。
 *
 * ## 为什么本模块不写盘（34 §17 第 3 项 / §10）
 *
 * 34 §17 第 3 项红线：「不为本系统新建事实类型、状态字段或**专属存储**；
 * 预检落实记录按 03 §7，写入按既有类型。」§10「是否必须写入」进一步说明：
 * 「预检落实记录**必须生成并随交还呈现**（03 §7），但**不要求写入事实源**。」
 *
 * 故本模块**不**建 `ldvh/precheck-records/` 之类的私有目录——那正是红线所禁的
 * 「专属存储」。记录是**交还时的呈现物**：生成、返回、由调用方的交还正文承载。
 *
 * 需要跨交还留存时的正路是 specs/10 §7.7 的 Output Envelope 载体
 * （`ldvh/` 域，与管辖登记同级）。**该裁体尚未建成**，10 §7.7 对此已有明文：
 * 「机器承载建成前，交还维持 Human 可读正文并如实披露承载未建，不得声明已存在
 * 宿主承载。」故 `carrierStatus()` 如实报告未建，而不是自己造一个。
 */
export function buildHandover(fields = {}) {
  const rendered = renderPrecheckRecord(fields);
  if (!rendered.ok) return rendered;
  return {
    ok: true,
    // 交还正文直接可用的文本（03 §7.2 形态）。
    text: rendered.text,
    fingerprint: recordFingerprint(rendered.text),
    shape: checkRecordShape(rendered.text),
    sections: rendered.sections,
    undifferentiatedRecall: rendered.undifferentiatedRecall,
    // §10：记录不是事实对象，这里如实声明其承载边界。
    carrier: carrierStatus(),
  };
}

/**
 * 记录承载的当前状态（10 §7.7 的如实披露，不陈述「已建成」）。
 *
 * 返回 `persisted: false` 是**机械上可核对的事实**：本模块没有任何写盘路径。
 * 上游一旦建成 Output Envelope 载体，此函数须随之更新，且不得提前声称已建成。
 */
export function carrierStatus() {
  return {
    persisted: false,
    // 记录落在交还正文而非任何载体（34 §10「不要求写入事实源」）。
    carriedBy: "handover-text",
    envelope: {
      specRef: "specs/10 §7.7",
      // 10 §7.7 原文限定：载体形态随记忆系统设计定案；建成前须如实披露未建。
      built: false,
      disclosure: "Output Envelope 机器承载未建（specs/10 §7.7 允许此状态并禁止声明已建成）",
    },
  };
}

/**
 * 交还时须显式区分的两类结论（34 §12 的强制内容）。
 *
 * §12 原文：「交还中**须显式区分**『已识别未落实』与『已落实』两类结论，不得
 * 合并为『已遵守』。」本模块只**提供这个区分的位置**，不替调用方判定哪条属于
 * 哪类——那是语义判断（§14「不证明取值正确」）。
 */
export const FINDING_STATES = Object.freeze(["落实", "已识别未落实", "未识别"]);

/**
 * 约束落实的三项判据（34 §8.3，本系统核心判据）。
 *
 * §8.3 原文：「一项识别结果构成『已落实』，须同时满足：1. 有指向……2. 有改变
 * ……3. 有可回指依据……」。
 *
 * **本模块能机械做的只有一件事**：检查调用方是否**逐项给出了**这三项，以及是否
 * 出现了 §8.3 明禁的两种写法。它**不能**判断「有改变」是否真的成立——那要看
 * 「该要素与未识别到该项时不同」，是一个反事实比较，只有调用方掌握两侧。
 *
 * §8.3 末段还给了两种合法/非法写法，机械层可抓：
 * - **合法**：「确认约束后决定不需要改变行动」——但**须**作为三段判断中
 *   「行动允许」的显式结论，并说明为何该约束不要求改变；
 * - **非法**：以省略该项、或写「已遵守」来隐含该结论。
 */
export const APPLICATION_CRITERIA = Object.freeze([
  { key: "hasTarget", label: "有指向", question: "对应到当次行动的哪个具体要素（范围／路径／前置条件／是否继续／是否提请）" },
  { key: "hasChange", label: "有改变", question: "该要素与「未识别到该项时」有何不同（须可被指出，不是「确认无需改变」）" },
  { key: "hasTraceableBasis", label: "有可回指依据", question: "改变的理由如何回到该识别结果本身（不是事后归因）" },
]);

/** §8.3 明禁的合并写法：这些词一律不得充当「已落实」的结论。 */
const MERGED_COMPLIANCE_TERMS = Object.freeze(["已遵守", "已检查", "已确认", "没问题", "符合要求"]);

/**
 * 判定一条识别结果是否构成「已落实」（34 §8.3）。
 *
 * @param {object} finding
 * @param {string} finding.statement         被识别到的约束（一句话）
 * @param {string} [finding.hasTarget]       ①有指向的答案
 * @param {string} [finding.hasChange]       ②有改变的答案
 * @param {string} [finding.hasTraceableBasis]③有可回指依据的答案
 * @param {boolean} [finding.actionUnchangedByDesign]
 *        为 true 表示「确认约束后决定不需要改变行动」。§8.3 允许它，但**要求**
 *        它作为「行动允许」的显式结论并说明理由——故须同时给 `noChangeRationale`。
 * @param {string} [finding.noChangeRationale] 不改变行动的理由
 *
 * 返回 `state`：
 * - `落实`——三项齐备（或合法的「按设计不改变」）；
 * - `已识别未落实`——§8.3「三项中任一不成立」时的处置。
 */
export function evaluateApplication(finding = {}) {
  if (!isNonEmptyString(finding.statement)) {
    return fail("invalid_request", "each finding needs a statement (the constraint that was identified)");
  }
  const merged = MERGED_COMPLIANCE_TERMS.find((term) => String(finding.hasChange ?? "").includes(term));
  if (merged !== undefined) {
    // §8.3 末段：不得以写「已遵守」来隐含「确认无需改变」这一结论。
    return fail(
      "application/merged_compliance_claim",
      `第②项写成了「${merged}」：§8.3 禁止以「已遵守」类措辞代替可指出的改变；若确属「确认无需改变」，须走 actionUnchangedByDesign + noChangeRationale 显式形态`,
    );
  }

  const byDesign = finding.actionUnchangedByDesign === true;
  if (byDesign && !isNonEmptyString(finding.noChangeRationale)) {
    return fail(
      "application/no_change_rationale_missing",
      "声明「确认约束后决定不需要改变行动」时须说明为何该约束不要求改变（§8.3 末段），不得只写结论",
    );
  }

  const missing = APPLICATION_CRITERIA
    .filter((criterion) => !isNonEmptyString(finding[criterion.key]))
    .map((criterion) => criterion.label);

  // 合法的「按设计不改变」：第②项本就不适用（无改变是结论而非缺口），
  // 但①③仍须齐备——否则连「识别到了什么、依据在哪」都无从回指。
  const unresolved = byDesign
    ? missing.filter((label) => label !== "有改变")
    : missing;

  if (unresolved.length > 0) {
    return {
      ok: true,
      statement: finding.statement,
      state: "已识别未落实",
      unresolvedCriteria: unresolved,
      // §8.3：三项之任一不成立即未落实——不因其余两项齐备而改判。
      reason: `缺 ${unresolved.join("、")}；按 §8.3「三项中任一不成立」处理为已识别未落实`,
      claimsCompliance: false,
    };
  }

  return {
    ok: true,
    statement: finding.statement,
    state: "落实",
    unresolvedCriteria: [],
    unchangedByDesign: byDesign,
    claimsCompliance: false,
  };
}

/**
 * 批量判定，直接产出 34 §12 交还所需的两类区分。
 *
 * 与 `evaluateApplication` 的分工：后者判单条，本函数汇总并给出 §12 要求的分组
 * （「已落实」与「已识别未落实」**分列**，绝不合并成一句「已遵守」）。
 */
export function summarizeApplications(findings = []) {
  if (!Array.isArray(findings)) {
    return fail("invalid_request", "findings must be an array");
  }
  const settled = [];
  const unsettled = [];
  for (const finding of findings) {
    const verdict = evaluateApplication(finding);
    if (verdict.ok !== true) return verdict;
    (verdict.state === "落实" ? settled : unsettled).push(verdict);
  }
  return {
    ok: true,
    // §12：两类结论分列，位置固定。
    落实: settled,
    已识别未落实: unsettled,
    // §12 的禁区：不得给出合并式结论。
    claimsCompliance: false,
    mergedConclusionForbidden: true,
  };
}

export function checkFindingStates(findings) {
  if (!Array.isArray(findings)) {
    return fail("invalid_request", "findings must be an array");
  }
  const invalid = findings
    .map((finding, index) => ({ index, state: finding?.state }))
    .filter(({ state }) => !FINDING_STATES.includes(state));
  if (invalid.length > 0) {
    return fail(
      "findings/state_invalid",
      `逐项结论须落在 34 §12 的三态内（${FINDING_STATES.join(" / ")}），不得合并为「已遵守」`,
      { invalid },
    );
  }
  return {
    ok: true,
    counts: {
      落实: findings.filter((f) => f.state === "落实").length,
      已识别未落实: findings.filter((f) => f.state === "已识别未落实").length,
      未识别: findings.filter((f) => f.state === "未识别").length,
    },
    // §12 的禁区：任何合并式「已遵守」结论都不由本模块给出。
    claimsCompliance: false,
  };
}

// ---------------------------------------------------------------------------
// 复用判定（specs/03 §7.3）
// ---------------------------------------------------------------------------

/**
 * 复用条件的三条判据，逐条对应 03 §7.3：
 *
 *  1. 同一会话的连续行动步骤中，Human 目标、工作对象和当前行动范围未发生
 *     实质变化或超出上次覆盖范围；
 *  2. 上次记录后，当前 Working Tree 中作为预检依据的规则源和事实载体没有发生
 *     变更；
 *  3. 未出现新的召回触发、风险升级、能力缺口或 Human Gate 信号。
 *
 * **三条全部满足才可直接复用**（§7.3 首句「只可在……全部满足时」）。本模块把
 * 第 1、3 条留给调用方以布尔声明传入——它们含「实质变化」「新的召回触发」这类
 * 语义判断，机械层无法判定，**本模块不假装能判**（34 §14：机械结果与语义判断
 * 互不替代）。第 2 条可以机械地做：调用方给出上次记录时的载体指纹，本次回读同一
 * 批载体比对即可。
 *
 * **§7.3 末句的禁区**：「AI 不得以『无法证明没有变化』为由无差别重扫全部规则源
 * 或事实源；只核对当前行动所依赖的可观察范围。」故本函数**不扫描任何目录**——
 * 它只比对调用方显式列出的载体。没有列出载体时，第 2 条无法成立（返回
 * `unverifiable`），而**不是**默认通过；但也不因此要求调用方全量扫描。
 */
export const REUSE_CONDITIONS = Object.freeze([
  {
    key: "sameScope",
    // 03 §7.3 第 1 条原文。
    label: "同一会话的连续行动步骤中，Human 目标、工作对象和当前行动范围未发生实质变化或超出上次覆盖范围",
    mechanical: false,
  },
  {
    key: "sourcesUnchanged",
    // 03 §7.3 第 2 条原文。
    label: "上次记录后，当前 Working Tree 中作为预检依据的规则源和事实载体没有发生变更",
    mechanical: true,
  },
  {
    key: "noNewSignal",
    // 03 §7.3 第 3 条原文。
    label: "未出现新的召回触发、风险升级、能力缺口或 Human Gate 信号",
    mechanical: false,
  },
]);

/**
 * 判断一份既有记录可否直接复用。
 *
 * @param {object} input
 * @param {string} input.recordSessionId   既有记录所属会话
 * @param {string} input.sessionId         当前会话
 * @param {boolean} input.sameScope        调用方对第 1 条的语义结论
 * @param {boolean} input.noNewSignal      调用方对第 3 条的语义结论
 * @param {Array<{path: string, baseline: string|null, current: string|null}>} input.carriers
 *        第 2 条要核对的载体及其指纹。`current` 为 null 表示载体已不可读。
 *
 * 返回 `reusable` 只在三条**全部**成立时为 true；任何一条不成立或不可核验，
 * `reusable` 即为 false，并在 `failed` 里逐条说明是哪一条、为什么。
 */
export function evaluateReuse(input = {}) {
  const failed = [];
  const unverifiable = [];

  if (!isNonEmptyString(input.sessionId)) {
    return fail("invalid_request", "sessionId is required to judge 03 §7.3 condition 1");
  }

  // 条件 1：同会话 + 调用方的语义结论。
  if (!isNonEmptyString(input.recordSessionId) || input.recordSessionId !== input.sessionId) {
    failed.push({
      condition: "sameScope",
      reason: `既有记录不属于当前会话（记录=${input.recordSessionId ?? "未知"}，当前=${input.sessionId}）；跨会话不得直接复用`,
    });
  } else if (input.sameScope !== true) {
    failed.push({
      condition: "sameScope",
      reason: "调用方未确认目标、工作对象与行动范围未实质变化（03 §7.3 第 1 条，语义判断不由机械判定）",
    });
  }

  // 条件 2：载体指纹比对（机械可核）。
  const carriers = Array.isArray(input.carriers) ? input.carriers : [];
  if (carriers.length === 0) {
    unverifiable.push({
      condition: "sourcesUnchanged",
      reason: "未提供任何作为预检依据的载体指纹；该项按未核验处理，不默认通过（也不得据此要求全量扫描，03 §7.3 末句）",
    });
  } else {
    for (const carrier of carriers) {
      const path = carrier?.path;
      if (!isNonEmptyString(path)) {
        unverifiable.push({ condition: "sourcesUnchanged", reason: "载体条目缺 path，无法比对" });
        continue;
      }
      if (!isNonEmptyString(carrier.baseline)) {
        unverifiable.push({
          condition: "sourcesUnchanged",
          reason: `${path}：未记录基线指纹，无法证明未变更`,
        });
        continue;
      }
      if (carrier.current === null || carrier.current === undefined) {
        failed.push({ condition: "sourcesUnchanged", reason: `${path}：载体当前不可读` });
        continue;
      }
      if (carrier.current !== carrier.baseline) {
        failed.push({
          condition: "sourcesUnchanged",
          reason: `${path}：内容指纹已变更（基线 ${String(carrier.baseline).slice(0, 12)}… → 当前 ${String(carrier.current).slice(0, 12)}…）`,
        });
      }
    }
  }

  // 条件 3：调用方的语义结论。
  if (input.noNewSignal !== true) {
    failed.push({
      condition: "noNewSignal",
      reason: "调用方未确认未出现新的召回触发、风险升级、能力缺口或 Human Gate 信号（03 §7.3 第 3 条）",
    });
  }

  return {
    ok: true,
    reusable: failed.length === 0 && unverifiable.length === 0,
    failed,
    unverifiable,
    // §7.3 末句：不成立的处置是「重新执行受影响部分的预检并形成新的记录」，
    // 不是「扩大扫描」。本字段把该处置直说出来，免得调用方自行发挥。
    requiredAction: failed.length === 0 && unverifiable.length === 0
      ? null
      : "重新执行受影响部分的预检并形成新的预检落实记录（03 §7.3 末段）；不得以「无法证明没有变化」为由全量重扫",
  };
}

/**
 * 实际读盘计算一组载体的指纹，产出 `evaluateReuse` 需要的 `carriers` 入参。
 *
 * 存在的理由：03 §7.3 第 2 条要的是「上次记录后载体没有变更」，而不只是「调用方
 * 声称没有变更」。把这个比对交给调用方去手算，等于让被判断的一方自己出结论——
 * 那正是 34 §1 说的「识别的自我证明」。故本函数只做**确定性的读取与摘要**：
 * 读不存在的载体记 `current: null`（不伪造），读得到的算 SHA-256。
 *
 * **它不做的事**（与 §7.3 末句一致）：
 * - 不枚举目录、不 glob、不建索引——只读调用方逐个点名的路径；
 * - 不决定「该核对哪些载体」——那属语义判断（哪条规则/事实是本次预检的依据）；
 * - 不判断指纹变化是否影响本次行动——变化即变化，影响由调用方按 §7.3 末段处置。
 *
 * @param {string} root 项目根（载体路径相对于它解析）
 * @param {Array<string | {path: string, baseline?: string|null}>} carriers
 * @returns {Promise<{ok: true, carriers: Array<{path: string, baseline: string|null, current: string|null}>}>}
 */
export async function fingerprintCarriers(root, carriers) {
  if (!isNonEmptyString(root)) {
    return fail("invalid_request", "root is required to resolve carrier paths");
  }
  if (!Array.isArray(carriers)) {
    return fail("invalid_request", "carriers must be an array of path strings or {path, baseline} objects");
  }
  const out = [];
  for (const entry of carriers) {
    const path = typeof entry === "string" ? entry : entry?.path;
    if (!isNonEmptyString(path)) {
      return fail("invalid_request", "every carrier entry needs a path");
    }
    const baseline = typeof entry === "object" && entry !== null ? (entry.baseline ?? null) : null;
    let current = null;
    try {
      const text = await readFile(join(root, path), "utf8");
      current = recordFingerprint(text);
    } catch {
      // 读不到就记 null——「不可读」是一个要如实交还的状态，不是「无变化」。
      current = null;
    }
    out.push({ path, baseline, current });
  }
  return { ok: true, carriers: out };
}

// ---------------------------------------------------------------------------
// 时序判据（34 §9.2 登记时机 / §9.3 不追溯为已遵守 / §6 排除条件）
// ---------------------------------------------------------------------------

/** 偏离形态闭集（34 §9.1 的四类）。 */
export const DEVIATION_FORMS = Object.freeze([
  "未识别偏离",
  "已识别未落实偏离",
  "判断错误偏离",
  "来源本身冲突",
]);

/** 偏离登记须含的四项（34 §9.2 原文列举）。 */
export const DEVIATION_FIELDS = Object.freeze([
  { key: "form", label: "偏离形态" },
  { key: "affectedScope", label: "受影响范围" },
  { key: "sideEffects", label: "已发生的副作用" },
  { key: "pendingChecks", label: "待核对项" },
]);

/**
 * 判定一次偏离登记是否满足 34 §9.2 的两项要求：
 *
 *  1. **形态在闭集内**（§9.1 四类）——否则无法按形态分流；
 *  2. **发现即登记**——`registeredAt` 必须不晚于 `returnedAt`（交还时刻），
 *     且两者都必须存在。§9.2 原文：「偏离须在发现时立即登记，不得等到交还时
 *     一并说明」。延迟登记**本身**须作为一项偏离如实登记（§14 该行「未满足时
 *     的处理」），故此处返回 `lateRegistration` 供调用方据此追加一条。
 *
 * **本函数不判断**：偏离是否真的发生、形态判定是否正确、影响范围是否完整——
 * 那是语义判断（§14：机械结果与语义判断互不替代）。
 */
export function evaluateDeviation(input = {}) {
  const missing = DEVIATION_FIELDS
    .filter((field) => !isNonEmptyString(input[field.key]))
    .map((field) => field.label);
  if (missing.length > 0) {
    return fail(
      "deviation/fields_missing",
      `偏离登记缺 §9.2 要求的项：${missing.join("、")}`,
      { missing },
    );
  }
  if (!DEVIATION_FORMS.includes(input.form)) {
    return fail(
      "deviation/form_invalid",
      `偏离形态须落在 34 §9.1 的闭集内（${DEVIATION_FORMS.join(" / ")}）`,
      { allowed: [...DEVIATION_FORMS] },
    );
  }
  const discovered = Date.parse(input.discoveredAt ?? "");
  const registered = Date.parse(input.registeredAt ?? "");
  const returned = Date.parse(input.returnedAt ?? "");
  if (Number.isNaN(discovered) || Number.isNaN(registered)) {
    return fail("deviation/timestamp_invalid", "discoveredAt 与 registeredAt 须为可解析的时间");
  }
  if (!Number.isNaN(returned) && registered > returned) {
    return fail("deviation/registered_after_return", "登记时刻晚于交还时刻：§9.2 要求发现时立即登记");
  }
  const lateRegistration = registered > discovered;
  return {
    ok: true,
    form: input.form,
    // §9.2 的时间序判据：登记不得晚于交还。
    registeredBeforeReturn: Number.isNaN(returned) ? null : registered <= returned,
    // 发现与登记不同刻即属「延迟登记」——§14 要求该延迟本身再登记为一条偏离。
    lateRegistration,
    // §9.3 的禁区：补做识别不改变已发生偏离的性质。
    retroactiveReliefGranted: false,
  };
}

/**
 * 判定一次「事后补做识别」是否被当成「从未偏离」（34 §9.3 的禁区）。
 *
 * §9.3 原文：「已发生的偏离不因事后补做识别而视为未发生，也不因补做后记录完整
 * 而转为『已遵守』。事后补齐的识别只能证明补齐后的状态，其前一段的偏离须如实
 * 保留在交还与记录中。」
 *
 * 故：任何一份记录若其 `backfilledAt` 晚于 `actionAt`（行动已发生才补做识别），
 * 它的 `coversDeviations` 就**不得**为 false——否则就是拿补做覆盖了那一段。
 * 本函数只在机械上抓住这一种形态，不评价补齐质量。
 */
export function checkRetroactiveCoverage(input = {}) {
  const action = Date.parse(input.actionAt ?? "");
  const backfilled = Date.parse(input.backfilledAt ?? "");
  const declared = input.coversDeviations;
  if (Number.isNaN(action)) {
    return fail("invalid_request", "actionAt must be a parseable timestamp");
  }
  // 无 backfilledAt ＝ 不是补做，无需此判据。
  if (Number.isNaN(backfilled)) {
    return { ok: true, backfilled: false, retroactive: false, acceptable: true };
  }
  const retroactive = backfilled > action;
  if (retroactive && declared === false) {
    return fail(
      "record/retroactive_coverage",
      "补做识别（backfilledAt 晚于 actionAt）却声明未覆盖偏离：34 §9.3 禁止以补做识别覆盖已发生的偏离",
    );
  }
  return {
    ok: true,
    backfilled: true,
    retroactive,
    // 补做时须显式保留偏离段；声明已覆盖即为合法形态。
    acceptable: !retroactive || declared === true,
    // §9.3：补做只能证明补齐后的状态。
    provesOnlyAfterBackfill: retroactive,
  };
}

// ---------------------------------------------------------------------------
// 风险路由（34 §11 环节级声明 / 03 §6.2 快通道声明 / §6.3 升级）
// ---------------------------------------------------------------------------

/** 三个风险层（03 §6.1 的闭集；34 §17 第 4 项禁增设中间层）。 */
export const RISK_TIERS = Object.freeze(["快通道", "标准路径", "加固路径"]);

/**
 * 34 §11 的环节级声明：哪些环节可走快通道，哪些必须标准路径以上。
 *
 * §11 原文：「纯读取与来源检索环节可走快通道；**三段判断、约束落实判定与偏离
 * 判定必须标准路径以上**；任何涉及授权边界的判断不得产自快通道。」
 *
 * 这张表是**机械可核的**：调用方声明的「本环节走快通道」与该环节的最低要求一比对，
 * 就能判出这次声明是否越权。它不判断风险高低——那属语义与 03 §6.3。
 */
export const STAGE_MINIMUM_TIER = Object.freeze({
  纯读取: "快通道",
  来源检索: "快通道",
  三段判断: "标准路径",
  约束落实判定: "标准路径",
  偏离判定: "标准路径",
  涉及授权边界的判断: "标准路径",
});

/** 任一环节涉及授权边界时，快通道一律不可用（§11 末句）。 */
const AUTHORIZATION_STAGE = "涉及授权边界的判断";

/**
 * 判定一次风险路由声明是否满足 34 §11。
 *
 * @param {object} input
 * @param {string} input.stage      环节名（须为 STAGE_MINIMUM_TIER 的键）
 * @param {string} input.tier       调用方声明的风险层
 * @param {boolean} [input.involvesAuthorization] 本环节是否涉及授权边界
 *
 * 返回 `allowed` 为 false 时同时给出 `minimumTier` 与 `reason`——这正是 03 §6.2
 * 第 4 项要求的「升级触发」在机械侧的样子：不是「建议升级」，是「此声明不成立」。
 */
export function checkRiskRouting(input = {}) {
  const stage = input.stage;
  const tier = input.tier;
  if (!isNonEmptyString(stage) || !Object.hasOwn(STAGE_MINIMUM_TIER, stage)) {
    return fail(
      "routing/stage_unknown",
      `环节须为 34 §11 声明的环节之一（${Object.keys(STAGE_MINIMUM_TIER).join(" / ")}）`,
      { allowed: Object.keys(STAGE_MINIMUM_TIER) },
    );
  }
  if (!RISK_TIERS.includes(tier)) {
    return fail(
      "routing/tier_invalid",
      `风险层须落在 03 §6.1 的三层内（${RISK_TIERS.join(" / ")}）；34 §17 第 4 项禁增设中间层`,
      { allowed: [...RISK_TIERS] },
    );
  }
  const minimum = STAGE_MINIMUM_TIER[stage];
  const rank = (value) => RISK_TIERS.indexOf(value);
  const involvesAuthorization = input.involvesAuthorization === true;

  // §11 末句：任何涉及授权边界的判断不得产自快通道——独立于环节表再判一次。
  if (involvesAuthorization && tier === "快通道") {
    return {
      ok: true,
      allowed: false,
      stage,
      tier,
      minimumTier: AUTHORIZATION_STAGE,
      reason: "34 §11：任何涉及授权边界的判断不得产自快通道（与环节表独立）",
    };
  }
  if (rank(tier) < rank(minimum)) {
    return {
      ok: true,
      allowed: false,
      stage,
      tier,
      minimumTier: minimum,
      reason: `34 §11：${stage} 必须 ${minimum} 以上，声明的 ${tier} 不足`,
    };
  }
  return { ok: true, allowed: true, stage, tier, minimumTier: minimum, reason: null };
}

/**
 * 快通道声明的五要素核对（03 §6.2）。
 *
 * §6.2 要求快通道声明必须包含：①适用条件 ②排除条件 ③最低预检覆盖
 * ④升级触发 ⑤声明方式。缺项即该声明不成立——机械层只能查**是否给了**，
 * 不能查**写得对不对**（那属 03 §6.2 的语义与本系统 §14 的边界）。
 */
export const FAST_PATH_REQUIREMENTS = Object.freeze([
  { key: "applicability", label: "适用条件" },
  { key: "exclusions", label: "排除条件" },
  { key: "minimumCoverage", label: "最低预检覆盖" },
  { key: "escalationTriggers", label: "升级触发" },
  { key: "declarationForm", label: "声明方式" },
]);

export function checkFastPathDeclaration(declaration = {}) {
  const missing = FAST_PATH_REQUIREMENTS
    .filter((requirement) => !isNonEmptyString(declaration[requirement.key]))
    .map((requirement) => requirement.label);
  if (missing.length > 0) {
    return fail(
      "fastpath/declaration_incomplete",
      `快通道声明缺 03 §6.2 要求的要素：${missing.join("、")}`,
      { missing },
    );
  }
  // §6.2 第 3 项：快通道仍须完成三段判断——这是下限，声明不得低于它。
  if (declaration.waivesThreeWayJudgement === true) {
    return fail(
      "fastpath/waives_three_way",
      "03 §6.2 第 3 项：快通道仍必须完成生效/适用/行动允许三段判断，不得声明免除",
    );
  }
  return { ok: true, complete: true, tiers: [...RISK_TIERS], waivesThreeWay: false };
}

// ---------------------------------------------------------------------------
// 进入判定与停止位置（34 §6 / §8 失败分流与停止位置）
// ---------------------------------------------------------------------------

/** 34 §6「进入信号」的四种情形（原文逐条）。 */
export const ENTRY_SIGNALS = Object.freeze([
  "即将执行会产生副作用或改变状态的动作",
  "既有规则、事实、决定或授权发生变化",
  "上一轮交还声明了未验证范围，而本次行动落在该范围之内",
  "执行中发现实际影响超出事先假设的范围",
]);

/** 34 §6「排除条件」：纯读取与纯查询动作不进入本系统。 */
export const EXCLUDED_ACTION_KINDS = Object.freeze(["纯读取", "纯查询"]);

/**
 * 判定一次行动是否进入本系统（34 §6）。
 *
 * §6 的三条要点，机械层可核的是**形态**：
 *  1. 排除条件优先——「纯读取与纯查询动作不进入本系统」，即使命中某个进入信号；
 *  2. 进入信号命中任一即进入（§6 原文「出现以下任一情形时」）；
 *  3. **适用性不明不得按「无约束」处理**——§6「不确定处理」：须登记为未验证范围，
 *     并判断是否升级；可能改变行动是否被允许时须停止。故本函数在三态之外多给一个
 *     `undetermined`，并明确它**不是** `entered: false` 的同义词。
 *
 * **本函数不判断**行动是否真的会产生副作用、适用性是否真的不明——那是调用方的
 * 语义判断（§14）。它只为那个判断提供不可跳过的三个出口。
 */
export function checkEntry(input = {}) {
  const kind = input.actionKind;
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const unknownSignals = signals.filter((signal) => !ENTRY_SIGNALS.includes(signal));
  if (unknownSignals.length > 0) {
    return fail(
      "entry/signal_unknown",
      `进入信号须为 34 §6 列出的四种之一；未知项：${unknownSignals.join("、")}`,
      { allowed: [...ENTRY_SIGNALS] },
    );
  }
  if (EXCLUDED_ACTION_KINDS.includes(kind)) {
    // §6 排除条件：不进入本系统。注意这**不是**「可以不做识别」的意思，
    // 而是该动作不产生需授权的变更；一旦真产生了副作用，就不属纯读取了。
    return { ok: true, entered: false, undetermined: false, reason: `34 §6 排除条件：${kind}动作不进入本系统` };
  }
  if (input.applicabilityUndetermined === true) {
    // §6 不确定处理：不得按「无约束」处理。
    return {
      ok: true,
      entered: null,
      undetermined: true,
      mustRegisterAsUnverified: true,
      reason: "34 §6 不确定处理：适用性无法判定时不得按「无约束」处理，须登记为未验证范围",
      // §6 末句：可能改变行动是否被允许时须停止并交还。
      mustStop: input.mayChangePermission !== false,
    };
  }
  if (signals.length === 0) {
    // 无进入信号、非排除动作、适用性未声明不明——这是「未命中」而非「已排除」。
    return {
      ok: true,
      entered: false,
      undetermined: false,
      reason: "未命中 34 §6 的任一进入信号；注意这表示当次不进入，不表示适用性已被否证",
    };
  }
  return { ok: true, entered: true, undetermined: false, signals, reason: null };
}

/** 34 §8「失败分流」的四条去向（原文逐条）。 */
export const FAILURE_ROUTES = Object.freeze([
  "识别失败",
  "三段判断任一项不成立",
  "落实未发生",
  "偏离已发生",
]);

/**
 * 判定某个失败点的处置（34 §8 失败分流 + 停止位置）。
 *
 * §8 原文的对应关系：
 *  - 识别失败 → 按 03 §6.3 升级并按 00 §5.7 暂停；
 *  - 三段判断任一项不成立 → 按性质分流（生效补来源／适用缩小范围／允许停止）；
 *  - 落实未发生 → 视为未落实，按 §8.3 判定后停止或重做；
 *  - 偏离已发生 → 进入 §9 偏离处置。
 *
 * 以及「停止位置」段：「任一失败分流点都是停止位置：不在该点继续后续环节，也不以
 * 『其余部分已完成』为由部分交付。停止位置的残留范围须如实进入交还。」
 * → 故**四条去向一律 `mustStop: true`**，且**一律要求**残留范围进入交还。
 */
export function routeFailure(input = {}) {
  const route = input.route;
  if (!FAILURE_ROUTES.includes(route)) {
    return fail(
      "failure/route_unknown",
      `失败去向须为 34 §8 列出的四条之一（${FAILURE_ROUTES.join(" / ")}）`,
      { allowed: [...FAILURE_ROUTES] },
    );
  }
  const actions = {
    识别失败: "按 03 §6.3 升级并按 00 §5.7 暂停；不得以「已尽力检索」代替识别结论",
    三段判断任一项不成立: "按性质分流：生效不成立补来源／适用不成立缩小范围／行动允许不成立停止",
    落实未发生: "视为未落实，不得以记录齐全替代；按 §8.3 判定后停止或重做",
    偏离已发生: "进入 §9 偏离处置（形态须落在 §9.1 闭集内）",
  };
  return {
    ok: true,
    route,
    action: actions[route],
    // §8 停止位置：四条去向都是停止位置，无一例外。
    mustStop: true,
    // §8 停止位置：不得以「其余部分已完成」为由部分交付。
    partialDeliveryForbidden: true,
    // §8 停止位置：残留范围须如实进入交还。
    mustCarryResidualToHandover: true,
  };
}

// ---------------------------------------------------------------------------
// 横切合并且不替代（34 §11 横切性的边界 / §16.1 第 6 项必停）
// ---------------------------------------------------------------------------

/**
 * 判定两套预检是否「合并而非替代」（34 §11 横切性的边界）。
 *
 * §11 原文：「本系统横切全部业务系统，故在任何一个业务系统内执行时，其预检须与
 * 该系统自身的预检**合并而非替代**——不得因本系统已执行而免除该系统的专属预检，
 * 也不得因该系统已预检而免除本系统的适用识别。」
 *
 * §16.1 第 6 项把它列为**领域必停情形**：「在某个业务系统内以本系统预检替代该
 * 系统的专属预检，或以该系统预检免去本系统的适用识别」。
 *
 * 故这是**双向**的（§11 的两句对称，正是它区别于普通分工声明之处）：
 *  - 只做本系统、没做该系统 → 不免除，不构成通过；
 *  - 只做该系统、没做本系统 → 同样不免除。
 *
 * **本函数能核的只有「两套是否都在」这一形式事实**（§14 该行「两套预检并存的事实；
 * 不证明任一套正确」）。它不判断两套质量。
 */
export function checkTransverseMerge(input = {}) {
  if (!isNonEmptyString(input.systemKey)) {
    return fail("invalid_request", "systemKey is required (which business system this action runs inside)");
  }
  const hasRuleCompliance = input.ruleComplianceExecuted === true;
  const hasSystemSpecific = input.systemSpecificExecuted === true;
  const missing = [];
  if (!hasRuleCompliance) missing.push("本系统的适用识别与预检");
  if (!hasSystemSpecific) missing.push(`${input.systemKey} 的专属预检`);
  if (missing.length > 0) {
    return {
      ok: true,
      // §14 该行未满足处置：「缺任一套即不构成通过」。
      passed: false,
      missing,
      // §16.1 第 6 项：这正是必停情形本身。
      stopCondition: "34 §16.1 第 6 项",
      reason: `横切合并且不替代：缺 ${missing.join("、")}；34 §11 双向都不免除`,
    };
  }
  return {
    ok: true,
    passed: true,
    missing: [],
    // §14 该行的可证明范围：只证明两套并存。
    proves: "两套预检并存的事实；不证明任一套正确",
  };
}

// ---------------------------------------------------------------------------
// 未识别缺口的登记（34 §14 该行 / §8 失败分流 / §9.3）
// ---------------------------------------------------------------------------

/** §14 明禁的替代写法：这些话不得代替缺口登记。 */
const GAP_SUBSTITUTE_TERMS = Object.freeze(["已尽力", "尽力了", "已充分检索", "已全面检索", "应该没有遗漏"]);

/** 缺口须带的三项（§14 该行「缺口清单核对」）。 */
/**
 * 缺口登记须带的三项。
 *
 * **注意**：34 §14 的「未识别缺口的登记」行**没有**逐字列出这三项名；它的成立
 * 条件是「未识别到的来源已被登记为缺口，而非静默略过」，可接受依据是「交还中的
 * 未验证范围段与偏离登记」，未满足时的处理是「补齐登记后交还；不得以『已尽力』
 * 替代缺口登记」。
 *
 * 故这三项是**本模块按该行语义拆出的机械字段**，不是原文措辞——`GAP_FIELDS` 的
 * label 因此不参与「逐字回指原文」的漂移守卫（见 spec-drift 测试对应断言）。
 * 若日后 34 号明列三项，须把 label 改为原文措辞。
 */
export const GAP_FIELDS = Object.freeze([
  { key: "source", label: "未识别的来源", verbatim: false },
  { key: "scope", label: "影响的范围", verbatim: false },
  { key: "state", label: "缺口状态", verbatim: false },
]);

/**
 * 核对未识别缺口的登记（34 §14「未识别缺口的登记」行）。
 *
 * §14 该行：成立条件为「未识别到的来源已被登记为缺口，而非静默略过」；可接受
 * 依据为「交还中的未验证范围段与偏离登记」；**未满足时的处理**为「补齐登记后
 * 交还；不得以『已尽力』替代缺口登记」。
 *
 * §8 失败分流同向：「不得以『已尽力检索』代替识别结论」。
 *
 * 故本函数做两件事：
 *  1. **禁止替代**：缺口的说明里出现「已尽力」类措辞即拒绝——那是 §14 点名禁止
 *     的写法，不是措辞偏好；
 *  2. **要求逐项**：每个缺口须有来源、影响范围、状态三项，缺项即该缺口未被如实
 *     登记（不是「登记得不够好」）。
 *
 * **本函数不判断**缺口是否已闭合——§14 该行「可证明范围」明写「缺口是否被如实
 * 列出；不证明缺口已闭合」。
 */
export function checkGapRegistration(gaps) {
  if (!Array.isArray(gaps)) {
    return fail("invalid_request", "gaps must be an array (empty array = no gaps, which is a claim to be judged semantically)");
  }
  const rejected = [];
  const incomplete = [];
  for (const [index, gap] of gaps.entries()) {
    const note = String(gap?.note ?? gap?.reason ?? gap?.description ?? "");
    const substitute = GAP_SUBSTITUTE_TERMS.find((term) => note.includes(term));
    if (substitute !== undefined) {
      rejected.push({ index, term: substitute });
      continue;
    }
    const missing = GAP_FIELDS
      .filter((field) => !isNonEmptyString(gap?.[field.key]))
      .map((field) => field.label);
    if (missing.length > 0) incomplete.push({ index, missing });
  }
  if (rejected.length > 0) {
    return fail(
      "gap/substitute_claim",
      `34 §14 禁止以「${rejected.map((item) => item.term).join("」「")}」替代缺口登记；须补齐来源、影响范围与状态`,
      { rejected },
    );
  }
  if (incomplete.length > 0) {
    return fail(
      "gap/incomplete",
      `缺口登记缺项：${incomplete.map((item) => `#${item.index} 缺 ${item.missing.join("、")}`).join("；")}`,
      { incomplete },
    );
  }
  return {
    ok: true,
    count: gaps.length,
    // §14 该行的可证明范围，逐字保留其边界。
    proves: "缺口是否被如实列出；不证明缺口已闭合",
    closesGaps: false,
  };
}

// ---------------------------------------------------------------------------
// 交还结构（34 §12：七项 + 强制区分）
// ---------------------------------------------------------------------------

/** 三段判断的三项（34 §8 第 2 项；字段与格式以 03 §7.2 为准）。 */
export const THREE_WAY_ITEMS = Object.freeze([
  { key: "effective", label: "生效" },
  { key: "applicable", label: "适用" },
  { key: "allowed", label: "行动允许" },
]);

/**
 * §12 交还的七项。
 *
 * §12 原文：「每次交还：当次识别的来源范围与识别结论；三段判断的结果（逐项）；
 * 约束落实的具体形态（§8.3 的三项各自如何成立）；已召回与未触发的类型；
 * **未验证范围**（哪些来源未识别、哪些判断未核对）；偏离情况（如有，按 §9.2
 * 已登记）；待 Human 决定事项。」
 *
 * 只有「偏离情况」带「如有」——故它是**条件项**，其余六项必填。这与 §17 第 2 项
 * 的纪律一致：不带「如有」的项不得省略，带「如有」的项不得凭空造一条。
 */
export const RETURN_ITEMS = Object.freeze([
  { key: "identification", label: "当次识别的来源范围与识别结论", required: true, shape: "string" },
  { key: "threeWayJudgement", label: "三段判断的结果", required: true, shape: "object" },
  { key: "application", label: "约束落实的具体形态", required: true, shape: "object" },
  { key: "recalled", label: "已召回与未触发的类型", required: true, shape: "string" },
  { key: "unverified", label: "未验证范围", required: true, shape: "string" },
  { key: "deviations", label: "偏离情况", required: false, shape: "array" },
  { key: "humanDecisions", label: "待 Human 决定事项", required: true, shape: "string" },
]);

/** 按声明的形态判「这一项有没有给」。结构化项不看字符串，否则对象必被误判为缺失。 */
function presentByShape(value, shape) {
  if (shape === "string") return isNonEmptyString(value);
  if (shape === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (shape === "array") return Array.isArray(value);
  return false;
}

/** §12 的强制区分：两类结论的标题（位置固定，不合并）。 */
export const COMPLIANCE_BUCKET_LABELS = Object.freeze(["已落实", "已识别未落实"]);

/**
 * 组装一次 §12 交还。
 *
 * 做三件事，都是**形式核对**，不判断内容正确：
 *  1. 六项必填是否都在（偏离情况按「如有」条件）；
 *  2. 三段判断**逐项**是否有结论（§12「逐项」，缺一项即不齐）；
 *  3. 两类结论是否**分列**且交还文本里不出现合并式「已遵守」（§12 第二段，强制）。
 *
 * 偏离情况若给出，逐条过 `evaluateDeviation`（§9.2 的形态闭集与时间序）。
 *
 * **本函数不判断**：识别是否充分、三段判断取值是否正确、落实是否真的发生。
 * 它返回的 `claimsCompliance` 恒为 false——§12 禁止本系统给出合并结论。
 */
export function assembleReturn(input = {}) {
  // 三段判断须逐项：单串无法承载「逐项」，拒绝而非拆解。
  if (isNonEmptyString(input.threeWayJudgement)) {
    return fail(
      "return/three_way_not_itemized",
      "三段判断须逐项给出（生效／适用／行动允许），不得以一句概括替代（34 §12「逐项」）",
      { required: THREE_WAY_ITEMS.map((item) => item.label) },
    );
  }

  const missing = RETURN_ITEMS
    .filter((item) => item.required && !presentByShape(input[item.key], item.shape))
    .map((item) => item.label);

  // 三段判断逐项核对（对象形态）。
  const threeWay = input.threeWayJudgement ?? {};
  const threeWayMissing = THREE_WAY_ITEMS
    .filter((item) => !isNonEmptyString(threeWay[item.key]))
    .map((item) => item.label);
  if (threeWayMissing.length > 0 && !missing.includes("三段判断的结果")) {
    missing.push(`三段判断的结果（缺 ${threeWayMissing.join("、")}）`);
  }

  // 强制区分：`application` 须是 summarizeApplications 的形状且分列。
  const application = input.application;
  const hasBuckets = application !== null
    && typeof application === "object"
    && Array.isArray(application.落实)
    && Array.isArray(application.已识别未落实);
  if (!hasBuckets && !missing.includes("约束落实的具体形态")) {
    missing.push(
      "约束落实的具体形态（须按 §8.3 逐项给出，并分列「已落实」与「已识别未落实」；合并为一句即不成立）",
    );
  }

  if (missing.length > 0) {
    return fail("return/items_missing", `34 §12 交还缺项：${missing.join("；")}`, { missing });
  }

  // 偏离情况（如有）：逐条过 §9.2。
  const deviations = Array.isArray(input.deviations) ? input.deviations : [];
  const deviationResults = [];
  for (const deviation of deviations) {
    const verdict = evaluateDeviation(deviation);
    if (verdict.ok !== true) return verdict;
    deviationResults.push(verdict);
  }

  // §12 第二段：不得把两类合并成「已遵守」。
  const haystack = [input.identification, input.unverified, threeWay.effective, threeWay.applicable, threeWay.allowed]
    .filter((value) => typeof value === "string")
    .join("\n");
  const merged = MERGED_COMPLIANCE_TERMS.find((term) => haystack.includes(term));
  if (merged !== undefined) {
    return fail(
      "return/merged_conclusion",
      `交还正文出现「${merged}」：34 §12 要求显式区分「已落实」与「已识别未落实」，不得合并为「已遵守」`,
    );
  }

  const lines = [
    "## 交还（34 §12）",
    "",
    `- 当次识别的来源范围与识别结论：${input.identification.trim()}`,
    "- 三段判断的结果：",
    ...THREE_WAY_ITEMS.map((item) => `  - ${item.label}：${threeWay[item.key].trim()}`),
    "- 约束落实的具体形态：",
    `  - ${COMPLIANCE_BUCKET_LABELS[0]}：${application.落实.length} 项`,
    `  - ${COMPLIANCE_BUCKET_LABELS[1]}：${application.已识别未落实.length} 项`,
    `- 已召回与未触发的类型：${input.recalled.trim()}`,
    `- 未验证范围：${input.unverified.trim()}`,
    `- 偏离情况：${deviations.length === 0 ? "无（本节按 34 §9.2 为空；空白不代替登记）" : `${deviations.length} 项，均已按 §9.2 登记`}`,
    `- 待 Human 决定事项：${input.humanDecisions.trim()}`,
  ];

  return {
    ok: true,
    text: `${lines.join("\n")}\n`,
    complete: true,
    deviations: deviationResults,
    buckets: { 已落实: application.落实.length, 已识别未落实: application.已识别未落实.length },
    // §12 的禁区：本模块从不给出合并式结论。
    claimsCompliance: false,
    // §12 第二段的强制项，如实回显已执行。
    distinctionEnforced: true,
  };
}

// ---------------------------------------------------------------------------
// 来源冲突的层级参考（34 §7.5 —— 只用于提请，不构成自动裁决）
// ---------------------------------------------------------------------------

/**
 * §7.5 的层级表（原文五级）。
 *
 * ## 这不是 §17 第 7 项所禁的「预设冲突图」
 *
 * §17 第 7 项：「不为「未来可能的规则冲突分析」预设冲突图或优先级表。」
 *
 * 本常量的每一行都是 34 §7.5 **原文已有的**表格行（逐字由其 `source` 列抄录），
 * 不是我为未来冲突场景预建的结构。二者的区别是：承载原文＝把已生效的规范形状
 * 编码进代码；预设结构＝在规范尚未定义时由 Code 先行造一张图。前者受 `01 §11.4`
 * 「来源先行」约束（故有 spec-drift 守卫逐字回指原文），后者被 §17 第 7 项禁止。
 *
 * 同时 `routeConflict` 永不返回「选哪一方」——§7.5 明文「层级数值不构成优先级
 * 分数，不用于自动裁决」，故本表在此处**只承载「向谁提请」，不承载优先级**。
 */
export const CONFLICT_TIERS = Object.freeze([
  { level: 1, source: "00 根规范", self: false },
  { level: 2, source: "01–11 基础规范", self: false },
  { level: 3, source: "20–27 事实类型规范", self: false },
  { level: 4, source: "30–39 业务系统规范", self: false },
  { level: 5, source: "项目事实源中的事实与决定", self: false },
]);

/** 34 号自身的归属段（§7.5 明写「本规范自身不在本表内」）。 */
export const SELF_TIER_SEGMENT = "30–39 业务系统规范";

/**
 * 判定一次来源冲突该向谁提请（34 §7.5）。
 *
 * ## 这张表的边界，是本函数存在的全部理由
 *
 * §7.5 原文末段：「层级只表示**在发现冲突时向谁提请**，不表示高层级来源可以自动
 * 覆盖低层级来源的具体要求——除非该覆盖本身有来源明文授权。层级数值不构成优先级
 * 分数，**不用于自动裁决**，也不因本表存在而免除本节前段的冲突处理义务。」
 *
 * 故本函数**只返回 `escalateTo: "Human"`，永不返回任何「选哪一方」的结论**。
 * 它连 `winner` 这样的字段都不提供——提供即等于给自动裁决留了口子。
 *
 * ## 表外的两种情形
 *
 * - **本规范自身不在表内**（§7.5 表头括注）：34 号与任何来源冲突时，
 *   不得以「本规范是第 4 级」为由自裁——按 §7「缺失和冲突处理」交还 Human。
 * - **层级 1 的特殊性**：原文对该级有两段式——冲突涉及 00 §4.2 根决定清单所列
 *   事项时**一律提请**；仅当冲突不触及根决定、且根规范已给出明文结论时，
 *   才可依根规范处置。本函数把这两个分支都如实返回，不替调用方判断「是否涉及根决定」。
 */
export function routeConflict(input = {}) {
  const levels = [input.levelA, input.levelB];
  for (const level of levels) {
    if (!Number.isInteger(level) || !CONFLICT_TIERS.some((tier) => tier.level === level)) {
      return fail(
        "conflict/level_invalid",
        `层级须为 34 §7.5 表内的一至五级；收到 ${JSON.stringify(level)}`,
        { allowed: CONFLICT_TIERS.map((tier) => tier.level) },
      );
    }
  }
  if (input.involvesThisSpec === true) {
    // §7.5 表头括注：本规范自身不在本表内，故不存在「按级处置」这条路。
    return {
      ok: true,
      escalateTo: "Human",
      reason: "34 §7.5：本规范自身不在层级表内（不自指），故不得按级处置，须按 §7 交还 Human",
      autoResolved: false,
      picks: null,
    };
  }
  if (levels.includes(1) && input.touchesRootDecisionList === true) {
    return {
      ok: true,
      escalateTo: "Human",
      reason: "34 §7.5 第 1 级：冲突涉及 00 §4.2 根决定清单所列事项时一律提请 Human",
      autoResolved: false,
      picks: null,
    };
  }
  // 其余情形：原文一律「冲突须提请 Human，不得自行取舍」。
  return {
    ok: true,
    escalateTo: "Human",
    reason: "34 §7.5：层级只表示向谁提请，冲突须提请 Human，不得自行取舍",
    autoResolved: false,
    // 刻意恒为 null：§7.5 明禁自动裁决，本函数不提供任何「选哪一方」的出口。
    picks: null,
    // 层级数值不是优先级分数，如实回显以免被当成分数用。
    levelsAreScores: false,
  };
}

// ---------------------------------------------------------------------------
// 回读（34 §10「预检落实记录生成后须可回读」）
// ---------------------------------------------------------------------------

/**
 * 把一段 §7.2 形态的记录**解析回结构化字段**。
 *
 * 为什么这是「可回读」而非「形态核对」：§10 要求「生成后须可回读（当次交还中
 * 即可见）」。只判「段名在不在」不算回读——那只能证明有人写过那几个字。回读要求
 * 把**内容**取回来，使下游（如 §14 的「格式解析与逐项核对」）能真的逐项核对。
 *
 * ## 边界
 *
 * - 只解析 §7.2 定义的七个顶层级条目与其两级「已召回」；**不解析段内语义**（不判断「生效规则」
 *   列出的规范是否真的生效——那是 §14「不证明取值正确」）。
 * - 解析失败的段如实留空，**不猜测、不补默认值**。
 * - 条件段未出现即不出现在结果里——不虚构占位。
 */
export function parseRecord(text) {
  if (!isNonEmptyString(text)) {
    return fail("invalid_request", "text must be a non-empty string");
  }
  if (!text.startsWith(RECORD_HEADER)) {
    return fail("record/header_missing", `记录须以 ${RECORD_HEADER} 起首（03 §7.2）`);
  }
  const lines = text.split("\n");
  const out = { recalled: {} };
  const found = [];
  // 段标签 → 字段名。段名即 §7.2 的原文，不得改名（§17 第 4 项）。
  const labelToKey = new Map([
    ...REQUIRED_SECTIONS.map((section) => [section.label, section.key]),
    ...CONDITIONAL_SECTIONS.map((section) => [section.label, section.key]),
  ]);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (new RegExp(`^- ${RECALLED_LABEL}：\\s*$`).test(line)) {
      found.push(RECALLED_LABEL);
      for (let inner = index + 1; inner < lines.length; inner += 1) {
        const match = /^\s+- (ADR|Pitfall)：(.*)$/.exec(lines[inner]);
        if (match === null) break;
        out.recalled[match[1].toLowerCase()] = match[2].trim();
        index = inner;
      }
      continue;
    }
    const match = /^- ([^：]+)：(.*)$/.exec(line);
    if (match === null) continue;
    const key = labelToKey.get(match[1].trim());
    if (key === undefined) continue;
    out[key] = match[2].trim();
    found.push(match[1].trim());
  }

  const missing = REQUIRED_SECTIONS
    .map((section) => section.label)
    .filter((label) => !found.includes(label));
  if (!found.includes(RECALLED_LABEL)) missing.push(RECALLED_LABEL);

  return {
    ok: true,
    fields: out,
    // §14「格式解析与逐项核对」的入口：缺项直接交出去。
    complete: missing.length === 0,
    missing,
    present: found,
    // 回读只证明「记录里有这些内容」，不证明内容为真。
    proves: "记录可被解析回结构化字段；不证明其取值正确或识别充分",
  };
}

/** 回读的往返校验：解析再比对，防解析器与渲染器漂移。 */
export function roundTripRecord(fields) {
  const rendered = renderPrecheckRecord(fields);
  if (rendered.ok !== true) return rendered;
  const parsed = parseRecord(rendered.text);
  if (parsed.ok !== true) return parsed;
  const original = {
    effective: fields.effective.trim(),
    applicable: fields.applicable.trim(),
    allowed: fields.allowed.trim(),
    unverified: fields.unverified.trim(),
  };
  const diffs = Object.entries(original)
    .filter(([key, value]) => parsed.fields[key] !== value)
    .map(([key, rendered_]) => ({ key, rendered: rendered_, parsed: parsed.fields[key] }));
  return { ok: true, roundTripStable: diffs.length === 0, diffs, parsed };
}

// ---------------------------------------------------------------------------
// 反仪式自查（34 §17 第 2 项）
// ---------------------------------------------------------------------------

/** §17 第 2 项所指的「空结论」措辞（片段匹配，不含实质性内容即为疑似）。 */
const EMPTY_CONTENT_TERMS = Object.freeze([
  "无", "没有", "不存在", "不适用", "略", "同上", "见前", "无需", "n/a", "-", "—",
]);

/**
 * 检出疑似「仪式化记录」（34 §17 第 2 项）。
 *
 * §17 原文：「不把预检变仪式——无相关约束来源时不制造『已检查』的空记录，
 * 也不为凑齐三项而填写无内容的结论。」
 *
 * ## 为什么只「检出」而不「拒绝」
 *
 * 「无」在有些场合是**正确答案**：确无相关约束来源时，如实写「无」比编一条更诚实。
 * 机械层无法区分「诚实的无」与「凑段的空」——那是语义判断（§14）。故本函数**不拒绝**，
 * 只把疑似的段落列出来随记录交还，让 Human 或调用方看见「这几段没有实质内容」。
 *
 * 若拒绝，反而会：① 逼调用方把「无」改写成看似有内容的空话（更糟）；
 * ② 把语义判断偷换成机械判断，违反 §14「机械结果与语义判断互不替代」。
 */
export function detectRitualRecord(fields = {}) {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return fail("invalid_request", "fields must be a plain object");
  }
  const suspect = [];
  const check = (label, value) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    // 去掉标点后若仅剩空内容措辞，或全文极短且含此类措辞，即记为疑似。
    const stripped = text.replace(/[。，、；：！？\s]/g, "");
    const lowered = stripped.toLowerCase();
    // 大小写不敏感：「N/A」与「n/a」是同一件事。
    const isBare = EMPTY_CONTENT_TERMS.some((term) => term.toLowerCase() === lowered);
    const isTiny = stripped.length <= 2 && EMPTY_CONTENT_TERMS.some((term) => lowered.includes(term.toLowerCase()));
    if (isBare || isTiny) suspect.push({ section: label, value: text });
  };
  for (const section of REQUIRED_SECTIONS) check(section.label, fields[section.key]);
  check("未验证范围", fields.unverified);
  // 已召回：两级都为「未声明」时也算疑似——它意味着整个召回区没有交代。
  const recalled = fields.recalled;
  if (recalled !== null && typeof recalled === "object" && !Array.isArray(recalled)) {
    const adr = String(recalled.adr ?? "").trim();
    const pitfall = String(recalled.pitfall ?? "").trim();
    if (adr === "未声明" && pitfall === "未声明") {
      suspect.push({ section: RECALLED_LABEL, value: "两级均为「未声明」" });
    }
  }
  return {
    ok: true,
    // 疑似项随记录交还，不阻断。
    suspect,
    ritualSuspected: suspect.length > 0,
    // §17 第 2 项的真正判据在语义侧，本函数只给线索。
    judged: false,
    notice:
      suspect.length === 0
        ? null
        : `34 §17 第 2 项：以下段落无实质内容，请确认它们是「如实写无」还是「凑段」：${suspect.map((item) => item.section).join("、")}`,
  };
}

// ---------------------------------------------------------------------------
// Human Gate 领域增量事项（34 §15.1 / §15.2）
// ---------------------------------------------------------------------------

/** 34 §15.1 的四项领域增量事项（原文逐条）。 */
export const HUMAN_GATE_ITEMS = Object.freeze([
  { key: "sourceConflict", label: "两个以上来源给出互斥要求，需在来源之间取舍" },
  { key: "sourceDefect", label: "识别发现既有规则、事实或决定本身存在缺口，而修复须修改规范源或根决定" },
  { key: "scopeEscalation", label: "偏离的影响范围已超出当次行动，需决定是否暂停更大范围" },
  { key: "acceptIncomplete", label: "是否接受「识别不完整但已声明缺口」的行动继续" },
]);

/**
 * 判定一组待决事项中哪些触发了 Human Gate（34 §15.1）。
 *
 * ## 为什么这个函数必须存在
 *
 * §15.1 的四项有共同形状：都是**授权边界**，而 §11 明写「任何涉及授权边界的判断
 * 不得产自快通道」。若不在机械层把这四项标出来，一件本应提请 Human 的事容易被当作
 * 普通技术决定做掉——而 00 §4.2 把「新增、改写或扩张可强制执行规则」等列为只能
 * 由 Human 决定之事。
 *
 * ## 边界（§15.2 是我不能越的部分）
 *
 * §15.2 原文：「Human 决定只证明决定及其作用范围，**不替代**本系统的识别质量、
 * 三段判断的正确性或约束落实的核对；**Human 批准某个行动不使该行动未经识别的部分
 * 转为已识别**。」
 *
 * 故本函数只返回「这一项须提请 Human」，**永不返回「Human 已批准，故可以继续」**。
 * 它连 `approved` 这样的字段都不提供——批准不解除识别义务。
 */
export function checkHumanGate(items = []) {
  if (!Array.isArray(items)) {
    return fail("invalid_request", "items must be an array (each item names a pending decision)");
  }
  const allowed = new Set(HUMAN_GATE_ITEMS.map((item) => item.key));
  const unknown = items.filter((item) => !allowed.has(item));
  if (unknown.length > 0) {
    return fail(
      "gate/item_unknown",
      `待决事项须落在 34 §15.1 的四项内；未知项：${unknown.join("、")}`,
      { allowed: [...allowed] },
    );
  }
  const triggered = HUMAN_GATE_ITEMS.filter((item) => items.includes(item.key));
  return {
    ok: true,
    requiresHuman: triggered.length > 0,
    triggered: triggered.map((item) => item.key),
    labels: triggered.map((item) => item.label),
    // §11：涉及授权边界不得走快通道——触发 Gate 即不可快通道。
    fastPathAllowed: triggered.length === 0,
    // §15.2：批准不等于识别义务解除。恒为 true，调用方无法覆盖。
    approvalDoesNotGrantIdentification: true,
    approvalDoesNotGrantCompliance: true,
  };
}

// ---------------------------------------------------------------------------
// 相近概念区分（34 §13 末条 / §14 末段的三条边界）
// ---------------------------------------------------------------------------

/**
 * 34 §13 与 §14 明列的**禁止等式**。
 *
 * §13 末条：「识别≠落实（§8.3）；落实≠授权；预检记录完成≠行动完成；已识别≠已允许；
 * 补做识别≠从未偏离（§9.3）。」
 *
 * §14 末段：「特别地：**『已识别』不构成『已允许』，『已落实』不构成『已完成』，
 * 『补做识别』不构成『从未偏离』**——这三条边界在任何验证结论上均不得被跨越。」
 *
 * 这九个词是**不同的东西**，把它们当同义词用正是「假遵守」在语言层面的形态。
 * 每一条禁止等式给出：左侧取得什么、**不**取得什么、以及越界的依据。
 */
export const NON_EQUIVALENCES = Object.freeze([
  {
    left: "识别",
    doesNotImply: "落实",
    specRef: "34 §8.3 / §13",
    note: "识别到约束不等于行动因此改变；落实须满足有指向／有改变／有可回指依据三项",
  },
  {
    left: "落实",
    doesNotImply: "授权",
    specRef: "34 §13",
    note: "行动已按约束改变，不等于该行动已被授权；授权只来自 Human 决定与各授权程序",
  },
  {
    left: "预检记录完成",
    doesNotImply: "行动完成",
    specRef: "34 §13",
    note: "记录是判断的承载，不是判断本身，更不是行动本身",
  },
  {
    left: "已识别",
    doesNotImply: "已允许",
    specRef: "34 §13 / §14",
    note: "§14 末段明定此边界在任何验证结论上均不得被跨越",
  },
  {
    left: "补做识别",
    doesNotImply: "从未偏离",
    specRef: "34 §9.3 / §13 / §14",
    note: "补做只能证明补齐后的状态，其前一段的偏离须如实保留",
  },
  {
    left: "已落实",
    doesNotImply: "已完成",
    specRef: "34 §14",
    note: "§14 末段明定；落实指约束改变了行动，完成指行动本身达成",
  },
]);

/** 这些词对一旦以等号相连出现，就是踩了上面的边界。 */
const EQUIVALENCE_PATTERNS = Object.freeze([
  { pattern: /已识别\s*(?:即|=|＝|就是)\s*已允许/, left: "已识别", right: "已允许" },
  { pattern: /已落实\s*(?:即|=|＝|就是)\s*已完成/, left: "已落实", right: "已完成" },
  { pattern: /补做识别\s*(?:即|=|＝|就是)\s*从未偏离/, left: "补做识别", right: "从未偏离" },
  { pattern: /识别\s*(?:即|=|＝|就是)\s*落实/, left: "识别", right: "落实" },
  { pattern: /落实\s*(?:即|=|＝|就是)\s*授权/, left: "落实", right: "授权" },
  { pattern: /预检(?:记录)?完成\s*(?:即|=|＝|就是)\s*行动完成/, left: "预检记录完成", right: "行动完成" },
]);

/**
 * 在给定文本中检出被跨越的边界（34 §13 / §14 末段）。
 *
 * ## 为什么需要它
 *
 * §14 末段把三条边界抬到「在任何验证结论上均不得被跨越」的强度。但这类越界
 * 通常不是有人故意撒谎，而是**措辞滑动**——写着写着「已识别」滑成「已允许」。
 * 机械层能做的正是抓这种字面滑动，把交还给 Human 或调用方自己看。
 *
 * ## 边界
 *
 * 只抓**显式的等式措辞**（`即`/`=`/`＝`/`就是`）。它**不**判断文中未出现等式却
 * 隐含了这些结论的情形——那是语义判断（§14「机械结果与语义判断互不替代」）。
 * 故本函数返回的 `clean: true` 只表示「没找到等式措辞」，不表示边界未被跨越。
 */
export function checkConceptBoundaries(text) {
  if (!isNonEmptyString(text)) {
    return fail("invalid_request", "text must be a non-empty string");
  }
  const violations = [];
  for (const { pattern, left, right } of EQUIVALENCE_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) {
      const entry = NON_EQUIVALENCES.find((item) => item.left === left && item.doesNotImply === right);
      violations.push({
        left,
        right,
        matched: match[0],
        specRef: entry?.specRef ?? "34 §13",
        note: entry?.note ?? null,
      });
    }
  }
  return {
    ok: true,
    clean: violations.length === 0,
    violations,
    // 只抓字面等式，不抓隐含结论——如实声明以免被当作完整保证。
    proves: "未出现把两个概念写成等式的措辞；不证明文中未隐含该结论",
    nonEquivalences: NON_EQUIVALENCES.length,
  };
}

// ---------------------------------------------------------------------------
// 系统执行分层交还（03 §5.5）—— 让记录有真实的上游消费方
// ---------------------------------------------------------------------------

/** 03 §5.5 的三层（原文逐字；互不替代）。 */
export const HANDOVER_LAYERS = Object.freeze([
  { key: "flow", label: "流程完成层", meaning: "系统流程按定义执行完毕，未触发停止条件" },
  { key: "verified", label: "验证通过层", meaning: "流程完成层成立，且系统定义的验证入口全部通过" },
  { key: "carried", label: "交还承接层", meaning: "验证通过层成立，且结果、已验证与未验证范围、残留风险与待决事项已交还" },
]);

/**
 * 按 03 §5.5 声明一次系统执行停在哪一层。
 *
 * ## 为什么这个函数是本模块与真实流程的接缝
 *
 * `assembleReturn` 产出的是 §12 交还正文，但「停在什么程度」由 03 §5.5 定义。
 * 两者不是同一件事：§12 说**必须交还什么内容**，§5.5 说**这些内容支撑到哪一层结论**。
 *
 * §5.5 的关键约束（原文）：
 * - 「流程完成层不等于验证通过层；验证通过层也不等于价值成立」；
 * - 验证未完成或覆盖不足时「只能交还 partial/unverified」；
 * - §5.4 第 3 项：验证未通过时「不得宣称系统结论成立」。
 *
 * 故本函数**不允许跳层**，并且**永不返回「价值成立」**——§5.5 明文「交还承接层……
 * 不替代 00 的价值判断」。
 */
export function declareHandoverLayer(input = {}) {
  const flow = input.flowComplete === true;
  const verified = input.verificationPassed === true;
  const carried = input.handoverCarried === true;
  const insufficient = input.coverageInsufficient === true;

  // 跳层即不成立：§5.5「流程完成层不等于验证通过层」。
  if (verified && !flow) {
    return fail(
      "handover/layer_skipped",
      "03 §5.5：验证通过层以流程完成层成立为前提，不得跳层声明",
    );
  }
  if (carried && !verified) {
    return fail(
      "handover/layer_skipped",
      "03 §5.5：交还承接层以验证通过层成立为前提，不得跳层声明",
    );
  }

  // 覆盖不足时，最高只停在 flow 层并交还 partial/unverified（§5.4 第 3 项）。
  const ceiling = insufficient ? "flow" : (carried ? "carried" : (verified ? "verified" : "flow"));
  const reachedIndex = HANDOVER_LAYERS.findIndex((layer) => layer.key === ceiling);

  return {
    ok: true,
    reached: HANDOVER_LAYERS[reachedIndex].label,
    status: verified && !insufficient ? (carried ? "carried" : "verified") : "partial/unverified",
    layers: HANDOVER_LAYERS.slice(0, reachedIndex + 1).map((layer) => layer.label),
    // §5.5 末句：交还承接层不替代 00 的价值判断。
    provesValue: false,
    // §5.4 末句：工具返回成功、Git commit 已创建都不单独替代成立条件。
    staticExistenceSuffices: false,
  };
}

// ---------------------------------------------------------------------------
// 当次作用范围与退出条件（34 §6）
// ---------------------------------------------------------------------------

/** §6「退出与转交条件」点名的三种停止情形。 */
export const STOP_CONDITIONS = Object.freeze([
  { key: "identificationFailed", label: "识别失败" },
  { key: "conflictIrreconcilable", label: "约束冲突无法调和" },
  { key: "uncertaintyMayChangePermission", label: "不确定项可能改变行动是否被允许" },
]);

/**
 * 判定一次预检能否**退出**（34 §6「退出与转交条件」）。
 *
 * §6 原文：「**三段判断完成并生成预检落实记录后退出**，转由行动本身承接；
 * 识别失败、约束冲突无法调和、或不确定项可能改变行动是否被允许时，
 * **不退出而是停止交还**（§14）。转交不改变主控对行动的整体责任。」
 *
 * 故退出的充要条件是两条同时成立：三段判断完成 + 记录已生成。
 * 三个停止情形任一命中即不得退出。
 *
 * ## 本函数不判断什么
 *
 * 不判断三段判断的**取值是否正确**（那属 §14「不证明取值正确」），
 * 只判断「是否已作出三项结论且记录已生成」这一形态事实。
 * `ownershipUnchanged` 恒为 true——§6 末句「转交不改变主控对行动的整体责任」
 * 是必须随退出一并带出的边界，不是可选项。
 */
export function checkExit(input = {}) {
  const threeWayDone = input.threeWayJudgementComplete === true;
  const recordGenerated = input.recordGenerated === true;
  const stops = STOP_CONDITIONS.filter((c) => input[c.key] === true);

  if (stops.length > 0) {
    return {
      ok: true,
      mayExit: false,
      mustStopAndHandover: true,
      stoppedBy: stops.map((c) => c.label),
      reason: "34 §6：出现停止情形时不退出而是停止交还（§14）",
      // §6 末句：转交不改变主控对行动的整体责任。
      ownershipUnchanged: true,
    };
  }
  if (!threeWayDone || !recordGenerated) {
    const missing = [];
    if (!threeWayDone) missing.push("三段判断完成");
    if (!recordGenerated) missing.push("生成预检落实记录");
    return {
      ok: true,
      mayExit: false,
      mustStopAndHandover: false,
      stoppedBy: [],
      missing,
      reason: `34 §6：退出以「${missing.join(" 且 ")}」为前提，条件未齐不得退出`,
      ownershipUnchanged: true,
    };
  }
  return {
    ok: true,
    mayExit: true,
    mustStopAndHandover: false,
    stoppedBy: [],
    reason: "三段判断完成且记录已生成，可退出并转由行动本身承接",
    // §6 末句：转交不改变主控对行动的整体责任。
    ownershipUnchanged: true,
  };
}

/** §6「不得以『上次已确认』代替本次判断」点名的替代措辞。 */
const LAZY_RECHECK_TERMS = Object.freeze([
  "上次已确认", "上次已检查", "之前已确认", "此前已确认", "沿用上次", "同上次", "上次预检过",
]);

/**
 * 判定一次复用是否满足 §6「当次作用范围」的可回指依据要求。
 *
 * §6 原文：「一次预检结论只覆盖当次行动与当次识别范围，**不延续到后续行动**；
 * 后续行动即使同类，也须重新识别——识别的复用须有**可回指的依据**
 * （如同一约束在同一范围内已核对且未变化），**不得以「上次已确认」代替本次判断**。」
 *
 * 本函数做两件**形式**判定：
 *  1. **是否给了可回指依据**——不给即不得复用（§6 的必要条件）；
 *  2. **是否写了「上次已确认」类措辞**——§6 点名禁止的替代写法。
 *
 * 与 `evaluateReuse`（03 §7.3 三条低成本可观察条件）的分工：
 * `evaluateReuse` 判「载体变没变」，本函数判「有没有给依据」。
 * 二者独立成立，复用须同时过两关。
 *
 * ## 不判断什么
 *
 * 不判断所给依据**是否真的成立**（那是语义判断）。它只保证「有依据」而非「无依据复用」。
 */
export function checkReuseBasis(input = {}) {
  if (!isNonEmptyString(input.recordSessionId) || !isNonEmptyString(input.sessionId)) {
    return fail("invalid_request", "recordSessionId and sessionId are required");
  }
  const basis = isNonEmptyString(input.basis) ? input.basis.trim() : "";
  // §6：不延续到后续行动——跨会话复用一律不成立。
  if (input.recordSessionId !== input.sessionId) {
    return {
      ok: true,
      reusable: false,
      failed: ["跨会话：§6 明文作用范围限于当次行动，不延续到后续行动"],
      lazyClaim: null,
    };
  }
  const haystack = `${basis} ${input.note ?? ""}`;
  const lazy = LAZY_RECHECK_TERMS.find((term) => haystack.includes(term));
  if (lazy !== undefined) {
    return {
      ok: true,
      reusable: false,
      failed: [`34 §6：不得以「${lazy}」代替本次判断`],
      lazyClaim: lazy,
    };
  }
  if (basis === "") {
    return {
      ok: true,
      reusable: false,
      failed: ["34 §6：复用须有可回指的依据，未给出即不得复用"],
      lazyClaim: null,
    };
  }
  return { ok: true, reusable: true, failed: [], lazyClaim: null, basis };
}

// ---------------------------------------------------------------------------
// 必停情形统一入口（34 §16.1 六条 + 00 §5.7 暂停范围）
// ---------------------------------------------------------------------------

/**
 * 34 §16.1 的六条领域触发（原文逐条）。
 *
 * §16.1 原文：「出现以下任一情况时，按 00 §5.7 **暂停最小受影响范围**」。
 *
 * ## 为什么需要这个统一入口
 *
 * 这六条分散在 §6、§8.3、§9.2、§9.1、§9.3、§11 各处，各处的判据函数
 * （`checkEntry` / `evaluateApplication` / `evaluateDeviation` / `routeConflict` /
 * `checkRetroactiveCoverage` / `checkTransverseMerge`）**分别成立**。
 * 但「必须暂停」这件事本身是 §16.1 的统一要求——调用方若要自查「我该不该停」，
 * 不应被要求跑六个函数再自己合并结论。故本函数提供单一入口。
 *
 * ## 每条映射到哪个判据函数
 *
 * | §16.1 条 | 承载 | 本函数取哪个信号 |
 * |---|---|---|
 * | 1 适用性不确定且可能改变允许 | `checkEntry` | `undetermined` + `mayChangePermission` |
 * | 2 未改变行动却以「已遵守」继续 | `evaluateApplication` | 第②项出现合并措辞 |
 * | 3 偏离已登记但后续仍建立其上 | `evaluateDeviation` + 本节 | `subsequentActionBuildsOnDeviation` |
 * | 4 来源冲突已择一执行未交还 | `routeConflict` + 本节 | `choseOneAndExecuted` |
 * | 5 补做识别覆盖缺口事实 | `checkRetroactiveCoverage` | `backfilledAt > actionAt` 且未声明保留 |
 * | 6 横切预检互相免除 | `checkTransverseMerge` | 两套缺任一 |
 *
 * ## 本函数不判断什么
 *
 * 不判断**是否应当暂停**的语义价值（那是 Human 或主控的判断），只报告
 * 「哪几条已被触发」。`minimumScopeOnly` 恒为 true——§16.1 明文「暂停最小受影响
 * 范围」，本函数不提供扩大范围的出口。
 */
export const STOP_RULES = Object.freeze([
  { index: 1, key: "applicabilityUndetermined", specRef: "34 §16.1 第 1 项（§6）" },
  { index: 2, key: "claimsComplianceWithoutChange", specRef: "34 §16.1 第 2 项（§8.3）" },
  { index: 3, key: "subsequentActionBuildsOnDeviation", specRef: "34 §16.1 第 3 项（§9.2）" },
  { index: 4, key: "choseOneAndExecuted", specRef: "34 §16.1 第 4 项（§9.1）" },
  { index: 5, key: "backfillCoversGap", specRef: "34 §16.1 第 5 项（§9.3）" },
  { index: 6, key: "transverseMutualExemption", specRef: "34 §16.1 第 6 项（§11）" },
]);

/**
 * 按 34 §16.1 判定哪些必停情形被触发。
 *
 * @param {object} input 每个字段对应 `STOP_RULES` 的一个 `key`；true 即该条被触发。
 *
 * 返回 `triggered`（触发的条号）与 `mustSuspend`。恒不提供扩大暂停范围的出口。
 */
export function checkStopConditions(input = {}) {
  const triggered = STOP_RULES.filter((rule) => input[rule.key] === true);
  return {
    ok: true,
    mustSuspend: triggered.length > 0,
    triggered: triggered.map((rule) => rule.index),
    details: triggered.map((rule) => ({ index: rule.index, specRef: rule.specRef })),
    all: STOP_RULES.map((rule) => ({ index: rule.index, specRef: rule.specRef })),
    // §16.1：暂停最小受影响范围——本函数不提供扩大范围的出口。
    minimumScopeOnly: true,
    // §16.1 只规定「暂停」，不规定「如何判」；本函数不取代语义判断。
    provesOnlySuspension: true,
  };
}

// ---------------------------------------------------------------------------
// 暂停期间允许动作与恢复（34 §16.2 / §16.3）
// ---------------------------------------------------------------------------

/** 34 §16.2 原文列举的暂停期间唯一四种允许动作。 */
export const SUSPENSION_ALLOWED_ACTIONS = Object.freeze([
  { key: "redoAffectedIdentification", label: "补做受影响的识别" },
  { key: "completeSourceReading", label: "补齐来源读取" },
  { key: "registerGapsAndDeviations", label: "登记缺口与偏离" },
  { key: "narrowActionScope", label: "缩小行动范围到已识别部分可支持的范围" },
]);

/**
 * 判定一次暂停期间的动作是否越界（34 §16.2）。
 *
 * §16.2 原文：「暂停期间只允许：补做受影响的识别、补齐来源读取、登记缺口与偏离、
 * 缩小行动范围到已识别部分可支持的范围。**不得继续执行受影响行动，也不得扩大
 * 声明范围**。」
 *
 * 本函数做两件**形式**判定：
 *  1. 动作是否落在四种允许集内；
 *  2. 两个明确的禁止项（继续执行受影响行动／扩大声明范围）是否被触发。
 *
 * ## 不判断什么
 *
 * 不判断「缩小行动范围」是否真的缩小了——那需要语义比对。本函数只在调用方
 * 自报的两个禁止项为 true 时拒绝，并核对动作是否在允许集内。
 */
export function checkSuspensionAction(input = {}) {
  const forbidden = [];
  if (input.continueAffectedAction === true) forbidden.push("继续执行受影响行动");
  if (input.expandDeclaredScope === true) forbidden.push("扩大声明范围");
  if (forbidden.length > 0) {
    return {
      ok: true,
      allowed: false,
      forbidden,
      reason: `34 §16.2：暂停期间不得${forbidden.join("，也不得")}`,
    };
  }
  const action = input.action;
  const matched = SUSPENSION_ALLOWED_ACTIONS.find((a) => a.key === action);
  if (matched === undefined) {
    return {
      ok: true,
      allowed: false,
      forbidden: [],
      reason: `34 §16.2：暂停期间只允许四种动作（${SUSPENSION_ALLOWED_ACTIONS.map((a) => a.label).join("／")}），收到的动作不在其内`,
      allowedActions: SUSPENSION_ALLOWED_ACTIONS.map((a) => a.key),
    };
  }
  return { ok: true, allowed: true, forbidden: [], matched: matched.label, reason: null };
}

/**
 * 判定一次恢复是否成立（34 §16.3）。
 *
 * §16.3 原文：「恢复须**与触发原因对应**，且只覆盖当前识别依据支持的范围；
 * **补齐后的识别不追溯性地使偏离消失**（§9.3）。同一停止条件恢复后**再次触发**时，
 * 按 00 §5.7 的恢复与再次触发**进入 Human Gate**。」
 *
 * 三条要求，本函数做两件形式判定：
 *  1. **与触发原因对应**——不给 `triggerReason` 即不得恢复；
 *  2. **再次触发须进 Human Gate**——`retriggered === true` 时返回
 *     `requiresHumanGate: true`，且**不提供任何「自行恢复」的出口**。
 *
 * 第三条「补齐后的识别不追溯性地使偏离消失」不由本函数判——它由
 * `checkRetroactiveCoverage`（§9.3）承载；本函数在此只声明该边界存在。
 *
 * ## 不判断什么
 *
 * 不判断「所给触发原因是否真实成立」——那是语义判断。它只保证「有原因」而非
 * 「无原因恢复」，并保证再次触发时交 Human 而非静默自愈。
 */
export function checkRecovery(input = {}) {
  if (!isNonEmptyString(input.triggerReason)) {
    return fail(
      "recovery/reason_missing",
      "34 §16.3：恢复须与触发原因对应，未给原因即不得恢复",
    );
  }
  if (input.retriggered === true) {
    return {
      ok: true,
      recovered: false,
      requiresHumanGate: true,
      reason: "34 §16.3：同一停止条件恢复后再次触发，按 00 §5.7 进入 Human Gate",
      // §16.3：补齐后的识别不追溯性地使偏离消失（§9.3）。
      retroactiveReliefForbidden: true,
    };
  }
  return {
    ok: true,
    recovered: true,
    requiresHumanGate: false,
    reason: "触发原因已给出，且未再次触发；恢复只覆盖当前识别依据支持的范围",
    // §16.3 末句：补齐后的识别不追溯性地使偏离消失（§9.3）。
    retroactiveReliefForbidden: true,
  };
}

export { join };
