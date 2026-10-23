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
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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

/** 落盘子目录与文件名前缀（specs/10 §7.7 的 ldvh/ 域之下）。 */
const STORE_SUBDIR = "precheck-records";

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
 * 落盘路径：`<dshHome>/ldvh/precheck-records/<session>-<stamp>.txt`。
 *
 * 路径一律由 `dshHomePath` 解析得到，不硬编码（specs/10 §7.7 的同一纪律）。
 * `stamp` 由调用方给（可观测、可复算），本模块不取系统时钟——纯函数化便于测试。
 */
export function recordPath(dshHomePath, { sessionId, stamp }) {
  if (typeof dshHomePath !== "function") {
    throw new Error("dshHomePath resolver is required (specs/10 §7.7: no hard-coded paths)");
  }
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(stamp)) {
    throw new Error("sessionId and stamp are required to name a record carrier");
  }
  const safe = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, "_");
  return dshHomePath("ldvh", STORE_SUBDIR, `${safe(sessionId)}-${safe(stamp)}.txt`);
}

/**
 * 原子写 + 写后回读。回读不一致即报失败，绝不静默通过（specs/03 §9 读回同形纪律）。
 */
export async function writeRecord(filePath, text) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, "utf8");
  const readBack = await readFile(tmp, "utf8");
  if (readBack !== text) {
    await unlink(tmp).catch(() => {});
    return fail("record/write_verify_failed", "写入后回读内容与写入内容不一致；未落盘");
  }
  await rename(tmp, filePath);
  const finalRead = await readFile(filePath, "utf8");
  if (finalRead !== text) {
    return fail("record/readback_mismatch", "落盘后回读内容与写入内容不一致");
  }
  return { ok: true, file: filePath, fingerprint: recordFingerprint(finalRead) };
}

/** 回读一份已落盘的记录：原文 + 指纹 + 形态核对结论。 */
export async function readRecord(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    return fail("record/unreadable", String(error?.message ?? error));
  }
  return {
    ok: true,
    text,
    fingerprint: recordFingerprint(text),
    shape: checkRecordShape(text),
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

/** 供调用方拼装路径的工具导出（测试与工具层共用，避免各自拼串）。 */
export const STORE_DIR = STORE_SUBDIR;
export { join };
