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
 * ## 六段是**语义示例**，不是字段登记
 *
 * 03 §7.2 原文末句：「该格式是交还语义示例，不是对 LDVH CLI 或 Code 的字段
 * 登记。」这句话既允许 Code 侧自定存储形式，也**禁止** Code 侧把它当 Schema
 * 用——故本模块的校验停在「必需段是否出现且非空」这一层，不解析段内语义、
 * 不判断结论对错（§14「三项是否齐备及其取值；不证明取值正确」）。
 *
 * ## 为什么必需段只有四段
 *
 * 03 §7.2 共六段，但「快通道声明」与「升级记录」原文都带「如」——它们是**条件
 * 段**（未走快通道、未升级时无内容可写）。§17 第 2 项禁止「为凑齐三项而填写无
 * 内容的结论」，故本模块只把四段列为必需，两段条件段仅在传入时呈现。
 * 「已召回」按 §7.2 是两级结构（ADR / Pitfall 各自可标「未触发」），本模块接受
 * 字符串或 {adr, pitfall} 对象，两种形态都归一为 §7.2 的两行结构。
 *
 * ## 本模块**不能**证明什么（§14 末段同口径）
 *
 * 六段齐备、格式合规、时间序正确，**均不能单独证明**规则被实际遵守、行动已被
 * 允许或结果正确。本模块只做「形态」这一层的机械判定，从不返回任何「已遵守」
 * 结论——这个区分是 34 §12 的强制内容，本模块不替调用方合并它。
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 必需段（03 §7.2 的六段中，原文未带「如」的四段）。顺序即呈现顺序。
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
 * 归一「已召回」：接受字符串，或 `{ adr, pitfall }` 对象，或字符串数组。
 * 无论哪种形态，呈现都是 §7.2 的两行结构；缺哪一级就写「未触发」——
 * 这是 §7.2 原文对该段的显式要求（「若未触发则标记未触发」），不是填充。
 */
function normalizeRecalled(value) {
  if (value === undefined || value === null) {
    return { adr: "未触发", pitfall: "未触发" };
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return { adr: "未触发", pitfall: "未触发" };
    // 单串无法区分 ADR / Pitfall：原样落在 ADR 行、Pitfall 行标未触发，
    // 并在 message 外连同一句诊断交还——不猜、不拆、不静默丢弃。
    return { adr: text, pitfall: "未触发", undifferentiated: true };
  }
  if (Array.isArray(value)) {
    const text = value.filter((item) => isNonEmptyString(item)).map((item) => item.trim()).join("；");
    return { adr: text === "" ? "未触发" : text, pitfall: "未触发", undifferentiated: true };
  }
  if (typeof value === "object") {
    const adr = isNonEmptyString(value.adr) ? value.adr.trim() : "未触发";
    const pitfall = isNonEmptyString(value.pitfall) ? value.pitfall.trim() : "未触发";
    return { adr, pitfall };
  }
  return { adr: "未触发", pitfall: "未触发" };
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

  const recalled = normalizeRecalled(fields.recalled);
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

  return {
    ok: true,
    text: `${lines.join("\n")}\n`,
    sections: [...present],
    undifferentiatedRecall: recalled.undifferentiated === true,
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
  { key: "sameScope", label: "同一会话、目标与行动范围未实质变化", mechanical: false },
  { key: "sourcesUnchanged", label: "作为预检依据的规则源与事实载体未变更", mechanical: true },
  { key: "noNewSignal", label: "未出现新的召回触发、风险升级、能力缺口或 Human Gate 信号", mechanical: false },
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
  授权边界判断: "标准路径",
});

/** 任一环节涉及授权边界时，快通道一律不可用（§11 末句）。 */
const AUTHORIZATION_STAGE = "授权边界判断";

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
  "三段判断不成立",
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
    三段判断不成立: "按性质分流：生效不成立补来源／适用不成立缩小范围／行动允许不成立停止",
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

export { join };
